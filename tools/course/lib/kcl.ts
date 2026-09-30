/**
 * KCL (v2, "prism" collision) encoder with an octree, matching the layout Kinoko's
 * Field::KColData reads:
 *
 *   0x00 u32 pos_data_offset      (f32[3] vertices)
 *   0x04 u32 nrm_data_offset      (f32[3] normals)
 *   0x08 u32 prism_data_offset    (1-indexed: points 0x10 bytes before prism #1)
 *   0x0C u32 block_data_offset    (octree)
 *   0x10 f32 prism_thickness
 *   0x14 f32[3] area_min_pos
 *   0x20 u32 area_x_width_mask, 0x24 y mask, 0x28 z mask
 *   0x2C u32 block_width_shift, 0x30 area_x_blocks_shift, 0x34 area_xy_blocks_shift
 *   0x38 f32 sphere_radius
 *
 * Sections are laid out contiguously (header | vertices | normals | prisms | octree) because
 * Kinoko derives the element counts from the gaps between offsets.
 *
 * Prism (0x10 bytes): f32 height, u16 pos_i, u16 fnrm_i, u16 enrm1_i (edge CA), u16 enrm2_i
 * (edge AB), u16 enrm3_i (edge BC), u16 attribute. For triangle A,B,C (counter-clockwise seen
 * from the side the face normal points to):
 *   fnrm  = |(B-A) x (C-A)|
 *   enrm1 = |fnrm x (C-A)|      (outward normal of edge A→C)
 *   enrm2 = |(B-A) x fnrm|      (outward normal of edge A→B)
 *   enrm3 = |(C-B) x fnrm|      (outward normal of edge B→C)
 *   height = (C-A) · enrm3      (distance from A to edge BC)
 *
 * Octree: the root is a grid of (X>>s) * (Y>>s) * (Z>>s) u32 entries, index
 * (z << xyShift | y << xShift | x). Each entry is either a branch (offset, relative to the
 * containing node's start, of 8 child u32 entries ordered x | y<<1 | z<<2) or, with the MSB set, a
 * leaf: (offset relative to the containing node's start) of a u16 prism-index list MINUS 2; the
 * list is 0-terminated (Kinoko pre-increments before reading).
 */

import { BinWriter } from '../../lib/bin';

export type V3 = [number, number, number];
export type Tri = { a: V3; b: V3; c: V3; attr: number };

export type KclOptions = {
    prismThickness: number; // 300 in retail files
    sphereRadius: number; // 250 in retail files (== KartSub narrow-scope radius)
    maxTrisPerLeaf: number;
    minLeafShift: number;
    rootShift: number; // log2 of root cell size (clamped to area size)
    margin: number; // extra space around the model's bbox for the octree area
    /** Extra slack (units) added to the sphere radius when assigning prisms to octree leaves. */
    leafSlack?: number;
};

const fr = Math.fround;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => {
    const l = len(a);
    return [a[0] / l, a[1] / l, a[2] / l];
};
const f3 = (a: V3): V3 => [fr(a[0]), fr(a[1]), fr(a[2])];

export type Prism = {
    height: number;
    posI: number;
    fnrmI: number;
    e1I: number;
    e2I: number;
    e3I: number;
    attr: number;
    tri: [V3, V3, V3];
    fnrm: V3;
};

export type KclBuild = {
    bytes: Uint8Array;
    prismCount: number;
    vertexCount: number;
    normalCount: number;
    leafCount: number;
    maxLeafTris: number;
    areaMin: V3;
    areaShift: [number, number, number];
    blockShift: number;
};

