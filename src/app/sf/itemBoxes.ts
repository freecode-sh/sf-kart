/**
 * Speed-up pickups: rows of floating pickups across the road at fixed points of the lap. Driving
 * through one gives an instant speed-up (the engine's item boost, applied by main.ts);
 * the pickup bursts and comes back ~4 s later. App-side gameplay layered on the engine. The rivals
 * collected them in their recorded runs (tools/sf/rivals.ts); on screen only the player's burst.
 *
 * The look follows the vehicle being raced (setKind):
 *   battery  (Robotaxi)    a chunky green cell with a glowing lightning bolt, a charge glow sweeping
 *                          up it; bursts into electric sparks.
 *   gas      (Tour Buggy)  a red-orange jerry can (X-pressed sides, triple handle, spout); bursts into
 *                          a whoosh of fiery puffs.
 *   coffee   (E-Bike)      a takeaway cup with a kraft sleeve and lid, steam wisps curling off it;
 *                          bursts into steam, the lid popping off.
 * Each hovers low over a soft contact shadow, bobs gently and spins about the vertical, and glows
 * a little so it pops in the golden-hour light.
 *
 * The gameplay part (layout, pickup test, respawn) is `PickupField` in pickupField.ts, shared with
 * the bots and the leaderboard's run verifier.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PIECE_COLORS } from './padMaterial';
import type { Station } from './road';
import { HOVER, PickupField } from './pickupField';
import type { VehicleId } from '../vehicles';

export type PickupKind = 'battery' | 'gas' | 'coffee';

/** The speed-up each vehicle picks up. */
export function pickupKindFor(vehicle: VehicleId): PickupKind {
    return vehicle === 'robotaxi' ? 'battery' : vehicle === 'buggy' ? 'gas' : 'coffee';
}

/** Frames the burst lasts, and the pop back in. */
const BURST_FRAMES = 34;
const GROW_FRAMES = 16;
const PARTS = 14;
const MAX_BURSTS = 6;

// ---------------------------------------------------------------------------------------------
// Models: merged primitives with vertex colours and a per-vertex glow (emissive = colour x glow).
// ---------------------------------------------------------------------------------------------

/** One part of a model: geometry (any), colour (sRGB hex) and glow. */
function part(g: THREE.BufferGeometry, color: number, glow: number): THREE.BufferGeometry {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    const n = ng.getAttribute('position').count;
    if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; ++i) col.set([c.r, c.g, c.b], i * 3);
    ng.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    ng.setAttribute('glow', new THREE.Float32BufferAttribute(new Float32Array(n).fill(glow), 1));
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color', 'glow'].includes(k)) ng.deleteAttribute(k);
    return ng;
}

function model(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const g = mergeGeometries(parts)!;
    for (const p of parts) p.dispose();
    g.computeBoundingSphere();
    return g;
}

/** A flat lightning bolt (in the XY plane, facing +z), `h` tall, `d` thick. */
function boltGeometry(h: number, d: number): THREE.BufferGeometry {
    const s = new THREE.Shape();
    const k = h / 10;
    s.moveTo(1.2 * k, 5 * k);
    s.lineTo(-2.6 * k, -0.4 * k);
    s.lineTo(-0.2 * k, -0.4 * k);
    s.lineTo(-1.4 * k, -5 * k);
    s.lineTo(2.8 * k, 1.0 * k);
    s.lineTo(0.4 * k, 1.0 * k);
    s.lineTo(1.6 * k, 5 * k);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    return g;
}

const GREEN = PIECE_COLORS.boostGreen;

