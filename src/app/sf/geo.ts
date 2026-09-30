/**
 * Shared frame of the San Francisco (Golden Gate) course, browser side. Must match tools/sf/geo.ts
 * and tools/sf/bakeTrack.ts.
 *
 * World units: the engine's units, +Y up, right-handed. X = meters east * SCALE, Z = -(meters north) * SCALE
 * (north is -Z), Y = SEA_Y + meters above sea level * SCALE.
 */

export const SCALE = 60;
export const SEA_Y = 600;

/** World (x, z) of a point given in meters east / north of the origin (the bridge's south tower area). */
export const worldXZ = (e: number, n: number): [number, number] => [e * SCALE, -n * SCALE];
/** World y of a height in meters above sea level. */
export const worldY = (m: number): number => SEA_Y + m * SCALE;

/**
 * The Golden Gate Bridge, in meters east/north: the course's two carriageways run parallel to the
 * axis at +-CARRIAGEWAY meters (northbound east of it), each with a road surface of +-1150 units
 * around its centerline (walls at the edges).
 */
export const BRIDGE = {
    southEnd: [60, -230] as [number, number],
    sfTower: [-34, 391] as [number, number],
    marinTower: [-153, 1670] as [number, number],
    northEnd: [-200, 2080] as [number, number],
    carriageway: 21,
    roadHalfWidth: 1150,
};

/** Road surface height (meters above sea level) along the bridge axis, meters from the south end. */
export const DECK_PROFILE: [number, number][] = [
    [0, 62],
    [625, 69],
    [1270, 76],
    [1910, 69],
    [2330, 64],
];

export function deckHeightM(along: number): number {
    const p = DECK_PROFILE;
    if (along <= p[0]![0]) return p[0]![1];
    for (let i = 0; i + 1 < p.length; ++i) {
        const [a0, y0] = p[i]!;
        const [a1, y1] = p[i + 1]!;
        if (along <= a1) {
            // Smooth (cosine) between knots, like the course's monotone profile.
            const t = (along - a0) / (a1 - a0);
            return y0 + (y1 - y0) * (1 - Math.cos(Math.PI * t)) * 0.5;
        }
    }
    return p[p.length - 1]![1];
}
