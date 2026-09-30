/**
 * Boost Lanes up the half-pipes' faces: Boost Green strips painted from the foot to just under the
 * lip, white chevrons and a glow pulse running up them (padMaterial.ts, the dash panels' look), so
 * a pipe reads as "ride up this wall for a boost". The engine gives it for leaving the lip and
 * landing back in the pipe (KartHalfPipe: OverZipper, then end(true) → activateZipperBoost; twice
 * as long with a trick in the air).
 *
 * Laid only where the pipe stands at (nearly) full height, where a kart can launch, spaced between
 * the painted numbers (halfpipe.ts's tile). Cut from the pipe's own surface triangles, so they lie
 * exactly on the curve; one draw call for all of them.
 *
 *   const lanes = buildPipeLanes(surface, s, v, features);   // per-vertex position, S, v (0 foot → 1 lip)
 */

import * as THREE from 'three';
import { PAD_LOOKS, padMaterial } from '../padMaterial';
import type { PipeFeature } from './halfpipe';

/** Lane width, and spacing along the pipe (half the numbers' tile: one lane between each pair). */
const WIDTH = 700;
const SPACING = 2200;
/** First lane centre in the tile (the numbers sit at 550 and 2750 of 4400). */
const PHASE = 1650;
/** From just above the foot's transition to just under the orange stripe (v, see halfpipe.ts). */
const V0 = 0.06;
const V1 = 0.9;
/** Approximate face length foot → lip (a 700-high quarter pipe over the ~350-wide shoulder). */
const FACE = 850;
/** Share of each run-in (from its start) where the pipe is too low to launch: no lanes there. */
const RUN_IN = 0.8;

type Vert = { p: [number, number, number]; s: number; v: number };

/** Clips a convex polygon to f(vertex) >= 0 (f linear in the vertex's attributes). */
function clip(poly: Vert[], f: (a: Vert) => number): Vert[] {
    const out: Vert[] = [];
    for (let i = 0; i < poly.length; ++i) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const fa = f(a);
        const fb = f(b);
        if (fa >= 0) out.push(a);
        if (fa >= 0 !== fb >= 0) {
            const t = fa / (fa - fb);
            out.push({
                p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
                s: a.s + (b.s - a.s) * t,
                v: a.v + (b.v - a.v) * t,
            });
        }
    }
    return out;
}

/** `pos`: the pipe surface's triangles (xyz per vertex); `s`, `v`: each vertex's S and height fraction. */
export function buildPipeLanes(pos: number[], s: number[], v: number[], features: PipeFeature[]): { mesh: THREE.Mesh; dispose(): void } | null {
    // Lane centres on each pipe's launchable stretch.
    const lanes: number[] = [];
    for (const f of features) {
        const e = (f.ease ?? 0) * RUN_IN;
        const a = f.s[0] + e + WIDTH / 2;
        const b = f.s[1] - e - WIDTH / 2;
        for (let c = Math.ceil((a - PHASE) / SPACING) * SPACING + PHASE; c <= b; c += SPACING) lanes.push(c);
    }
    const out: number[] = [];
    const uv: number[] = [];
    const size: number[] = [];
    for (let t = 0; t + 2 < s.length; t += 3) {
        const tri: Vert[] = [0, 1, 2].map((k) => ({ p: [pos[(t + k) * 3]!, pos[(t + k) * 3 + 1]!, pos[(t + k) * 3 + 2]!], s: s[t + k]!, v: v[t + k]! }));
        const lo = Math.min(tri[0]!.s, tri[1]!.s, tri[2]!.s);
        const hi = Math.max(tri[0]!.s, tri[1]!.s, tri[2]!.s);
        for (const c of lanes) {
            const s0 = c - WIDTH / 2;
            const s1 = c + WIDTH / 2;
            if (hi < s0 || lo > s1) continue;
            let poly = clip(tri, (q) => q.s - s0);
            poly = clip(poly, (q) => s1 - q.s);
            poly = clip(poly, (q) => q.v - V0);
            poly = clip(poly, (q) => V1 - q.v);
            // Fan (the clipped polygon is convex); u across the lane, v up it (padMaterial's layout).
            for (let k = 1; k + 1 < poly.length; ++k)
                for (const q of [poly[0]!, poly[k]!, poly[k + 1]!]) {
                    out.push(...q.p);
                    uv.push((q.s - s0) / WIDTH, (q.v - V0) / (V1 - V0));
                    size.push(WIDTH, FACE * (V1 - V0));
                }
        }
    }
    if (!out.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('padSize', new THREE.Float32BufferAttribute(size, 2));
    g.computeBoundingSphere();
    const mat = padMaterial(PAD_LOOKS.pipeLane, { side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'pipeLanes';
    return {
        mesh,
        dispose() {
            g.dispose();
            mat.dispose();
        },
    };
}