/** Robotaxi: an upright battery cell, Boost Green, with a white bolt on each side. */
function batteryModel(): THREE.BufferGeometry {
    const R = 62;
    const H = 190;
    const parts: THREE.BufferGeometry[] = [];
    // Body (green) over a dark negative end.
    parts.push(part(new THREE.CylinderGeometry(R, R, H - 36, 28, 1, true).translate(0, 18, 0), GREEN, 0.5));
    parts.push(part(new THREE.CylinderGeometry(R, R, 36, 28, 1, true).translate(0, -H / 2 + 18, 0), 0x1d2226, 0.05));
    // A pale ring where they meet.
    parts.push(part(new THREE.CylinderGeometry(R + 2, R + 2, 8, 28, 1, true).translate(0, -H / 2 + 38, 0), 0xf4f4f0, 0.5));
    // End caps: bottom dark disc, top silver disc with the terminal nub.
    parts.push(part(new THREE.CircleGeometry(R, 28).rotateX(Math.PI / 2).translate(0, -H / 2, 0), 0x1d2226, 0.05));
    parts.push(part(new THREE.CylinderGeometry(R - 4, R, 10, 28).translate(0, H / 2 + 4, 0), 0xc9ced3, 0.2));
    parts.push(part(new THREE.CylinderGeometry(24, 26, 26, 20).translate(0, H / 2 + 21, 0), 0xdfe3e6, 0.25));
    // Bolts, front and back.
    for (const side of [1, -1]) {
        const b = boltGeometry(120, 10);
        b.translate(0, 8, R - 4);
        if (side < 0) b.rotateY(Math.PI);
        parts.push(part(b, 0xfffbe0, 1.1));
    }
    return model(parts);
}

/** Tour Buggy: a red-orange jerry can. */
function gasModel(): THREE.BufferGeometry {
    const W = 150;
    const H = 180;
    const D = 82;
    const RED = 0xe8401e;
    const parts: THREE.BufferGeometry[] = [];
    parts.push(part(new RoundedBoxGeometry(W, H, D, 3, 14).translate(0, -10, 0), RED, 0.45));
    // The pressed X on both big faces (raised bars).
    const diag = Math.hypot(W - 44, H - 44);
    const ang = Math.atan2(H - 44, W - 44);
    for (const z of [D / 2, -D / 2])
        for (const a of [ang, -ang]) parts.push(part(new THREE.BoxGeometry(diag, 16, 8).rotateZ(a).translate(0, -10, z), 0xc4321a, 0.35));
    // Triple handle on top: three posts and a bar, toward the back.
    for (const x of [-52, -20, 12]) parts.push(part(new THREE.BoxGeometry(12, 30, 18).translate(x, H / 2 + 5, 0), RED, 0.45));
    parts.push(part(new THREE.BoxGeometry(84, 14, 22).translate(-20, H / 2 + 24, 0), RED, 0.45));
    // Spout at the front corner, tilted forward, with a dark cap.
    parts.push(part(new THREE.CylinderGeometry(16, 20, 40, 14).rotateZ(-0.5).translate(W / 2 - 26, H / 2 + 8, 0), RED, 0.45));
    parts.push(part(new THREE.CylinderGeometry(19, 19, 14, 14).rotateZ(-0.5).translate(W / 2 - 14, H / 2 + 26, 0), 0x2a2a2e, 0.1));
    return model(parts);
}

/** E-Bike: a takeaway coffee cup with a lid and a kraft sleeve. */
function coffeeModel(): THREE.BufferGeometry {
    const H = 170;
    const RT = 72;
    const RB = 52;
    const r = (y: number) => RB + ((RT - RB) * (y + H / 2)) / H;
    const parts: THREE.BufferGeometry[] = [];
    // Paper cup (off-white), bottom disc.
    parts.push(part(new THREE.CylinderGeometry(RT, RB, H, 28, 1, true).translate(0, -10, 0), 0xf6f2ea, 0.45));
    parts.push(part(new THREE.CircleGeometry(RB, 28).rotateX(Math.PI / 2).translate(0, -H / 2 - 10, 0), 0xe8e2d6, 0.3));
    // Kraft sleeve round the middle, with a Boost Green band.
    const y0 = -40;
    const y1 = 30;
    parts.push(part(new THREE.CylinderGeometry(r(y1) + 5, r(y0) + 5, y1 - y0, 28, 1, true).translate(0, (y0 + y1) / 2 - 10, 0), 0xa8733f, 0.3));
    parts.push(part(new THREE.CylinderGeometry(r(0) + 7, r(-8) + 7, 16, 28, 1, true).translate(0, -4 - 10, 0), GREEN, 0.6));
    // Lid: a wide rim, a raised top and a sip spout.
    const top = H / 2 - 10;
    parts.push(part(new THREE.CylinderGeometry(RT + 7, RT + 7, 14, 28).translate(0, top + 6, 0), 0xffffff, 0.5));
    parts.push(part(new THREE.CylinderGeometry(RT - 12, RT, 16, 28).translate(0, top + 20, 0), 0xf4f4f0, 0.5));
    parts.push(part(new THREE.BoxGeometry(34, 10, 20).translate(0, top + 31, RT - 34), 0xf4f4f0, 0.5));
    parts.push(part(new THREE.BoxGeometry(18, 2, 6).translate(0, top + 36.5, RT - 30), 0x3a2a20, 0));
    return model(parts);
}

