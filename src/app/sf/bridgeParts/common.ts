/** Shared bridge helpers: deck-following extrusions, stations, instancing. */

import * as THREE from 'three';
import type { GeoBuilder } from './builder';
import { onDeck, xz } from './frame';

/** Evenly spaced stations covering [a, b] with steps of at most `step`. */
export function stations(a: number, b: number, step: number): number[] {
    const n = Math.max(1, Math.ceil((b - a) / step));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

/** Unit lateral (+east) direction at along s. */
export function latDir(s: number): THREE.Vector3 {
    const [x0, z0] = xz(s, 0);
    const [x1, z1] = xz(s, 1000);
    return new THREE.Vector3(x1 - x0, 0, z1 - z0).normalize();
}

/**
 * Extrudes a cross-section profile ([lateral, height above deck] points, counterclockwise seen
 * looking north, i.e. +lateral right, +height up) along the deck from a to b. `lift(s)` scales the
 * profile's heights above the deck along the way (e.g. to ramp a barrier down at its ends).
 */
export function extrudeAlong(b: GeoBuilder, profile: [number, number][], a: number, e: number, step: number, caps = true, lift?: (s: number) => number): void {
    const ss = stations(a, e, step);
    const ring = (s: number) => {
        const k = lift ? lift(s) : 1;
        return profile.map(([l, h]) => onDeck(s, l, h > 0 ? h * k : h));
    };
    let prev = ring(ss[0]!);
    const n = profile.length;
    // Centroid of the profile, for outward hints.
    const cl = profile.reduce((t, p) => t + p[0], 0) / n;
    const ch = profile.reduce((t, p) => t + p[1], 0) / n;
    for (let i = 1; i < ss.length; ++i) {
        const cur = ring(ss[i]!);
        const lat = latDir(ss[i]!);
        for (let k = 0; k < n; ++k) {
            const j = (k + 1) % n;
            const ml = (profile[k]![0] + profile[j]![0]) / 2 - cl;
            const mh = (profile[k]![1] + profile[j]![1]) / 2 - ch;
            // Outward = the 2D edge normal (pointing away from the centroid).
            const ex = profile[j]![0] - profile[k]![0];
            const eh = profile[j]![1] - profile[k]![1];
            let nx = eh;
            let nh = -ex;
            if (nx * ml + nh * mh < 0) {
                nx = -nx;
                nh = -nh;
            }
            const out = lat.clone().multiplyScalar(nx).add(new THREE.Vector3(0, nh, 0));
            b.face([prev[k]!, prev[j]!, cur[j]!, cur[k]!], out);
        }
        prev = cur;
    }
    if (caps) {
        const f0 = ring(ss[0]!);
        const f1 = prev;
        const d = new THREE.Vector3().subVectors(onDeck(ss[ss.length - 1]!, 0), onDeck(ss[0]!, 0)).normalize();
        b.face(f0, d.clone().negate());
        b.face(f1, d);
    }
}

/**
 * extrudeAlong for a barrier from a to e that ramps down to `low` of its height over `len` at each
 * end (finer steps there): a sloped nose like a real barrier's end treatment rather than a blunt
 * block end facing the traffic.
 */
export function extrudeNosed(b: GeoBuilder, profile: [number, number][], a: number, e: number, step: number, len: number, low = 0.2): void {
    len = Math.min(len, (e - a) / 2);
    const lift = (s: number) => {
        const t = Math.min(1, Math.max(0, Math.min(s - a, e - s) / len));
        return low + (1 - low) * t * t * (3 - 2 * t);
    };
    extrudeAlong(b, profile, a, a + len, step / 4, true, lift);
    if (e - a > 2 * len) extrudeAlong(b, profile, a + len, e - len, step, false, lift);
    extrudeAlong(b, profile, e - len, e, step / 4, true, lift);
}

/** Instanced mesh from a list of matrices. */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], name: string): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    m.instanceMatrix.needsUpdate = true;
    m.name = name;
    m.computeBoundingBox();
    m.computeBoundingSphere();
    return m;
}

const _up = new THREE.Vector3(0, 1, 0);

/** Matrix mapping a unit Y-axis primitive (centered, height 1) onto the segment a→b, radius sx/sz. */
export function segMatrix(a: THREE.Vector3, b: THREE.Vector3, sx: number, sz = sx, side?: THREE.Vector3): THREE.Matrix4 {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    d.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, d);
    if (side) {
        // Twist so the primitive's local X follows `side`.
        const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const want = side.clone().addScaledVector(d, -side.dot(d)).normalize();
        const ang = Math.atan2(new THREE.Vector3().crossVectors(x, want).dot(d), x.dot(want));
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(d, ang));
    }
    return new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(sx, len, sz));
}
