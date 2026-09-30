/**
 * The speed-up pickups' gameplay: where the rows are, the pickup test and the respawn. Plain math
 * (deterministic by kart position and frame), shared by the app (itemBoxes.ts draws them), the
 * bots and the leaderboard's run verifier (src/app/run/verify.ts), so a run replays exactly.
 */

import * as THREE from 'three';
import type { Station } from './road';

/** Frames a collected pickup stays away (4 s). */
const RESPAWN_FRAMES = 240;
/** Pickup centre's height above the road (a kart is ~200 units long; the pickups ~230 tall). */
export const HOVER = 150;
/** Pickup: kart centre to pickup centre, horizontally and vertically. */
const RADIUS = 210;
const REACH_Y = 320;
/** Pickups in a row are at most this far apart (2 x RADIUS), so any line through the row gets one. */
const MAX_GAP = 2 * RADIUS;
/** Pickup centres stay this far inside the road edge. */
const EDGE_MARGIN = 250;

export type XYZ = { x: number; y: number; z: number };

/**
 * The pickup rows' S positions, every ~10-15 s of the lap: at the start of straights (not
 * mid-corner), clear of the ramps' flights and landings (see botlap's airtimes) and of the
 * half-pipes and tunnels.
 */
export function pickupRows(seg: Record<string, [number, number]>): number[] {
    const at = (name: string, frac: number) => (seg[name] ? seg[name]![0] + (seg[name]![1] - seg[name]![0]) * frac : null);
    return [
        at('crissy', 0.7),
        at('marine_w', 0.6),
        at('marine_e', 0.45),
        at('plaza_nb', 0.2),
        at('bridge_nb', 0.36),
        at('bridge_nb', 0.76),
        at('vista', 0.8),
        at('bridge_sb', 0.3),
        at('bridge_sb', 0.8),
        at('parkway', 0.1),
        at('parkway', 0.66),
        at('palace', 0.62),
        at('marina', 0.6),
    ].filter((v): v is number => v !== null);
}

/** The centerline interpolated at S: road point, right vector and the road edges. */
function sampleAt(centerline: Station[], S: number): { pos: THREE.Vector3; right: THREE.Vector3; roadL: number; roadR: number; island: number } {
    let i = 0;
    while (i < centerline.length - 2 && centerline[i + 1]!.s <= S) ++i;
    const a = centerline[i]!;
    const b = centerline[i + 1] ?? a;
    const t = b.s > a.s ? THREE.MathUtils.clamp((S - a.s) / (b.s - a.s), 0, 1) : 0;
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
        pos: new THREE.Vector3(lerp(a.pos[0], b.pos[0]), lerp(a.pos[1], b.pos[1]), lerp(a.pos[2], b.pos[2])),
        right: new THREE.Vector3(lerp(a.right[0], b.right[0]), 0, lerp(a.right[2], b.right[2])).normalize(),
        roadL: lerp(a.edges.roadL, b.edges.roadL),
        roadR: lerp(a.edges.roadR, b.edges.roadR),
        island: Math.max(a.edges.island, b.edges.island),
    };
}

/**
 * The pickups' layout and state: where they are, which are away and since when. `check` after each
 * game frame; `reset` when the race restarts.
 */
export class PickupField {
    /** Pickup centres (resting, before the bob). */
    readonly pos: THREE.Vector3[] = [];
    /** Frame each pickup comes back (0 = present) and the frame it was collected. */
    readonly away: number[] = [];
    readonly hitAt: number[] = [];

    /** `rows`: S positions of the pickup rows (each row spans the road). */
    constructor(centerline: Station[], rows: number[]) {
        for (const S of rows) {
            const st = sampleAt(centerline, S);
            const mid = (st.roadL + st.roadR) / 2;
            const half = (st.roadL - st.roadR) / 2 - EDGE_MARGIN;
            const n = Math.max(2, Math.ceil((2 * half) / MAX_GAP) + 1);
            for (let k = 0; k < n; ++k) {
                // Lateral offsets are positive to the driver's left (= -right).
                const lat = mid - half + (2 * half * k) / (n - 1);
                if (st.island > 0 && Math.abs(lat) < st.island + EDGE_MARGIN) continue;
                this.pos.push(st.pos.clone().addScaledVector(st.right, -lat).setY(st.pos.y + HOVER));
                this.away.push(0);
                this.hitAt.push(-1e9);
            }
        }
    }

    /** Collects the pickups the kart is touching after game frame `frame`; returns how many. */
    check(kart: XYZ, frame: number): number {
        let got = 0;
        this.pos.forEach((p, i) => {
            if (frame < this.away[i]!) return;
            const dx = p.x - kart.x;
            const dz = p.z - kart.z;
            if (dx * dx + dz * dz < RADIUS * RADIUS && Math.abs(p.y - kart.y) < REACH_Y) {
                this.away[i] = frame + RESPAWN_FRAMES;
                this.hitAt[i] = frame;
                ++got;
            }
        });
        return got;
    }

    reset(): void {
        this.away.fill(0);
        this.hitAt.fill(-1e9);
    }
}