/** The lid alone (flies off in the coffee burst). */
function lidModel(): THREE.BufferGeometry {
    return model([part(new THREE.CylinderGeometry(79, 79, 14, 24), 0xffffff, 0.5), part(new THREE.CylinderGeometry(60, 72, 16, 24).translate(0, 14, 0), 0xf4f4f0, 0.5)]);
}

/** Two crossed quads above the cup for the steam wisps (uv v runs up). */
function steamGeometry(): THREE.BufferGeometry {
    const a = new THREE.PlaneGeometry(130, 190).translate(0, 175, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const g = mergeGeometries([a, b])!;
    a.dispose();
    b.dispose();
    return g;
}

/** Steam wisp texture: soft wavy white strands (alpha), fading at the top and bottom. */
function steamTexture(): THREE.CanvasTexture {
    const W = 128;
    const H = 256;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    for (const [x0, ph, w] of [
        [40, 0, 14],
        [70, 2.1, 17],
        [95, 4.2, 12],
    ] as const) {
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = w;
        g.shadowColor = 'rgba(255,255,255,0.9)';
        g.shadowBlur = 10;
        g.beginPath();
        for (let y = 0; y <= H; y += 4) {
            const x = x0 + Math.sin((y / H) * Math.PI * 4 + ph) * 12;
            if (y === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
        }
        g.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
}

/** Pickup body: lit, vertex-coloured, glowing by its `glow` attribute; a charge sweep for the battery. */
function bodyMaterial(time: { value: number }, sweep: boolean): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05, emissive: 0xffffff });
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.pickTime = time;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;\nvarying float vLocalY;\nvarying float vSeed;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;\nvLocalY = position.y;\nvSeed = float( gl_InstanceID ) * 0.61;');
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float pickTime;\nvarying float vGlow;\nvarying float vLocalY;\nvarying float vSeed;')
            .replace(
                '#include <emissivemap_fragment>',
                `#include <emissivemap_fragment>
                float g = vGlow * ( 0.9 + 0.1 * sin( pickTime * 4.0 + vSeed * 7.0 ) );
                ${
                    sweep
                        ? `// Charging: a bright band sweeping up the cell, every 1.2 s.
                float band = fract( pickTime * 0.8 + vSeed ) * 300.0 - 130.0;
                g += step( 0.3, vGlow ) * step( vGlow, 0.9 ) * 0.9 * smoothstep( 40.0, 0.0, abs( vLocalY - band ) );`
                        : ''
                }
                totalEmissiveRadiance = diffuseColor.rgb * g;`,
            );
    };
    mat.customProgramCacheKey = () => `pickup-${sweep}`;
    return mat;
}

/**
 * Burst particles: soft glowing blobs (additive; fading = the instance colour going to black),
 * bright in the middle and soft at the rim.
 */
function softMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            varying vec3 vN;
            varying vec3 vV;
            varying vec3 vC;
            void main() {
                vec4 wp = modelMatrix * instanceMatrix * vec4( position, 1.0 );
                vN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * normal );
                vV = normalize( cameraPosition - wp.xyz );
                vC = instanceColor;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: `
            varying vec3 vN;
            varying vec3 vV;
            varying vec3 vC;
            void main() {
                float f = abs( dot( normalize( vN ), vV ) );
                gl_FragColor = vec4( vC * ( 0.15 + f * f * 1.1 ), 1.0 );
            }`,
    });
}

