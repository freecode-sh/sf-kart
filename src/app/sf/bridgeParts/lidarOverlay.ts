/**
 * Debug overlay for the model viewer (sfviewer.html?model=bridge&lidar=1): the USGS 3DEP 2023 lidar
 * points of the bridge, thinned by tools/sf/bridgeFit.ts into public/data/sf/debug/bridge_lidar.bin
 * (gitignored). Resolves to null when the file is missing, so the viewer just shows the model.
 *
 * File: 'GGLD', u32 count, f32 datum (NAVD88 m of our sea level), f32 meters per unit, then Int16
 * [e, n, h] * count (course meters east / north, height above our sea level, in units), Uint8 class
 * * count (1 unclassified: towers / cables, 17 bridge deck).
 */

import * as THREE from 'three';
import { SCALE, SEA_Y } from '../geo';
import { dataUrl } from '../../paths';

const LIDAR_URL = dataUrl('sf/debug/bridge_lidar.bin');

export async function loadLidarOverlay(): Promise<THREE.Points | null> {
    let buf: ArrayBuffer;
    try {
        const r = await fetch(LIDAR_URL);
        if (!r.ok) return null;
        buf = await r.arrayBuffer();
    } catch {
        return null;
    }
    // The dev server answers missing files with index.html: check the magic.
    if (buf.byteLength < 16 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'GGLD') return null;
    const dv = new DataView(buf);
    const n = dv.getUint32(4, true);
    const unit = dv.getFloat32(12, true);
    if (buf.byteLength < 16 + n * 7) return null;
    const q = new Int16Array(buf, 16, n * 3);
    const cls = new Uint8Array(buf, 16 + n * 6, n);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const deck = new THREE.Color('#ffe14d');
    const other = new THREE.Color('#29e0ff');
    for (let i = 0; i < n; ++i) {
        pos[i * 3] = q[i * 3]! * unit * SCALE;
        pos[i * 3 + 1] = SEA_Y + q[i * 3 + 2]! * unit * SCALE;
        pos[i * 3 + 2] = -q[i * 3 + 1]! * unit * SCALE;
        const c = cls[i] === 17 ? deck : other;
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
    pts.name = 'lidar-overlay';
    return pts;
}