export function encodeKCL(tris: Tri[], opt: KclOptions): KclBuild {
    // ---- vertices / normals / prisms --------------------------------------------------------
    const verts: V3[] = [];
    const vertMap = new Map<string, number>();
    const nrms: V3[] = [];
    const nrmMap = new Map<string, number>();
    const key = (v: V3) => `${v[0]},${v[1]},${v[2]}`;
    const addVert = (v: V3) => {
        const k = key(v);
        let i = vertMap.get(k);
        if (i === undefined) {
            i = verts.length;
            verts.push(v);
            vertMap.set(k, i);
        }
        return i;
    };
    const addNrm = (v: V3) => {
        const k = key(v);
        let i = nrmMap.get(k);
        if (i === undefined) {
            i = nrms.length;
            nrms.push(v);
            nrmMap.set(k, i);
        }
        return i;
    };

    const prisms: Prism[] = [];
    for (const t of tris) {
        const A = f3(t.a);
        const B = f3(t.b);
        const C = f3(t.c);
        const n = cross(sub(B, A), sub(C, A));
        if (len(n) < 1e-3) continue; // degenerate
        const fn = norm(n);
        const e1 = norm(cross(fn, sub(C, A)));
        const e2 = norm(cross(sub(B, A), fn));
        const e3 = norm(cross(sub(C, B), fn));
        const h = dot(sub(C, A), e3);
        if (!(h > 0)) throw new Error('bad prism height');
        const fnF = f3(fn);
        prisms.push({
            height: fr(h),
            posI: addVert(A),
            fnrmI: addNrm(fnF),
            e1I: addNrm(f3(e1)),
            e2I: addNrm(f3(e2)),
            e3I: addNrm(f3(e3)),
            attr: t.attr,
            tri: [A, B, C],
            fnrm: fn,
        });
    }
    if (prisms.length >= 0xffff) throw new Error('too many prisms for u16 indices');
    if (verts.length > 0xffff || nrms.length > 0xffff) throw new Error('too many vertices/normals');

    // ---- octree area --------------------------------------------------------------------------
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of prisms) {
        for (const v of p.tri) {
            for (let k = 0; k < 3; ++k) {
                lo[k] = Math.min(lo[k]!, v[k]!);
                hi[k] = Math.max(hi[k]!, v[k]!);
            }
        }
    }
    const areaMin: V3 = [0, 0, 0];
    const shifts: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; ++k) {
        areaMin[k] = Math.floor(lo[k]! - opt.margin);
        const ext = hi[k]! + opt.margin - areaMin[k]!;
        let s = 0;
        while (1 << s < ext) ++s;
        shifts[k] = s;
    }
    const blockShift = Math.min(opt.rootShift, shifts[0], shifts[1], shifts[2]);
    const nx = 1 << (shifts[0] - blockShift);
    const ny = 1 << (shifts[1] - blockShift);
    const nz = 1 << (shifts[2] - blockShift);
    const xShift = shifts[0] - blockShift;
    const xyShift = shifts[0] - blockShift + (shifts[1] - blockShift);

    // Prism volume (triangle swept by -fnrm * thickness), used for the conservative SAT test.
    const volumes = prisms.map((p) => {
        const d: V3 = [-p.fnrm[0] * opt.prismThickness, -p.fnrm[1] * opt.prismThickness, -p.fnrm[2] * opt.prismThickness];
        const [A, B, C] = p.tri;
        const pts: V3[] = [A, B, C, add(A, d), add(B, d), add(C, d)];
        const edges: V3[] = [sub(B, A), sub(C, B), sub(A, C), p.fnrm];
        const faceAxes: V3[] = [p.fnrm, cross(sub(B, A), p.fnrm), cross(sub(C, B), p.fnrm), cross(sub(A, C), p.fnrm)];
        const bmin: V3 = [Infinity, Infinity, Infinity];
        const bmax: V3 = [-Infinity, -Infinity, -Infinity];
        for (const q of pts)
            for (let k = 0; k < 3; ++k) {
                bmin[k] = Math.min(bmin[k]!, q[k]!);
                bmax[k] = Math.max(bmax[k]!, q[k]!);
            }
        return { pts, edges, faceAxes, bmin, bmax };
    });

    const overlaps = (i: number, cmin: V3, size: number): boolean => {
        const v = volumes[i]!;
        const r = opt.sphereRadius + (opt.leafSlack ?? 0);
        const bl: V3 = [cmin[0] - r, cmin[1] - r, cmin[2] - r];
        const bh: V3 = [cmin[0] + size + r, cmin[1] + size + r, cmin[2] + size + r];
        for (let k = 0; k < 3; ++k) if (v.bmax[k]! < bl[k]! || v.bmin[k]! > bh[k]!) return false;
        const c: V3 = [(bl[0] + bh[0]) / 2, (bl[1] + bh[1]) / 2, (bl[2] + bh[2]) / 2];
        const e: V3 = [(bh[0] - bl[0]) / 2, (bh[1] - bl[1]) / 2, (bh[2] - bl[2]) / 2];
        const axes: V3[] = [...v.faceAxes];
        const boxAxes: V3[] = [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
        ];
        for (const ba of boxAxes) for (const ed of v.edges) axes.push(cross(ba, ed));
        for (const ax of axes) {
            if (Math.abs(ax[0]) + Math.abs(ax[1]) + Math.abs(ax[2]) < 1e-9) continue;
            let pmin = Infinity;
            let pmax = -Infinity;
            for (const q of v.pts) {
                const d = dot(q, ax);
                pmin = Math.min(pmin, d);
                pmax = Math.max(pmax, d);
            }
            const bc = dot(c, ax);
            const br = e[0] * Math.abs(ax[0]) + e[1] * Math.abs(ax[1]) + e[2] * Math.abs(ax[2]);
            if (pmax < bc - br - 1e-3 || pmin > bc + br + 1e-3) return false;
        }
        return true;
    };

    // ---- build tree ----------------------------------------------------------------------------
    type Leaf = { kind: 'leaf'; list: number[] };
    type Branch = { kind: 'branch'; children: Node[] };
    type Node = Leaf | Branch;

    const build = (cmin: V3, shift: number, cand: number[]): Node => {
        const size = 1 << shift;
        const inside = cand.filter((i) => overlaps(i, cmin, size));
        if (inside.length <= opt.maxTrisPerLeaf || shift <= opt.minLeafShift) {
            return { kind: 'leaf', list: inside };
        }
        const half = shift - 1;
        const hs = 1 << half;
        const children: Node[] = [];
        for (let idx = 0; idx < 8; ++idx) {
            const o: V3 = [cmin[0] + (idx & 1 ? hs : 0), cmin[1] + (idx & 2 ? hs : 0), cmin[2] + (idx & 4 ? hs : 0)];
            children.push(build(o, half, inside));
        }
        return { kind: 'branch', children };
    };

    const all = prisms.map((_, i) => i);
    const roots: Node[] = [];
    for (let z = 0; z < nz; ++z)
        for (let y = 0; y < ny; ++y)
            for (let x = 0; x < nx; ++x) {
                const o: V3 = [
                    areaMin[0] + (x << blockShift),
                    areaMin[1] + (y << blockShift),
                    areaMin[2] + (z << blockShift),
                ];
                roots.push(build(o, blockShift, all));
            }

    // ---- serialize tree: [root entries][branch nodes BFS][lists] ------------------------------
    // Assign branch node positions (BFS), relative to the block data start.
    const branchPos = new Map<Branch, number>();
    let cursor = roots.length * 4;
    const queue: Branch[] = [];
    const visit = (n: Node) => {
        if (n.kind === 'branch') {
            branchPos.set(n, cursor);
            cursor += 32;
            queue.push(n);
        }
    };
    roots.forEach(visit);
    for (let qi = 0; qi < queue.length; ++qi) queue[qi]!.children.forEach(visit);

    // Deduplicated lists placed after all nodes. Start with the shared empty list.
    const listPos = new Map<string, number>();
    const listData: number[][] = [];
    let listCursor = cursor;
    let leafCount = 0;
    let maxLeafTris = 0;
    const placeList = (list: number[]) => {
        const sorted = [...list].sort((a, b) => a - b).map((i) => i + 1);
        const k = sorted.join(',');
        let p = listPos.get(k);
        if (p === undefined) {
            p = listCursor;
            listPos.set(k, p);
            listData.push(sorted);
            listCursor += (sorted.length + 1) * 2;
        }
        return p;
    };
    placeList([]);

    const entryFor = (n: Node, nodeStart: number): number => {
        if (n.kind === 'branch') {
            const off = branchPos.get(n)! - nodeStart;
            if (off <= 0 || off >= 0x80000000) throw new Error('bad branch offset');
            return off;
        }
        ++leafCount;
        maxLeafTris = Math.max(maxLeafTris, n.list.length);
        const p = placeList(n.list);
        const off = p - 2 - nodeStart;
        if (off < 0 || off >= 0x80000000) throw new Error('bad leaf offset');
        return (off | 0x80000000) >>> 0;
    };

    const tree = new BinWriter(listCursor + 1024);
    const rootEntries = roots.map((n) => entryFor(n, 0));
    const branchEntries = queue.map((b) => b.children.map((c) => entryFor(c, branchPos.get(b)!)));
    for (const e of rootEntries) tree.u32(e);
    for (const es of branchEntries) for (const e of es) tree.u32(e);
    if (tree.pos !== cursor) throw new Error('tree layout mismatch');
    for (const l of listData) {
        for (const i of l) tree.u16(i);
        tree.u16(0);
    }
    const treeBytes = tree.finish();

    // ---- file ----------------------------------------------------------------------------------
    const HEADER = 0x3c;
    const posOff = HEADER;
    const nrmOff = posOff + verts.length * 12;
    const prismOff = nrmOff + nrms.length * 12;
    const blockOff = prismOff + prisms.length * 0x10;

    const w = new BinWriter(blockOff + treeBytes.length + 16);
    w.u32(posOff).u32(nrmOff).u32(prismOff - 0x10).u32(blockOff);
    w.f32(opt.prismThickness);
    w.f32(areaMin[0]).f32(areaMin[1]).f32(areaMin[2]);
    w.u32(~((1 << shifts[0]) - 1) >>> 0)
        .u32(~((1 << shifts[1]) - 1) >>> 0)
        .u32(~((1 << shifts[2]) - 1) >>> 0);
    w.u32(blockShift).u32(xShift).u32(xyShift);
    w.f32(opt.sphereRadius);
    if (w.pos !== HEADER) throw new Error('header size');
    for (const v of verts) w.f32(v[0]).f32(v[1]).f32(v[2]);
    for (const v of nrms) w.f32(v[0]).f32(v[1]).f32(v[2]);
    for (const p of prisms) w.f32(p.height).u16(p.posI).u16(p.fnrmI).u16(p.e1I).u16(p.e2I).u16(p.e3I).u16(p.attr);
    w.bytes(treeBytes);

    return {
        bytes: w.finish(),
        prismCount: prisms.length,
        vertexCount: verts.length,
        normalCount: nrms.length,
        leafCount,
        maxLeafTris,
        areaMin,
        areaShift: shifts,
        blockShift,
    };
}

function add(a: V3, b: V3): V3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