/** The burst's flash: an expanding bubble glowing at its rim (additive). */
function flashMaterial(): THREE.ShaderMaterial {
    const m = softMaterial();
    m.fragmentShader = `
            varying vec3 vN;
            varying vec3 vV;
            varying vec3 vC;
            void main() {
                float rim = 1.0 - abs( dot( normalize( vN ), vV ) );
                gl_FragColor = vec4( vC * ( 0.05 + rim * rim * 1.6 ), 1.0 );
            }`;
    return m;
}

/** Soft round contact shadow (an alpha map: white = opaque). */
function blobTexture(): THREE.CanvasTexture {
    const N = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d')!;
    const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.45, '#999');
    grad.addColorStop(1, '#000');
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
    return new THREE.CanvasTexture(cv);
}

/** Deterministic 0..1 hash (particle directions etc.). */
function hash(n: number): number {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

interface KindSet {
    body: THREE.InstancedMesh;
    parts: THREE.InstancedMesh;
    flash: number;
}

export class ItemBoxes {
    readonly group = new THREE.Group();
    readonly field: PickupField;
    private kind: PickupKind = 'coffee';
    /** Kart velocity (units/frame) when each pickup was hit: the burst carries some of it. */
    private readonly hitVel: THREE.Vector3[];
    private readonly sets: Record<PickupKind, KindSet>;
    private readonly steam: THREE.InstancedMesh;
    private readonly lids: THREE.InstancedMesh;
    private readonly blobs: THREE.InstancedMesh;
    private readonly flashes: THREE.InstancedMesh;
    private readonly blobTex = blobTexture();
    private readonly steamTex = steamTexture();
    private readonly time = { value: 0 };
    /** The pickups' hitAt before this frame's check (to find the ones just collected). */
    private readonly before: number[];
    private readonly lastKart = new THREE.Vector3();
    private lastKartFrame = -10;
    private readonly m = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly qTilt = new THREE.Quaternion();
    private readonly e = new THREE.Euler();
    private readonly v = new THREE.Vector3();
    private readonly d = new THREE.Vector3();
    private readonly sc = new THREE.Vector3();
    private readonly col = new THREE.Color();

    /** `rows`: S positions of the pickup rows (each row spans the road). */
    constructor(centerline: Station[], rows: number[]) {
        this.group.name = 'pickups';
        this.field = new PickupField(centerline, rows);
        const N = this.field.pos.length;
        this.hitVel = this.field.pos.map(() => new THREE.Vector3());
        this.before = this.field.hitAt.slice();
        const soft = softMaterial();
        const mk = (body: THREE.BufferGeometry, sweep: boolean, partGeo: THREE.BufferGeometry, flash: number): KindSet => {
            const b = new THREE.InstancedMesh(body, bodyMaterial(this.time, sweep), N);
            const p = new THREE.InstancedMesh(partGeo, soft, PARTS * MAX_BURSTS);
            p.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PARTS * MAX_BURSTS * 3), 3);
            return { body: b, parts: p, flash };
        };
        this.sets = {
            // Sparks: thin streaks, stretched along their flight.
            battery: mk(batteryModel(), true, new THREE.CylinderGeometry(5, 2, 90, 5), 0x6dffae),
            // Fiery puffs.
            gas: mk(gasModel(), false, new THREE.IcosahedronGeometry(28, 2), 0xff8a2a),
            // Steam puffs.
            coffee: mk(coffeeModel(), false, new THREE.IcosahedronGeometry(28, 2), 0xfff1dc),
        };
        this.steam = new THREE.InstancedMesh(
            steamGeometry(),
            new THREE.MeshBasicMaterial({ map: this.steamTex, color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
            N,
        );
        this.lids = new THREE.InstancedMesh(lidModel(), this.sets.coffee.body.material as THREE.Material, MAX_BURSTS);
        // Contact shadows instead of cast ones (at golden hour cast ones streak across the road).
        const blobMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            alphaMap: this.blobTex,
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
        });
        this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2), blobMat, N);
        this.flashes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(85, 3), flashMaterial(), MAX_BURSTS);
        this.flashes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BURSTS * 3), 3);
        for (const m of [...Object.values(this.sets).flatMap((s) => [s.body, s.parts]), this.steam, this.lids, this.blobs, this.flashes]) {
            m.frustumCulled = false;
            this.group.add(m);
        }
        this.setKind('coffee');
    }

    /** Which speed-up the pickups show (the vehicle being raced). */
    setKind(kind: PickupKind): void {
        this.kind = kind;
        for (const [k, s] of Object.entries(this.sets)) s.body.visible = s.parts.visible = k === kind;
        this.steam.visible = kind === 'coffee';
    }

    /** Checks the kart against the pickups after a game frame; returns true when one was collected. */
    check(kart: THREE.Vector3, frame: number): boolean {
        const before = this.before;
        this.field.hitAt.forEach((h, i) => (before[i] = h));
        const got = this.field.check(kart, frame) > 0;
        if (got) {
            const moving = frame - this.lastKartFrame === 1;
            this.field.hitAt.forEach((h, i) => {
                if (h !== before[i]) {
                    if (moving) this.hitVel[i]!.subVectors(kart, this.lastKart);
                    else this.hitVel[i]!.set(0, 0, 0);
                }
            });
        }
        this.lastKart.copy(kart);
        this.lastKartFrame = frame;
        return got;
    }

    reset(): void {
        this.field.reset();
        this.lastKartFrame = -10;
    }

    update(timeSec: number, frame: number): void {
        this.time.value = timeSec;
        const set = this.sets[this.kind];
        const { pos, away, hitAt } = this.field;
        this.steamTex.offset.y = -timeSec * 0.35;
        let bursts = 0;
        pos.forEach((p, i) => {
            let s = 1;
            if (frame < away[i]!) {
                // Pop back in (ease-out-back: a little overshoot) over the last GROW_FRAMES.
                const g = 1 - (away[i]! - frame) / GROW_FRAMES;
                s = g <= 0 ? 0 : 1 + 2.7 * (g - 1) ** 3 + 1.7 * (g - 1) ** 2;
            }
            const bob = Math.sin(timeSec * 2.2 + i * 0.9) * 14;
            this.qTilt.setFromEuler(this.e.set(0, 0, 0.12 + Math.sin(timeSec * 0.9 + i) * 0.05));
            this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, timeSec * 1.5 + i * 0.7).multiply(this.qTilt);
            this.v.set(p.x, p.y + bob, p.z);
            this.m.compose(this.v, this.q, this.sc.setScalar(Math.max(s, 1e-4)));
            set.body.setMatrixAt(i, this.m);
            if (this.kind === 'coffee') this.steam.setMatrixAt(i, this.m);
            // Contact shadow on the road: fades out while the pickup is away, smaller as it rises.
            const b = s * (1 - bob / 60);
            this.v.set(p.x, p.y - HOVER + 4, p.z);
            this.q.identity();
            this.m.compose(this.v, this.q, this.sc.setScalar(Math.max(b, 1e-4)));
            this.blobs.setMatrixAt(i, this.m);
            const age = frame - hitAt[i]!;
            if (age >= 0 && age < BURST_FRAMES && bursts < MAX_BURSTS) this.burst(bursts++, i, age);
        });
        set.body.instanceMatrix.needsUpdate = true;
        this.steam.instanceMatrix.needsUpdate = true;
        this.blobs.instanceMatrix.needsUpdate = true;
        set.parts.count = bursts * PARTS;
        this.flashes.count = bursts;
        this.lids.count = this.kind === 'coffee' ? bursts : 0;
        set.parts.visible = this.flashes.visible = bursts > 0;
        this.lids.visible = this.lids.count > 0;
        if (bursts > 0) {
            set.parts.instanceMatrix.needsUpdate = true;
            set.parts.instanceColor!.needsUpdate = true;
            this.flashes.instanceMatrix.needsUpdate = true;
            this.flashes.instanceColor!.needsUpdate = true;
            this.lids.instanceMatrix.needsUpdate = true;
        }
    }

    /** Burst slot `slot` for pickup `i`, `age` frames after the hit. */
    private burst(slot: number, i: number, age: number): void {
        const p = this.field.pos[i]!;
        const vel = this.hitVel[i]!;
        const set = this.sets[this.kind];
        const k = age / BURST_FRAMES;
        // The burst keeps most of the kart's speed, so it stays in view a moment.
        const carry = this.kind === 'battery' ? 0.75 : 0.7;
        const cx = p.x + vel.x * carry * age;
        const cz = p.z + vel.z * carry * age;
        for (let j = 0; j < PARTS; ++j) {
            const h = i * 31 + j * 7;
            const yaw = ((j + hash(h) * 0.8) / PARTS) * Math.PI * 2;
            let scale: number;
            if (this.kind === 'battery') {
                // Sparks: fast and short-lived, streaking along their flight, green-white.
                const out = 16 + hash(h + 2) * 14;
                const up = 3 + hash(h + 1) * 10;
                const t = Math.min(age, 22);
                const vy = up - 0.9 * t;
                this.v.set(cx + Math.cos(yaw) * out * t, p.y + up * t - 0.45 * t * t, cz + Math.sin(yaw) * out * t);
                this.d.set(Math.cos(yaw) * out + vel.x * 0.75, vy, Math.sin(yaw) * out + vel.z * 0.75).normalize();
                this.q.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this.d);
                const life = 1 - Math.min(1, age / (16 + hash(h + 3) * 8));
                scale = life;
                this.col.set(hash(h + 5) < 0.5 ? 0xeafff2 : j % 3 ? 0x6dffae : 0xfff27a).multiplyScalar(1.4 * life);
            } else {
                // Puffs: fire (gas) or steam (coffee), rising and swelling as they fade.
                const coffee = this.kind === 'coffee';
                const out = (coffee ? 4 : 7) + hash(h + 2) * (coffee ? 4 : 6);
                const up = (coffee ? 3 : 1.5) + hash(h + 1) * (coffee ? 4 : 3);
                this.v.set(cx + Math.cos(yaw) * out * age, p.y - 40 + up * age + (coffee ? 0.04 : 0.02) * age * age, cz + Math.sin(yaw) * out * age);
                this.q.setFromEuler(this.e.set(j, age * 0.1 + j * 2, 0));
                scale = (0.6 + Math.sqrt(k) * (coffee ? 1.5 : 1.3)) * (0.7 + hash(h + 4) * 0.6);
                const fade = (1 - k) ** 1.4;
                if (coffee) this.col.setRGB(1, 0.97, 0.92).multiplyScalar(0.32 * fade);
                else this.col.setRGB(1, 0.55 + 0.35 * (1 - k) * hash(h + 6), 0.12).multiplyScalar(0.8 * fade * (1 - k * 0.5));
            }
            this.m.compose(this.v, this.q, this.sc.setScalar(Math.max(scale, 1e-4)));
            set.parts.setMatrixAt(slot * PARTS + j, this.m);
            set.parts.setColorAt(slot * PARTS + j, this.col);
        }
        // Coffee: the lid pops off, spinning up and away.
        if (this.kind === 'coffee') {
            this.v.set(p.x + vel.x * 0.9 * age, p.y + 80 + 16 * age - 0.55 * age * age, p.z + vel.z * 0.9 * age);
            this.q.setFromEuler(this.e.set(age * 0.35, age * 0.2, age * 0.15));
            this.m.compose(this.v, this.q, this.sc.setScalar(Math.max(0.6 * (1 - k ** 3), 1e-4)));
            this.lids.setMatrixAt(slot, this.m);
        }
        // Flash: a quick expanding glow that fades.
        const f = Math.min(1, age / 10);
        this.v.set(cx, p.y, cz);
        this.q.identity();
        this.m.compose(this.v, this.q, this.sc.setScalar(0.5 + Math.sqrt(f) * 1.0));
        this.flashes.setMatrixAt(slot, this.m);
        this.col.set(set.flash).multiplyScalar((1 - f) ** 1.5 * 0.55);
        this.flashes.setColorAt(slot, this.col);
    }

    dispose(): void {
        this.blobTex.dispose();
        this.steamTex.dispose();
        const mats = new Set<THREE.Material>();
        for (const m of [...Object.values(this.sets).flatMap((s) => [s.body, s.parts]), this.steam, this.lids, this.blobs, this.flashes]) {
            m.geometry.dispose();
            mats.add(m.material as THREE.Material);
        }
        for (const m of mats) m.dispose();
    }
}
