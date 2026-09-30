/**
 * Vista Point (Golden Gate section): the US 101 gore. The course's two carriageways split off the
 * bridge's north end round the Vista Point loop, and US 101 (streets.ts) carries on north over the
 * loop on a viaduct. Without this the viaduct starts in mid-air inside the loop; here the freeway
 * runs on between the diverging carriageways as a walled embankment (hatched gore paint, jersey
 * barriers on both edges) from where they split up to the viaduct's first span.
 *
 * Stays clear of the course: the wedge is >= 4.5 m outside both carriageways' inner walls.
 */

import * as THREE from 'three';
import { SCALE, worldY } from '../geo';
import { concreteTextures } from '../bridgeParts/textures';
import { US101 } from '../streets';
import { weatherConcrete } from '../weathering';

/** Where the carriageways' inner walls meet (m east / north, road height m), between them. */
const SPLIT: [number, number, number] = [-202.5, 2078, 65.3];
/** Viaduct deck width (m, streets.ts). */
const DECK_W = 40;
/** Texture repeat (world units) of the concrete on the walls, as on the viaduct (viaduct101.ts). */
const CONCRETE_REP = 240;

function goreTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#46474b';
    g.fillRect(0, 0, 256, 256);
    // Diagonal white hatching (a painted gore).
    g.strokeStyle = '#d9d6cc';
    g.lineWidth = 22;
    for (let k = -256; k < 512; k += 96) {
        g.beginPath();
        g.moveTo(k, 256);
        g.lineTo(k + 256, 0);
        g.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

/** US 101's roadway: asphalt, solid edge lines, dashed lanes (3 each way) and a double yellow median. */
function laneTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#46474b';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#d9d6cc';
    for (const x of [8, 244]) g.fillRect(x, 0, 4, 128);
    for (const x of [44, 84, 168, 208]) g.fillRect(x, 0, 3, 64);
    g.fillStyle = '#d6a622';
    for (const x of [123, 130]) g.fillRect(x, 0, 3, 128);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

export function buildVistaGore(groundY: (x: number, z: number) => number): {
    group: THREE.Group;
    dispose(): void;
} {
    // The viaduct's start edge: perpendicular to its first span, DECK_W wide.
    const [e0, n0, h0] = US101[0]!;
    const [e1, n1] = US101[1]!;
    const L = Math.hypot(e1 - e0, n1 - n0);
    const [pe, pn] = [(n1 - n0) / L, -(e1 - e0) / L];
    const w = (e: number, n: number, h: number) => new THREE.Vector3(e * SCALE, worldY(h), -n * SCALE);
    const apex = w(...SPLIT);
    const east = w(e0 + (pe * DECK_W) / 2, n0 + (pn * DECK_W) / 2, h0);
    const west = w(e0 - (pe * DECK_W) / 2, n0 - (pn * DECK_W) / 2, h0);

    const top = new THREE.BufferGeometry();
    {
        const pos = [apex, west, east].flatMap((p) => [p.x, p.y, p.z]);
        // Hatching in world space, a stripe every ~8 m.
        const uv = [apex, west, east].flatMap((p) => [p.x / 1500, p.z / 1500]);
        top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        top.computeVertexNormals();
        if (top.attributes.normal!.getY(0) < 0) {
            top.setIndex([0, 2, 1]);
            top.computeVertexNormals();
        }
    }

    // Retaining walls down to the ground along the two long edges, and jersey barriers on top: the
    // viaduct's board-formed, weathered concrete (u along the edge, v up), not a flat painted slab.
    const wallPos: number[] = [];
    const barrierPos: number[] = [];
    const wallUv: number[] = [];
    const barrierUv: number[] = [];
    const quad = (out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
        out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
        // a-b runs along the edge, d-c beside it: u along, v = world height on the upright faces
        // (level form lines) and the width across a flat one (the barrier's top).
        const ua = along / CONCRETE_REP;
        const ub = (along + a.distanceTo(b)) / CONCRETE_REP;
        const flat = Math.abs(d.y - a.y) < 1;
        const v = (p: THREE.Vector3, top: boolean) => (flat ? (top ? a.distanceTo(d) : 0) : p.y) / CONCRETE_REP;
        (out === wallPos ? wallUv : barrierUv).push(ua, v(a, false), ub, v(b, false), ub, v(c, true), ua, v(a, false), ub, v(c, true), ua, v(d, true));
    };
    /** Distance along the current edge (texture u). */
    let along = 0;
    for (const [a, b] of [
        [apex, east],
        [west, apex],
    ] as const) {
        const n = Math.ceil(a.distanceTo(b) / 300);
        const side = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
        // Outward = away from the wedge's inside (the edges run counterclockwise seen from above).
        const outward = new THREE.Vector3(side.z, 0, -side.x);
        const inside = new THREE.Vector3().addVectors(apex, east).add(west).divideScalar(3);
        if (outward.dot(new THREE.Vector3().subVectors(a, inside)) < 0) outward.negate();
        for (let k = 0; k < n; ++k) {
            const p = a.clone().lerp(b, k / n);
            const q = a.clone().lerp(b, (k + 1) / n);
            along = (a.distanceTo(b) * k) / n;
            const gp = Math.min(p.y, groundY(p.x, p.z)) - 120;
            const gq = Math.min(q.y, groundY(q.x, q.z)) - 120;
            quad(wallPos, p.clone().setY(gp), q.clone().setY(gq), q, p);
            // Barrier: 55 wide, 60 tall, set just inside the edge.
            const pi = p.clone().addScaledVector(outward, -40);
            const qi = q.clone().addScaledVector(outward, -40);
            const up = new THREE.Vector3(0, 60, 0);
            const o = outward.clone().multiplyScalar(27);
            quad(barrierPos, pi.clone().sub(o), qi.clone().sub(o), qi.clone().sub(o).add(up), pi.clone().sub(o).add(up));
            quad(barrierPos, pi.clone().add(o).add(up), qi.clone().add(o).add(up), qi.clone().add(o), pi.clone().add(o));
            quad(barrierPos, pi.clone().sub(o).add(up), qi.clone().sub(o).add(up), qi.clone().add(o).add(up), pi.clone().add(o).add(up));
        }
    }
    const mesh = (pos: number[], uv: number[]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.computeVertexNormals();
        return g;
    };
    const walls = mesh(wallPos, wallUv);
    const barriers = mesh(barrierPos, barrierUv);

    // The roadway on the viaduct (streets.ts draws a bare concrete deck), inside its parapets.
    const road = new THREE.BufferGeometry();
    {
        const pos: number[] = [];
        const uv: number[] = [];
        const half = (DECK_W / 2 - 1.2) * SCALE;
        let v = 0;
        for (let i = 0; i + 1 < US101.length; ++i) {
            const a = w(...US101[i]!);
            const b = w(...US101[i + 1]!);
            // Overlap the next span a little (the deck boxes do too), 5 units over the deck.
            const d = new THREE.Vector3().subVectors(b, a).normalize();
            const bb = b.clone().addScaledVector(d, 20);
            const r = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(half);
            const v1 = v + a.distanceTo(bb) / 1500;
            const q = [a.clone().sub(r), a.clone().add(r), bb.clone().add(r), bb.clone().sub(r)].map((p) => p.setY(p.y + 5));
            pos.push(...[q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!].flatMap((p) => [p.x, p.y, p.z]));
            uv.push(0, v, 1, v, 1, v1, 0, v, 1, v1, 0, v1);
            v = v1;
        }
        road.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        road.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        road.computeVertexNormals();
    }

    const tex = goreTexture();
    // Shared with the viaduct and the bridge (cached; not disposed here).
    const concrete = concreteTextures();
    const lanes = laneTexture();
    const mats = {
        top: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
        road: new THREE.MeshStandardMaterial({ map: lanes, roughness: 0.9, side: THREE.DoubleSide }),
        wall: weatherConcrete(
            new THREE.MeshStandardMaterial({
                color: 0xc4beb3,
                roughness: 1,
                side: THREE.DoubleSide,
                ...(concrete ? { map: concrete.map, normalMap: concrete.normalMap, roughnessMap: concrete.roughnessMap } : {}),
            }),
        ),
    };
    const topMesh = new THREE.Mesh(top, mats.top);
    const roadMesh = new THREE.Mesh(road, mats.road);
    const wallMesh = new THREE.Mesh(walls, mats.wall);
    const barrierMesh = new THREE.Mesh(barriers, mats.wall);
    const group = new THREE.Group();
    group.name = 'vista-gore';
    for (const m of [topMesh, roadMesh, wallMesh, barrierMesh]) {
        m.castShadow = m !== roadMesh;
        m.receiveShadow = true;
        group.add(m);
    }
    return {
        group,
        dispose() {
            for (const g of [top, road, walls, barriers]) g.dispose();
            tex.dispose();
            lanes.dispose();
            for (const m of Object.values(mats)) m.dispose();
        },
    };
}
