/**
 * The drivable road of the San Francisco course, drawn from course_meta.json's centerline stations
 * (lateral edges per station), matching the KCL collision exactly: asphalt with lane markings,
 * shoulders/sidewalks, and the barriers at the walls: textured asphalt (mottled wear, tar snakes,
 * grit normal map, worn lane paint), concrete sidewalks, concrete K-rail barriers with a reflective
 * orange top stripe.
 */

import * as THREE from 'three';

export interface Station {
    s: number;
    pos: [number, number, number];
    right: [number, number, number];
    edges: { wallL: number; roadL: number; roadR: number; wallR: number; island: number };
    walls: [boolean, boolean];
    bankDeg?: number;
}

export interface RoadMeta {
    centerline: Station[];
    features?: { type: string; s?: number[]; side?: string }[];
    crossSection?: { wallHeight?: number };
    segments?: Record<string, [number, number]>;
}

function asphaltTexture(): THREE.CanvasTexture {
    // One repeat spans the road's width (u = 1 at the left edge) and 1600 units (~27 m) along it.
    const W = 1024;
    const H = 1024;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // Draws at y and wrapped around the repeat, so the texture tiles along the road.
    const wrapped = (f: (dy: number) => void) => [-H, 0, H].forEach(f);
    g.fillStyle = '#3c3d40';
    g.fillRect(0, 0, W, H);
    // Mottling (older and newer asphalt, wear): metre-scale blotches that survive mipmapping, so
    // the road doesn't go flat grey in the distance.
    for (let k = 0; k < 320; ++k) {
        const x = rnd() * W;
        const y = rnd() * H;
        const r = 20 + rnd() * 110;
        const l = rnd() < 0.5 ? 92 : 22;
        const a = 0.05 + rnd() * 0.09;
        wrapped((dy) => {
            const grad = g.createRadialGradient(x, y + dy, 0, x, y + dy, r);
            grad.addColorStop(0, `rgba(${l},${l},${l + 2},${a})`);
            grad.addColorStop(1, `rgba(${l},${l},${l + 2},0)`);
            g.fillStyle = grad;
            g.fillRect(x - r, y + dy - r, 2 * r, 2 * r);
        });
    }
    // Per lane: a dark oil strip down the middle, lighter polished wheel paths either side.
    for (const u of [1 / 6, 1 / 2, 5 / 6]) {
        const band = (c: number, d: number, w: number, a: number) => {
            const x0 = (u + d - w) * W;
            const grad = g.createLinearGradient(x0, 0, x0 + 2 * w * W, 0);
            grad.addColorStop(0, `rgba(${c},${c},${c},0)`);
            grad.addColorStop(0.5, `rgba(${c},${c},${c},${a})`);
            grad.addColorStop(1, `rgba(${c},${c},${c},0)`);
            g.fillStyle = grad;
            g.fillRect(x0, 0, 2 * w * W, H);
        };
        band(12, 0, 0.035, 0.22);
        for (const d of [-0.075, 0.075]) band(110, d, 0.03, 0.07);
    }
    // Tar snakes: sealed cracks, meandering thin dark lines.
    g.lineCap = 'round';
    for (let k = 0; k < 16; ++k) {
        let x = rnd() * W;
        let y = rnd() * H;
        let dir = rnd() * Math.PI * 2;
        const pts: [number, number][] = [[x, y]];
        for (let n = 0; n < 8 + rnd() * 16; ++n) {
            dir += (rnd() - 0.5) * 1.2;
            x += Math.cos(dir) * 14;
            y += Math.sin(dir) * 14;
            pts.push([x, y]);
        }
        g.strokeStyle = 'rgba(16,16,18,0.6)';
        g.lineWidth = 2 + rnd() * 2;
        wrapped((dy) => {
            g.beginPath();
            pts.forEach(([px, py], i) => (i ? g.lineTo(px, py + dy) : g.moveTo(px, py + dy)));
            g.stroke();
        });
    }
    // Paint: yellow edge line on the left, white on the right, dashed lane lines (5 m dashes).
    g.fillStyle = 'rgba(236,196,62,0.95)';
    g.fillRect(W * 0.972, 0, W * 0.014, H);
    g.fillStyle = 'rgba(242,242,236,0.95)';
    g.fillRect(W * 0.014, 0, W * 0.014, H);
    for (const u of [1 / 3, 2 / 3]) for (let y = 0; y < H; y += 512) g.fillRect(u * W - W * 0.007, y, W * 0.014, 192);
    // Aggregate: per-pixel grain with the odd bright stone and dark pit (also wears the paint).
    const img = g.getImageData(0, 0, W, H);
    for (let k = 0; k < img.data.length; k += 4) {
        const r = rnd();
        const n = (rnd() - 0.5) * 22 + (r < 0.015 ? 34 : r > 0.98 ? -24 : 0);
        img.data[k] = img.data[k]! + n;
        img.data[k + 1] = img.data[k + 1]! + n;
        img.data[k + 2] = img.data[k + 2]! + n * 1.04;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 16;
    t.generateMipmaps = true;
    return t;
}

/** Tileable normal map of asphalt grit: catches the low sun (sparkle and sheen at kart height). */
function gritNormalTexture(): THREE.CanvasTexture {
    const N = 256;
    const h = new Float32Array(N * N);
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < N * N; ++k) h[k] = rnd();
    // Stones: a few raised bumps a couple of pixels across.
    for (let k = 0; k < 2600; ++k) {
        const x = Math.floor(rnd() * N);
        const y = Math.floor(rnd() * N);
        const a = 1 + rnd() * 2;
        for (let dy = -1; dy <= 1; ++dy) for (let dx = -1; dx <= 1; ++dx) h[((y + dy + N) % N) * N + ((x + dx + N) % N)]! += a * (dx || dy ? 0.5 : 1);
    }
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(N, N);
    const n = new THREE.Vector3();
    for (let y = 0; y < N; ++y)
        for (let x = 0; x < N; ++x) {
            const dx = h[y * N + ((x + 1) % N)]! - h[y * N + ((x - 1 + N) % N)]!;
            const dy = h[((y + 1) % N) * N + x]! - h[((y - 1 + N) % N) * N + x]!;
            n.set(-dx * 0.5, -dy * 0.5, 1).normalize();
            const k = (y * N + x) * 4;
            img.data[k] = (n.x * 0.5 + 0.5) * 255;
            img.data[k + 1] = (n.y * 0.5 + 0.5) * 255;
            img.data[k + 2] = (n.z * 0.5 + 0.5) * 255;
            img.data[k + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // ~1.7 m tiles across a ~35 m road and along 1600 units.
    t.repeat.set(20, 16);
    t.anisotropy = 8;
    return t;
}

/**
 * Barrier paint: v runs up the barrier's face (see WALL_V), u along the road (900 units per
 * repeat). Road-work K-rail: concrete below; the top band pale concrete with a Signal Orange
 * reflective stripe and an amber reflector per segment (the game-piece kit), so the track edge
 * reads at speed.
 */
function barrierTexture(): THREE.CanvasTexture {
    const W = 256;
    const H = 256;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // Canvas y = (1 - v) * H.
    const y = (v: number) => (1 - v) * H;
    g.fillStyle = '#c4c0b6';
    g.fillRect(0, 0, W, H);
    // Grime towards the foot.
    const grad = g.createLinearGradient(0, y(0), 0, y(0.3));
    grad.addColorStop(0, 'rgba(70,64,56,0.45)');
    grad.addColorStop(1, 'rgba(70,64,56,0)');
    g.fillStyle = grad;
    g.fillRect(0, y(0.3), W, y(0) - y(0.3));
    // Painted band: the upper face and the top.
    const b0 = y(WALL_V.band);
    const b1 = y(WALL_V.back);
    g.fillStyle = '#e4e0d6';
    g.fillRect(0, b1, W, b0 - b1);
    g.fillStyle = '#ff6a1f';
    g.fillRect(0, b1 + (b0 - b1) * 0.2, W, (b0 - b1) * 0.35);
    // An amber reflector on the stripe, one per segment.
    g.fillStyle = '#ffd23f';
    g.fillRect(W * 0.46, b1 + (b0 - b1) * 0.22, W * 0.08, (b0 - b1) * 0.31);
    // A thin dark line under the band.
    g.fillStyle = 'rgba(30,30,30,0.5)';
    g.fillRect(0, b0, W, 2);
    // A joint between barrier segments every 15 m.
    g.fillStyle = 'rgba(40,38,34,0.45)';
    g.fillRect(0, 0, 2, H);
    const img = g.getImageData(0, 0, W, H);
    for (let k = 0; k < img.data.length; k += 4) {
        const n = (rnd() - 0.5) * 16;
        img.data[k] = img.data[k]! + n;
        img.data[k + 1] = img.data[k + 1]! + n;
        img.data[k + 2] = img.data[k + 2]! + n;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    return t;
}

/** Barrier texture rows (v, 0 at the foot, 1 at the back's foot): painted from `band` up over the top edge to `back`. */
const WALL_V = { band: 0.5, top: 0.72, back: 0.86 };

function concreteTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#b9b6ae';
    g.fillRect(0, 0, 256, 256);
    const img = g.getImageData(0, 0, 256, 256);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < img.data.length; k += 4) {
        const n = (rnd() - 0.5) * 18;
        img.data[k] = img.data[k]! + n;
        img.data[k + 1] = img.data[k + 1]! + n;
        img.data[k + 2] = img.data[k + 2]! + n;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(80,80,80,0.35)';
    g.fillRect(0, 0, 256, 3);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

export interface RoadMeshes {
    group: THREE.Group;
    dispose(): void;
}

/**
 * `lowWall(s)`: stretches (e.g. the bridge decks) where the barrier is drawn as a low kerb because
 * something else (the bridge railing) is drawn there. `ownWall(s)`: stretches whose barriers a
 * section module (sections/) draws itself, so none here.
 */
export function buildRoad(meta: RoadMeta, lowWall: (s: number) => boolean = () => false, ownWall: (s: number) => boolean = () => false): RoadMeshes {
    const cl = meta.centerline;
    const N = cl.length;
    const wallH = meta.crossSection?.wallHeight ?? 400;
    const road: number[] = [];
    const roadUv: number[] = [];
    const shoulder: number[] = [];
    const shoulderUv: number[] = [];
    const wall: number[] = [];
    const wallUv: number[] = [];
    const LIFT = 3;

    const at = (st: Station, off: number, dy = 0): [number, number, number] => {
        // right[] points to the driver's right; offsets are positive to the left.
        return [st.pos[0] - st.right[0] * off, st.pos[1] + dy + LIFT, st.pos[2] - st.right[2] * off];
    };
    const quad = (arr: number[], uv: number[], a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) => {
        // a b (station i: left, right) / c d (station i+1: left, right) → triangles a b c, b d c
        // (facing up: right x forward = +Y in the engine's frame, where +X is the driver's left facing +Z).
        arr.push(...a, ...b, ...c, ...b, ...d, ...c);
        uv.push(...ua, ...ub, ...uc, ...ub, ...ud, ...uc);
    };

    // No road over the jump gaps (the KCL has no floor there).
    const gaps = (meta.features ?? []).filter((f) => f.type === 'gap' && f.s).map((f) => f.s as [number, number]);
    // No shoulder under a half-pipe (its surface lies on the shoulder strip, flush at the foot).
    const pipes = (meta.features ?? []).filter((f) => f.type === 'halfpipe' && f.s).map((f) => ({ s: f.s as [number, number], side: f.side === 'left' ? 1 : -1 }));
    const piped = (s: number, side: number) => pipes.some((p) => p.side === side && s > p.s[0] && s < p.s[1]);
    for (let i = 0; i < N; ++i) {
        const A = cl[i]!;
        const B = cl[(i + 1) % N]!;
        const sA = A.s;
        const sB = i + 1 < N ? B.s : A.s + Math.hypot(B.pos[0] - A.pos[0], B.pos[2] - A.pos[2]);
        if (gaps.some(([g0, g1]) => (sA + sB) / 2 > g0 && (sA + sB) / 2 < g1)) continue;
        const vA = sA / 1600;
        const vB = sB / 1600;
        // Asphalt: roadL → roadR, u = 1 at the left edge; in six strips so the lane lines (at the
        // strip edges) stay straight through curves instead of kinking at each quad's diagonal.
        for (let k = 0; k < 6; ++k) {
            const u0 = 1 - k / 6;
            const u1 = 1 - (k + 1) / 6;
            const oA = (u: number) => A.edges.roadR + (A.edges.roadL - A.edges.roadR) * u;
            const oB = (u: number) => B.edges.roadR + (B.edges.roadL - B.edges.roadR) * u;
            quad(road, roadUv, at(A, oA(u0)), at(A, oA(u1)), at(B, oB(u0)), at(B, oB(u1)), [u0, vA], [u1, vA], [u0, vB], [u1, vB]);
        }
        // Shoulders.
        for (const side of [1, -1] as const) {
            const [inA, outA, inB, outB] =
                side === 1 ? [A.edges.roadL, A.edges.wallL, B.edges.roadL, B.edges.wallL] : [A.edges.roadR, A.edges.wallR, B.edges.roadR, B.edges.wallR];
            if ((Math.abs(outA - inA) < 5 && Math.abs(outB - inB) < 5) || piped((sA + sB) / 2, side)) continue;
            quad(shoulder, shoulderUv, at(A, outA, 1), at(A, inA, 1), at(B, outB, 1), at(B, inB, 1), [0, sA / 400], [(outA - inA) / 400, sA / 400], [0, sB / 400], [(outB - inB) / 400, sB / 400]);
        }
        // Barriers: a sloped jersey profile (base 90 wide, top 40) standing just outside the wall line.
        for (const side of [1, -1] as const) {
            if (!A.walls[side === 1 ? 0 : 1] || ownWall((sA + sB) / 2)) continue;
            const oA = side === 1 ? A.edges.wallL : A.edges.wallR;
            const oB = side === 1 ? B.edges.wallL : B.edges.wallR;
            const base = 0;
            const top = side * 40;
            const back = side * 90;
            // [offset, height, texture v] at a station; the sloped face is split where the painted
            // band starts. Low kerbs (under the bridge railing) stay bare concrete. Heights are per
            // station, so where a full barrier meets a low kerb it ramps down over one station gap
            // (like a barrier's sloped end) instead of stopping in an open step.
            const prof = (s: number): [number, number, number][] => {
                const low = lowWall(s);
                const h = low ? 60 : Math.min(wallH, 230);
                const pv = (v: number) => (low ? v * WALL_V.band * 0.9 : v);
                return [
                    [base, 0, 0],
                    [base + side * 12, h * 0.25, pv(0.28)],
                    [base + side * 26, h * 0.625, pv(WALL_V.band)],
                    [top, h, pv(WALL_V.top)],
                    [back, h, pv(WALL_V.back)],
                    [back, -40, pv(1)],
                ];
            };
            const pa = prof(sA);
            const pb = prof(sB);
            for (let k = 0; k + 1 < pa.length; ++k) {
                const [a0, ya0, va0] = pa[k]!;
                const [a1, ya1, va1] = pa[k + 1]!;
                const [, yb0, vb0] = pb[k]!;
                const [, yb1, vb1] = pb[k + 1]!;
                quad(wall, wallUv, at(A, oA + a0, ya0), at(A, oA + a1, ya1), at(B, oB + a0, yb0), at(B, oB + a1, yb1), [sA / 900, va0], [sA / 900, va1], [sB / 900, vb0], [sB / 900, vb1]);
            }
        }
    }

    const mk = (pos: number[], uv: number[]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.computeVertexNormals();
        return g;
    };
    const roadGeo = mk(road, roadUv);
    const shoulderGeo = mk(shoulder, shoulderUv);
    const wallGeo = mk(wall, wallUv);

    const mats = {
        // Rough enough to stay matte overhead, smooth enough for a sheen towards the low sun.
        road: new THREE.MeshStandardMaterial({
            map: asphaltTexture(),
            normalMap: gritNormalTexture(),
            normalScale: new THREE.Vector2(0.22, 0.22),
            roughness: 0.78,
            metalness: 0,
        }),
        shoulder: new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95, color: 0xa8a49c, side: THREE.DoubleSide }),
        wall: new THREE.MeshStandardMaterial({ map: barrierTexture(), roughness: 0.8, side: THREE.DoubleSide }),
    };
    const roadMesh = new THREE.Mesh(roadGeo, mats.road);
    const shoulderMesh = new THREE.Mesh(shoulderGeo, mats.shoulder);
    const wallMesh = new THREE.Mesh(wallGeo, mats.wall);
    for (const m of [roadMesh, shoulderMesh, wallMesh]) {
        m.receiveShadow = true;
        m.frustumCulled = false;
    }
    wallMesh.castShadow = true;
    const group = new THREE.Group();
    group.name = 'road';
    group.add(roadMesh, shoulderMesh, wallMesh);
    return {
        group,
        dispose() {
            for (const g of [roadGeo, shoulderGeo, wallGeo]) g.dispose();
            for (const m of Object.values(mats)) {
                m.map?.dispose();
                m.normalMap?.dispose();
                m.dispose();
            }
        },
    };
}
