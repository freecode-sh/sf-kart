/**
 * Dash panels (course_meta 'dashPanel' features), drawn as Boost Lanes: a Boost Green strip laid in
 * the asphalt with white painted chevrons, a glow pulse running forward and a faint green glow on
 * the road around it (padMaterial.ts). Built on the centerline stations like the road ribbon
 * (road.ts), so each panel lies on the sloped road exactly where the KCL's boost panel is; one draw
 * call for all the panels and one for their glow.
 */

import * as THREE from 'three';
import { PAD_LOOKS, PIECE_COLORS, padGlowMaterial, padMaterial, padTime } from './padMaterial';
import type { Station } from './road';

interface PanelFeature {
    type: string;
    s?: number[];
    lat?: number[];
}

/** Glow margin around each panel (world units). */
const GLOW = 120;

export interface DashPanels {
    group: THREE.Group;
    update(timeSec: number): void;
    dispose(): void;
}

/** `skip(s)`: stretches whose dash panels a section module draws itself. */
export function buildDashPanels(meta: { centerline: Station[]; features?: PanelFeature[] }, skip: (s: number) => boolean = () => false): DashPanels {
    const cl = meta.centerline;
    // Station index at or before S (binary search).
    const indexAt = (S: number) => {
        let lo = 0;
        let hi = cl.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (cl[mid]!.s <= S) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };
    // Point at S, lateral offset `off` (positive to the left, like road.ts), `dy` above the road.
    const at = (S: number, off: number, dy: number): [number, number, number] => {
        const i = Math.min(indexAt(S), cl.length - 2);
        const A = cl[i]!;
        const B = cl[i + 1]!;
        const t = Math.max(0, Math.min(1, (S - A.s) / (B.s - A.s)));
        const px = A.pos[0] + (B.pos[0] - A.pos[0]) * t;
        const py = A.pos[1] + (B.pos[1] - A.pos[1]) * t;
        const pz = A.pos[2] + (B.pos[2] - A.pos[2]) * t;
        const rx = A.right[0] + (B.right[0] - A.right[0]) * t;
        const rz = A.right[2] + (B.right[2] - A.right[2]) * t;
        const rl = Math.hypot(rx, rz) || 1;
        return [px - (rx / rl) * off, py + dy, pz - (rz / rl) * off];
    };

    const build = (margin: number, dy: number) => {
        const pos: number[] = [];
        const uv: number[] = [];
        const size: number[] = [];
        for (const f of meta.features ?? []) {
            if (f.type !== 'dashPanel' || !f.s || !f.lat || skip((f.s[0]! + f.s[1]!) / 2)) continue;
            const [s0, s1] = f.s as [number, number];
            const [l0, l1] = f.lat as [number, number];
            const w = l1 - l0;
            const len = s1 - s0;
            // Cut along the pad at every station it crosses, so it follows the road's grade.
            const cuts = [s0 - margin];
            for (const c of cl) if (c.s > s0 - margin && c.s < s1 + margin) cuts.push(c.s);
            cuts.push(s1 + margin);
            for (let k = 0; k + 1 < cuts.length; ++k) {
                const a = cuts[k]!;
                const b = cuts[k + 1]!;
                // u = 0 at the right edge (lat l0), v = 0 at the back.
                const ua = -margin / w;
                const ub = 1 + margin / w;
                const va = (a - s0) / len;
                const vb = (b - s0) / len;
                const pa0 = at(a, l0 - margin, dy);
                const pa1 = at(a, l1 + margin, dy);
                const pb0 = at(b, l0 - margin, dy);
                const pb1 = at(b, l1 + margin, dy);
                // Facing up (see road.ts: a b c, b d c with a/b = left/right at the first station).
                pos.push(...pa1, ...pa0, ...pb1, ...pa0, ...pb0, ...pb1);
                uv.push(ub, va, ua, va, ub, vb, ua, va, ua, vb, ub, vb);
                for (let q = 0; q < 6; ++q) size.push(w, len);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute('padSize', new THREE.Float32BufferAttribute(size, 2));
        g.computeBoundingSphere();
        return g;
    };

    const group = new THREE.Group();
    group.name = 'dashPanels';
    const padGeo = build(0, 6);
    const glowGeo = build(GLOW, 5);
    const padMat = padMaterial(PAD_LOOKS.dash);
    const glowMat = padGlowMaterial(PIECE_COLORS.boostGreen, GLOW);
    const pads = new THREE.Mesh(padGeo, padMat);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    pads.receiveShadow = false;
    glow.renderOrder = 1;
    group.add(glow, pads);
    return {
        group,
        update(timeSec) {
            padTime.value = timeSec;
        },
        dispose() {
            padGeo.dispose();
            glowGeo.dispose();
            padMat.dispose();
            glowMat.dispose();
        },
    };
}
