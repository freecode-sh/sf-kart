/**
 * Geographic frame of the San Francisco course.
 *
 * Local tangent plane at ORIGIN (the Golden Gate Bridge south tower area): meters east / north.
 * Game world (engine units, +Y up, right-handed): X = east * SCALE, Z = -north * SCALE, so north is
 * -Z like Three.js. SCALE is game units per meter.
 */

export const BBOX = { south: 37.786, west: -122.492, north: 37.842, east: -122.43 };

export const ORIGIN = { lat: 37.8105, lon: -122.4775 };

/** Detailed region around the course (meters east/north of ORIGIN): the lidar terrain, the photo imagery, street detail. */
export const CORE = { e0: -1250, e1: 3500, n0: -1800, n1: 3350 };
/** Far field (horizon): Marin Headlands, the city, Angel Island, Alcatraz. */
export const FAR = { e0: -14000, e1: 18000, n0: -14000, n1: 16000 };

/** Game units per real meter. */
export const SCALE = 60;

const R = 6378137;
const K = Math.PI / 180;

/** Meters east/north of ORIGIN (equirectangular, fine at this size). */
export function toMeters(lat: number, lon: number): [number, number] {
    return [(lon - ORIGIN.lon) * K * R * Math.cos(ORIGIN.lat * K), (lat - ORIGIN.lat) * K * R];
}

export function fromMeters(e: number, n: number): [number, number] {
    return [ORIGIN.lat + n / (K * R), ORIGIN.lon + e / (K * R * Math.cos(ORIGIN.lat * K))];
}

/** Slippy-map tile of a lat/lon (fractional). */
export function tileXY(lat: number, lon: number, z: number): [number, number] {
    const n = 2 ** z;
    const x = ((lon + 180) / 360) * n;
    const y = ((1 - Math.log(Math.tan(lat * K) + 1 / Math.cos(lat * K)) / Math.PI) / 2) * n;
    return [x, y];
}

export function tileRange(z: number, box: { south: number; west: number; north: number; east: number } = BBOX): { x0: number; x1: number; y0: number; y1: number } {
    const [x0, y0] = tileXY(box.north, box.west, z);
    const [x1, y1] = tileXY(box.south, box.east, z);
    return { x0: Math.floor(x0), x1: Math.floor(x1), y0: Math.floor(y0), y1: Math.floor(y1) };
}

/** Lat/lon box of a meters box. */
export function latLonBox(b: { e0: number; e1: number; n0: number; n1: number }): { south: number; west: number; north: number; east: number } {
    const [south, west] = fromMeters(b.e0, b.n0);
    const [north, east] = fromMeters(b.e1, b.n1);
    return { south, west, north, east };
}
