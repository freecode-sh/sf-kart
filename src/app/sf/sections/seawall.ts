/**
 * Marine Drive's seawall and surf: wherever the road runs along the water between Crissy Field and
 * Long Avenue (Marine Drive both ways, the Fort Point loop), a granite seawall drops from the road's
 * edge into the bay — covering the terrain's fill slope, which reads as a smear of aerial photo — with
 * a walkway on top and a band of animated surf at its foot. Along the Fort Point half-pipe the pipe's
 * own retaining wall is the seawall (sections/halfpipe.ts); the surf runs along it too.
 */

import * as THREE from 'three';
import type { Station } from '../road';

/** Seawall cross-section, measured out from the wall line: walkway, then the face. */
const WALK_IN = 90;
const FACE = 270;
/** The half-pipe's retaining wall stands this far out from the wall line. */
const PIPE_FACE = 370;
/** Surf band width (out from the face). */
const SURF_W = 380;

function graniteTexture(): THREE.CanvasTexture {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#8a857c';
    g.fillRect(0, 0, S, S);
    let seed = 17;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // Ashlar courses in running bond, each block its own shade.
    const bh = 32;
    const bw = 64;
    for (let r = 0; r < S / bh; ++r)
        for (let c = -1; c < S / bw + 1; ++c) {
            const x = c * bw + (r % 2 ? bw / 2 : 0);
            const v = 172 + Math.floor(rnd() * 34);
            g.fillStyle = `rgb(${v + 6},${v + 2},${v - 6})`;
            g.fillRect(x + 1.5, r * bh + 1.5, bw - 3, bh - 3);
        }
    const img = g.getImageData(0, 0, S, S);
    for (let k = 0; k < img.data.length; k += 4) {
        const n = (rnd() - 0.5) * 22;
        img.data[k] = img.data[k]! + n;
        img.data[k + 1] = img.data[k + 1]! + n;
        img.data[k + 2] = img.data[k + 2]! + n;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

/** Foam: dense at the wall (v = 0, canvas bottom), breaking up into streaks and flecks further out. */
function surfTexture(): THREE.CanvasTexture {
    const W = 512;
    const Ht = 128;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = Ht;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, Ht);
    let seed = 5;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const grad = g.createLinearGradient(0, Ht, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.12, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, Ht);
    for (let k = 0; k < 900; ++k) {
        const d = Math.pow(rnd(), 1.8);
        const y = Ht - d * Ht;
        const x = rnd() * W;
        g.fillStyle = `rgba(255,255,255,${(0.75 * (1 - d)).toFixed(3)})`;
        g.beginPath();
        g.ellipse(x, y, 4 + rnd() * 18 * (1 - d), 1.5 + rnd() * 3, 0, 0, Math.PI * 2);
        g.fill();
        // Wrap the flecks round the seam.
        if (x > W - 22) {
            g.beginPath();
            g.ellipse(x - W, y, 4 + rnd() * 18 * (1 - d), 1.5 + rnd() * 3, 0, 0, Math.PI * 2);
            g.fill();
        }
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
}

export interface SeawallMeshes {
    group: THREE.Group;
    update(t: number): void;
    dispose(): void;
}

export function buildSeawall(
    cl: Station[],
    range: [number, number],
    pipes: { s: [number, number]; side: 1 | -1 }[],
    groundY: (x: number, z: number) => number,
    seaY: number,
): SeawallMeshes {
    const at = (st: Station, off: number, y: number): [number, number, number] => [st.pos[0] - st.right[0] * off, y, st.pos[2] - st.right[2] * off];
    const wallOf = (st: Station, side: 1 | -1) => (side === 1 ? st.edges.wallL : st.edges.wallR);
    // (Exactly the pipe's range: the pipe's end caps close its body where the seawall takes over.)
    const piped = (st: Station, side: 1 | -1) => pipes.some((p) => p.side === side && st.s > p.s[0] + 1 && st.s < p.s[1] - 1);
    /** The road runs along the water on this side: low ground at sea level just beyond the wall. */
    const seaSide = (st: Station, side: 1 | -1): boolean => {
        if (!st.walls[side === 1 ? 0 : 1]) return false;
        const w = wallOf(st, side);
        let low = 0;
        for (const k of [500, 900]) {
            const [x, , z] = at(st, w + side * k, 0);
            const g = groundY(x, z);
            if (g < st.pos[1] - 150 && g < seaY + 150) ++low;
        }
        return low === 2;
    };

    const face: number[] = [];
    const faceUv: number[] = [];
    const faceCol: number[] = [];
    const walk: number[] = [];
    const walkUv: number[] = [];
    const surf: number[] = [];
    const surfUv: number[] = [];
    const bottom = seaY - 240;
    /** Wet, darker stone up to ~1.5 m above the water, dry above. */
    const shade = (y: number) => {
        const t = Math.max(0, Math.min(1, (y - seaY - 20) / 90));
        return [0.5 + 0.5 * t, 0.53 + 0.47 * t, 0.5 + 0.5 * t];
    };
    const tri6 = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => arr.push(...a, ...b, ...c, ...b, ...d, ...c);
    const sts = cl.filter((c) => c.s >= range[0] && c.s <= range[1]);
    for (let i = 0; i + 1 < sts.length; ++i) {
        const A = sts[i]!;
        const B = sts[i + 1]!;
        for (const side of [1, -1] as const) {
            if (!seaSide(A, side) || !seaSide(B, side)) continue;
            const wa = wallOf(A, side);
            const wb = wallOf(B, side);
            const pipe = piped(A, side) || piped(B, side);
            const f = pipe ? PIPE_FACE - 40 : FACE;
            if (!pipe) {
                // Walkway on top, then the face down into the bay.
                const ya = A.pos[1] + 2;
                const yb = B.pos[1] + 2;
                tri6(walk, at(A, wa + side * WALK_IN, ya), at(A, wa + side * f, ya), at(B, wb + side * WALK_IN, yb), at(B, wb + side * f, yb));
                walkUv.push(A.s / 400, 0, A.s / 400, 0.5, B.s / 400, 0, A.s / 400, 0.5, B.s / 400, 0.5, B.s / 400, 0);
                const pa = at(A, wa + side * f, ya);
                const pb = at(B, wb + side * f, yb);
                const qa = at(A, wa + side * f, bottom);
                const qb = at(B, wb + side * f, bottom);
                tri6(face, pa, qa, pb, qb);
                for (const [p, s] of [
                    [pa, A.s],
                    [qa, A.s],
                    [pb, B.s],
                    [qa, A.s],
                    [qb, B.s],
                    [pb, B.s],
                ] as const) {
                    faceUv.push(s / 640, p[1] / 360);
                    faceCol.push(...shade(p[1]));
                }
            }
            // Surf at the foot of the wall.
            const y = seaY + 5;
            tri6(surf, at(A, wa + side * f, y), at(A, wa + side * (f + SURF_W), y), at(B, wb + side * f, y), at(B, wb + side * (f + SURF_W), y));
            surfUv.push(A.s / 2400, 0, A.s / 2400, 1, B.s / 2400, 0, A.s / 2400, 1, B.s / 2400, 1, B.s / 2400, 0);
        }
    }

    const granite = graniteTexture();
    const foam = surfTexture();
    const mats = {
        face: new THREE.MeshStandardMaterial({ map: granite, vertexColors: true, roughness: 0.88, side: THREE.DoubleSide }),
        walk: new THREE.MeshStandardMaterial({ color: 0xbdb6a8, roughness: 0.95, side: THREE.DoubleSide }),
        surf: new THREE.MeshStandardMaterial({ color: 0xf4f7f8, alphaMap: foam, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    const group = new THREE.Group();
    group.name = 'seawall';
    const meshes: THREE.Mesh[] = [];
    const add = (slot: keyof typeof mats, pos: number[], uv: number[], col?: number[]) => {
        if (!pos.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, mats[slot]);
        m.receiveShadow = slot !== 'surf';
        m.renderOrder = slot === 'surf' ? 1 : 0;
        meshes.push(m);
        group.add(m);
    };
    add('face', face, faceUv, faceCol);
    add('walk', walk, walkUv);
    add('surf', surf, surfUv);
    return {
        group,
        update(t) {
            // Drift along the wall and surge in and out.
            foam.offset.set(t * 0.012, -0.06 + 0.06 * Math.sin(t * 0.9));
        },
        dispose() {
            for (const mesh of meshes) mesh.geometry.dispose();
            granite.dispose();
            foam.dispose();
            for (const m of Object.values(mats)) m.dispose();
        },
    };
}
