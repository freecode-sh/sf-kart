/**
 * Speed-up pickups, the gameplay part: rows of pickups across the road at fixed points of the lap;
 * driving through one stores a speed-up for the item button (storeSpeedUp, up to three; Sim.step
 * adds it after the frame), and the pickup comes back ~4 s later. Plain math on the kart's position
 * and the frame number, no DOM, so the app, run replays, the verifier (rules/resim.ts) and the bots
 * (tools/sf/rivals.ts, pickupBot.ts) all collect the same pickups on the same frames and store them
 * the same way. sf/itemBoxes.ts draws them.
 */

import * as THREE from 'three';
import { ItemId } from '../../game/item/ItemId';

/** The centerline station fields the pickup layout reads (course_meta.json, sf/road.ts Station). */
export interface PickupStation {
    s: number;
    pos: [number, number, number];
    right: [number, number, number];
    edges: { roadL: number; roadR: number; island: number };
}

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

type XYZ = { x: number; y: number; z: number };

/** Speed-ups a kart can store (the engine's stock of three; the HUD's three slots). */
export const MAX_SPEED_UPS = 3;

/** The engine's item stock (KartItem.inventory()), the part the pickups use. */
export interface SpeedUpStock {
    currentCount(): number;
    setItem(id: ItemId): void;
    useItem(count: number): void;
}

/**
 * A collected pickup: one more stored speed-up, up to MAX_SPEED_UPS; returns false when the stock
 * was already full (the pickup is still taken, for nothing). Through the engine's own API: a fresh
 * stock of three, less the ones the kart doesn't hold (useItem only empties the stock at 0).
 */
export function storeSpeedUp(stock: SpeedUpStock): boolean {
    const n = stock.currentCount();
    if (n >= MAX_SPEED_UPS) return false;
    stock.setItem(ItemId.TRIPLE_MUSHROOM);
    const spare = MAX_SPEED_UPS - (n + 1);
    if (spare > 0) stock.useItem(spare);
    return true;
}

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
function sampleAt(centerline: PickupStation[], S: number): { pos: THREE.Vector3; right: THREE.Vector3; roadL: number; roadR: number; island: number } {
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
    constructor(centerline: PickupStation[], rows: number[]) {
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
