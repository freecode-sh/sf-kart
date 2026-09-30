/**
 * Visual-only KCL reader: reconstructs collision triangles so the course can be drawn straight from
 * the collision data. Uses plain double math; the physics uses the exact port in src/game/field.
 */

export interface KclTriangles {
    /** xyz per vertex, 3 vertices per triangle. */
    positions: Float32Array;
    /** One attribute (u16) per triangle. */
    attributes: Uint16Array;
    /** Face normal per triangle. */
    normals: Float32Array;
}

type V3 = [number, number, number];

const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function readKclTriangles(file: ArrayBuffer | Uint8Array): KclTriangles {
    const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const posOffset = dv.getUint32(0);
    const nrmOffset = dv.getUint32(4);
    const prismOffset = dv.getUint32(8);
    const blockOffset = dv.getUint32(12);

    const readV3 = (off: number): V3 => [
        dv.getFloat32(off),
        dv.getFloat32(off + 4),
        dv.getFloat32(off + 8),
    ];

    // Prisms are one-indexed; entry 0 is skipped.
    const prismCount = Math.floor((blockOffset - prismOffset) / 0x10);
    const positions = new Float32Array((prismCount - 1) * 9);
    const normals = new Float32Array((prismCount - 1) * 3);
    const attributes = new Uint16Array(prismCount - 1);

    for (let i = 1; i < prismCount; ++i) {
        const o = prismOffset + i * 0x10;
        const height = dv.getFloat32(o);
        const posI = dv.getUint16(o + 4);
        const fnrmI = dv.getUint16(o + 6);
        const enrm1I = dv.getUint16(o + 8);
        const enrm2I = dv.getUint16(o + 10);
        const enrm3I = dv.getUint16(o + 12);
        const attr = dv.getUint16(o + 14);

        const v1 = readV3(posOffset + posI * 12);
        const fnrm = readV3(nrmOffset + fnrmI * 12);
        const enrm1 = readV3(nrmOffset + enrm1I * 12);
        const enrm2 = readV3(nrmOffset + enrm2I * 12);
        const enrm3 = readV3(nrmOffset + enrm3I * 12);

        const vertex = (enrm: V3): V3 => {
            const c = cross(fnrm, enrm);
            const s = height / dot(c, enrm3);
            return [c[0] * s + v1[0], c[1] * s + v1[1], c[2] * s + v1[2]];
        };
        const v2 = vertex(enrm1);
        const v3 = vertex(enrm2);

        const t = i - 1;
        // Wind so the face normal points out of the front face (counter-clockwise).
        const e1: V3 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
        const e2: V3 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
        const n = cross(e1, e2);
        const [a, b, c] = dot(n, fnrm) >= 0 ? [v1, v3, v2] : [v1, v2, v3];
        positions.set([...a, ...b, ...c], t * 9);
        normals.set(fnrm, t * 3);
        attributes[t] = attr;
    }

    return { positions, attributes, normals };
}
