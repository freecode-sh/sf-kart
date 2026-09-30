/**
 * Toll gantries over the toll plaza's lane panels (both directions): a steel truss across the
 * carriageway on two posts, a green lane sign with a white down arrow over each dash-panel lane
 * (glowing, so the boost lanes read from far back), and an electronic-toll board in the middle.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Station } from '../road';

type Panel = { s: number; lat: [number, number] };

function signTexture(kind: 'arrow' | 'toll'): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 192;
    const g = cv.getContext('2d')!;
    if (kind === 'arrow') {
        g.fillStyle = '#0d7a3e';
        g.fillRect(0, 0, 256, 192);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 8;
        g.strokeRect(8, 8, 240, 176);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(108, 28);
        g.lineTo(148, 28);
        g.lineTo(148, 100);
        g.lineTo(188, 100);
        g.lineTo(128, 168);
        g.lineTo(68, 100);
        g.lineTo(108, 100);
        g.closePath();
        g.fill();
    } else {
        g.fillStyle = '#16307a';
        g.fillRect(0, 0, 256, 192);
        g.fillStyle = '#c0362c';
        g.fillRect(0, 150, 256, 42);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 6;
        g.strokeRect(6, 6, 244, 180);
        g.fillStyle = '#ffffff';
        g.strokeStyle = '#ffffff';
        // A generic windshield transponder: a tag with radio waves off it.
        g.fillRect(26, 50, 32, 44);
        g.fillStyle = '#16307a';
        g.fillRect(31, 56, 22, 14);
        g.fillStyle = '#ffffff';
        g.lineWidth = 5;
        for (const r of [11, 21]) {
            g.beginPath();
            g.arc(62, 72, r, -Math.PI / 4, Math.PI / 4);
            g.stroke();
        }
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '900 60px ui-sans-serif, system-ui, sans-serif';
        g.fillText('TOLL', 168, 74);
        g.font = '800 23px ui-sans-serif, system-ui, sans-serif';
        g.fillText('ALL ELECTRONIC', 128, 124);
        g.font = '800 22px ui-sans-serif, system-ui, sans-serif';
        g.fillText('GOLDEN GATE', 128, 171);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}

type Slot = 'steel' | 'arrow' | 'toll';

export function buildTollGantries(cl: Station[], panels: Panel[]): { group: THREE.Group; dispose(): void } {
    const arrowTex = signTexture('arrow');
    const tollTex = signTexture('toll');
    const mats: Record<Slot, THREE.Material> = {
        steel: new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.45, metalness: 0.7 }),
        arrow: new THREE.MeshStandardMaterial({ map: arrowTex, emissive: 0xffffff, emissiveMap: arrowTex, emissiveIntensity: 0.28, roughness: 0.5 }),
        toll: new THREE.MeshStandardMaterial({ map: tollTex, emissive: 0xffffff, emissiveMap: tollTex, emissiveIntensity: 0.2, roughness: 0.5 }),
    };
    const group = new THREE.Group();
    group.name = 'tollGantries';
    // Every piece is baked into world space and merged per material: three draw calls in all.
    const pieces: Record<Slot, THREE.BufferGeometry[]> = { steel: [], arrow: [], toll: [] };
    const box = (parent: THREE.Object3D, slot: Slot, w: number, h: number, d: number, x: number, y: number, z: number, rz = 0) => {
        const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(1, 1, 1));
        g.applyMatrix4(m.premultiply(parent.matrix));
        pieces[slot].push(g);
    };
    // One gantry per panel row (the two lanes' panels share an S).
    const rows = new Map<number, Panel[]>();
    for (const p of panels) rows.set(Math.round(p.s), [...(rows.get(Math.round(p.s)) ?? []), p]);
    for (const [s, lanes] of rows) {
        const st = cl.reduce((a, c) => (Math.abs(c.s - s) < Math.abs(a.s - s) ? c : a));
        const half = Math.max(st.edges.wallL, -st.edges.wallR) + 220;
        // Local frame: x = the driver's right, y up, z back toward the approaching karts.
        const right = new THREE.Vector3(st.right[0], 0, st.right[2]).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const back = new THREE.Vector3().crossVectors(right, up);
        const holder = new THREE.Group();
        holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
        holder.position.set(st.pos[0], st.pos[1], st.pos[2]);
        holder.updateMatrix();
        const top = 1230;
        const chordLo = 960;
        for (const side of [-1, 1]) {
            box(holder, 'steel', 150, top + 100, 150, side * half, (top + 100) / 2 - 50, 0);
            box(holder, 'steel', 260, 40, 260, side * half, 20, 0);
        }
        // Truss: two chords front and back, verticals and diagonals between them.
        for (const z of [-90, 90]) {
            box(holder, 'steel', half * 2, 36, 36, 0, top, z);
            box(holder, 'steel', half * 2, 36, 36, 0, chordLo, z);
            const bays = Math.round((half * 2) / 270);
            const bw = (half * 2) / bays;
            for (let b = 0; b <= bays; ++b) box(holder, 'steel', 20, top - chordLo, 20, -half + b * bw, (top + chordLo) / 2, z);
            const len = Math.hypot(bw, top - chordLo);
            const ang = Math.atan2(top - chordLo, bw);
            for (let b = 0; b < bays; ++b) box(holder, 'steel', len, 16, 16, -half + (b + 0.5) * bw, (top + chordLo) / 2, z, b % 2 ? ang : -ang);
        }
        // Signs hang in front of the truss (facing the approaching karts).
        const sign = (slot: Slot, x: number, w: number, h: number) => {
            box(holder, 'steel', w + 30, h + 30, 20, x, chordLo - h / 2 + 60, 100);
            const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
            g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, chordLo - h / 2 + 60, 112).premultiply(holder.matrix));
            pieces[slot].push(g);
        };
        // Lateral offsets are positive to the driver's left, local x is the right.
        for (const l of lanes) sign('arrow', -(l.lat[0] + l.lat[1]) / 2, 460, 345);
        sign('toll', 0, 440, 330);
    }
    const meshes: THREE.Mesh[] = [];
    for (const slot of Object.keys(pieces) as Slot[]) {
        if (!pieces[slot].length) continue;
        const g = mergeGeometries(pieces[slot])!;
        for (const p of pieces[slot]) p.dispose();
        const m = new THREE.Mesh(g, mats[slot]);
        m.castShadow = slot === 'steel';
        m.receiveShadow = true;
        meshes.push(m);
        group.add(m);
    }
    return {
        group,
        dispose() {
            for (const mesh of meshes) mesh.geometry.dispose();
            arrowTex.dispose();
            tollTex.dispose();
            for (const m of Object.values(mats)) m.dispose();
        },
    };
}
