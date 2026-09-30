/**
 * Our vehicle data (public/data/vehicles/vehicles.json) and the packer that builds, at load time,
 * the byte layouts the engine parses from it: the vehicle stats and driver tables, the hitbox /
 * wheel file (BSP), the parts display params and the camera params. The engine is untouched and
 * reads the packed bytes as its own files, so the same data always gives the same race.
 *
 * A vehicle's stats are final: the packer writes a neutral driver (all bonuses 0), so the file
 * fully describes how the vehicle drives. Field meanings are in the file's "fields" glossary.
 */

import { type Character, Vehicle } from '../Common';
import { RamStream } from '../egg/util/Stream';
import { KartParam } from '../game/kart/KartParam';
import { ResourceManager } from '../game/system/ResourceManager';
import type { VehicleId } from './vehicles';

/** The file's data path (paths.ts). */
export const VEHICLE_DATA = 'vehicles/vehicles.json';

export type Vec3 = [number, number, number];

/** Everything the engine reads from a vehicle's stats entry. */
export interface VehicleStats {
    body: (typeof BODY_TYPES)[number];
    driftType: (typeof DRIFT_TYPES)[number];
    weightClass: (typeof WEIGHT_CLASSES)[number];
    weight: number;
    bumpDeviation: number;
    topSpeed: number;
    steerSpeedKeep: number;
    tilt: number;
    /** Acceleration at 0, then at each of `accelSpeeds` (fractions of top speed). */
    accel: [number, number, number, number];
    accelSpeeds: [number, number, number];
    driftAccel: [number, number];
    driftAccelSpeeds: [number];
    handlingManual: number;
    handlingAuto: number;
    handlingReactivity: number;
    driftManual: number;
    driftAuto: number;
    driftReactivity: number;
    outsideDriftAngle: number;
    outsideDriftAngleStep: number;
    miniTurboFrames: number;
    /** Per collision surface type (32). */
    surfaceSpeed: number[];
    surfaceTurn: number[];
    maxSuspensionForce: number;
    megaSize: number;
    shrinkSize: number;
}

export interface VehicleHitbox {
    pos: Vec3;
    radius: number;
    wallsOnly: boolean;
    tire: number;
}

export interface VehicleWheel {
    pos: Vec3;
    radius: number;
    collisionRadius: number;
    spring: number;
    damping: number;
    travel: number;
    tiltDeg: number;
}

export interface VehicleCollision {
    rideHeight: number;
    /** Up to 16. */
    hitboxes: VehicleHitbox[];
    inertiaBox: { size: Vec3; offset: Vec3 };
    spinFactor: number;
    /** Up to 4 (karts mirror each one to the other side). */
    wheels: VehicleWheel[];
}

export interface VehicleDisplay {
    cameraHeight: number;
    /** Bikes only. */
    handlebarPos?: Vec3;
    handlebarRotDeg?: Vec3;
}

export interface ChaseCamera {
    fov: number;
    distance: number;
    height: number;
    targetHeight: number;
}

export interface VehicleData {
    class: 'bike' | 'kart';
    stats: VehicleStats;
    collision: VehicleCollision;
    display: VehicleDisplay;
    notes?: string[];
}

export interface VehicleDataFile {
    about: string[];
    /** Bumped whenever the numbers change (recorded runs of another version aren't comparable). */
    version: number;
    fields: Record<string, string>;
    camera: ChaseCamera;
    vehicles: Record<VehicleId, VehicleData>;
}

/**
 * The engine picks code paths by vehicle and driver slot: bike or kart physics (slots 18 and up are
 * bikes), the object-collision hull (a per-slot table in the engine) and, by the driver slot's
 * weight class, which camera entry it reads. Each vehicle's slot is fixed: recorded ghosts store
 * the slots.
 * The packer writes our data into these slots; nothing else in the app needs to know them.
 */
const VEHICLE_SLOTS: Record<VehicleId, Vehicle> = { ebike: 23, robotaxi: 8, buggy: 2 };
/** A heavy-class driver slot; its entry is packed neutral. */
export const DRIVER_SLOT = 9 as Character;

export function vehicleSlot(id: VehicleId): Vehicle {
    return VEHICLE_SLOTS[id];
}

const FIRST_BIKE_SLOT = 18;
/** Driver table entries (the engine indexes up to 25). */
const DRIVER_COUNT = 26;
/** kartCameraParam.bin: 4 entries (screen layouts) per weight class; the engine reads the 2nd. */
const CAMERA_ENTRIES = 12;

/** Stats enums in the engine's order. */
export const BODY_TYPES = ['kart', 'bike', 'bikeVehicleRelative', 'threeWheelKart'] as const;
export const DRIFT_TYPES = ['outsideKart', 'outsideBike', 'inside'] as const;
export const WEIGHT_CLASSES = ['light', 'medium', 'heavy'] as const;

class Writer {
    readonly bytes: Uint8Array;
    private dv: DataView;
    pos = 0;
    constructor(size: number) {
        this.bytes = new Uint8Array(size);
        this.dv = new DataView(this.bytes.buffer);
    }
    f32(v: number): void {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`vehicle data: bad number ${v}`);
        this.dv.setFloat32(this.pos, v, false);
        this.pos += 4;
    }
    f32s(v: readonly number[], n: number): void {
        if (v.length !== n) throw new Error(`vehicle data: expected ${n} numbers, got ${v.length}`);
        for (const x of v) this.f32(x);
    }
    u32(v: number): void {
        this.dv.setUint32(this.pos, v, false);
        this.pos += 4;
    }
    u16(v: number): void {
        this.dv.setUint16(this.pos, v, false);
        this.pos += 2;
    }
    skip(n: number): void {
        this.pos += n;
    }
}

function indexOf<T>(list: readonly T[], v: T, what: string): number {
    const i = list.indexOf(v);
    if (i < 0) throw new Error(`vehicle data: unknown ${what} "${String(v)}"`);
    return i;
}

/** One stats entry (KartParam.Stats layout). */
function packStats(s: VehicleStats): Uint8Array {
    const w = new Writer(KartParam.Stats.SIZE);
    w.u32(indexOf(BODY_TYPES, s.body, 'body'));
    w.u32(indexOf(DRIFT_TYPES, s.driftType, 'driftType'));
    w.u32(indexOf(WEIGHT_CLASSES, s.weightClass, 'weightClass'));
    w.skip(4); // unused
    w.f32(s.weight);
    w.f32(s.bumpDeviation);
    w.f32(s.topSpeed);
    w.f32(s.steerSpeedKeep);
    w.f32(s.tilt);
    w.f32s(s.accel, 4);
    w.f32s(s.accelSpeeds, 3);
    w.f32s(s.driftAccel, 2);
    w.f32s(s.driftAccelSpeeds, 1);
    w.f32(s.handlingManual);
    w.f32(s.handlingAuto);
    w.f32(s.handlingReactivity);
    w.f32(s.driftManual);
    w.f32(s.driftAuto);
    w.f32(s.driftReactivity);
    w.f32(s.outsideDriftAngle);
    w.f32(s.outsideDriftAngleStep);
    w.u32(s.miniTurboFrames);
    w.f32s(s.surfaceSpeed, 32);
    w.f32s(s.surfaceTurn, 32);
    w.skip(16); // unused
    w.f32(s.maxSuspensionForce);
    w.f32(s.megaSize);
    w.f32(s.shrinkSize);
    return w.bytes;
}

/** The stats as the engine sees them (for live tuning). */
export function engineStats(s: VehicleStats): KartParam.Stats {
    return new KartParam.Stats(RamStream.from(packStats(s)));
}

/** A BSP file (hitboxes, inertia, wheels and suspension). */
function packCollision(c: VehicleCollision): Uint8Array {
    if (c.hitboxes.length > 16 || c.wheels.length > 4) throw new Error('vehicle data: too many hitboxes or wheels');
    const w = new Writer(0x25c);
    w.f32(c.rideHeight);
    for (let i = 0; i < 16; ++i) {
        const h = c.hitboxes[i];
        if (!h) {
            w.skip(24);
            continue;
        }
        w.u16(1);
        w.skip(2);
        w.f32s(h.pos, 3);
        w.f32(h.radius);
        w.u16(h.wallsOnly ? 1 : 0);
        w.u16(h.tire);
    }
    w.f32s(c.inertiaBox.size, 3);
    w.f32s(c.inertiaBox.offset, 3);
    w.f32(c.spinFactor);
    w.skip(4); // unused
    for (let i = 0; i < 4; ++i) {
        const wh = c.wheels[i];
        if (!wh) {
            w.skip(44);
            continue;
        }
        w.u16(1);
        w.skip(2);
        w.f32(wh.spring);
        w.f32(wh.damping);
        w.f32(wh.travel);
        w.f32s(wh.pos, 3);
        w.f32(wh.tiltDeg);
        w.f32(wh.radius);
        w.f32(wh.collisionRadius);
        w.skip(4); // unused
    }
    // The last fields (rumble animation height and speed) are visual only, unused by the physics: left zero.
    return w.bytes;
}

/** kartParam.bin with every vehicle in its slot; `override` replaces a vehicle's stats (tuning). */
export function packKartParam(data: VehicleDataFile, override?: Partial<Record<VehicleId, VehicleStats>>): Uint8Array {
    const size = KartParam.Stats.SIZE;
    const out = new Uint8Array(4 + Vehicle.Max * size);
    new DataView(out.buffer).setUint32(0, Vehicle.Max, false);
    for (const [id, v] of Object.entries(data.vehicles) as [VehicleId, VehicleData][]) {
        out.set(packStats(override?.[id] ?? v.stats), 4 + vehicleSlot(id) * size);
    }
    return out;
}

function table(count: number, entrySize: number, header = true): { bytes: Uint8Array; at: (i: number) => number } {
    const h = header ? 4 : 0;
    const bytes = new Uint8Array(h + count * entrySize);
    if (header) new DataView(bytes.buffer).setUint32(0, count, false);
    return { bytes, at: (i) => h + i * entrySize };
}

/**
 * The engine's core files for our vehicles, keyed by the names it opens (kartParam.bin, ...,
 * bsp/<slot name>.bsp). Slots we don't use stay zero.
 */
export function packVehicleFiles(data: VehicleDataFile): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    files.set('kartParam.bin', packKartParam(data));
    files.set('driverParam.bin', table(DRIVER_COUNT, KartParam.Stats.SIZE).bytes);

    const bikeDisp = table(Vehicle.Max - FIRST_BIKE_SLOT, KartParam.BikeDisp.SIZE);
    const kartDisp = table(FIRST_BIKE_SLOT, KartParam.KartDisp.SIZE);
    for (const [id, v] of Object.entries(data.vehicles) as [VehicleId, VehicleData][]) {
        const slot = vehicleSlot(id);
        const bike = slot >= FIRST_BIKE_SLOT;
        if (bike !== (v.class === 'bike')) throw new Error(`vehicle data: ${id} is a ${v.class} but its slot is a ${bike ? 'bike' : 'kart'}`);
        const d = new DataView((bike ? bikeDisp : kartDisp).bytes.buffer);
        let o = bike ? bikeDisp.at(slot - FIRST_BIKE_SLOT) : kartDisp.at(slot);
        d.setFloat32(o, v.display.cameraHeight, false);
        if (bike) {
            o += 12;
            for (const x of [...(v.display.handlebarPos ?? [0, 0, 0]), ...(v.display.handlebarRotDeg ?? [0, 0, 0])]) {
                d.setFloat32(o, x, false);
                o += 4;
            }
        }
        files.set(`bsp/${ResourceManager.GetVehicleName(slot)}.bsp`, packCollision(v.collision));
    }
    files.set('bikePartsDispParam.bin', bikeDisp.bytes);
    files.set('kartPartsDispParam.bin', kartDisp.bytes);

    // The same chase camera for every weight class, so it doesn't depend on the driver slot.
    const cam = table(CAMERA_ENTRIES, KartParam.KartCameraParam.SIZE, false);
    const cd = new DataView(cam.bytes.buffer);
    for (let wc = 0; wc < 3; ++wc) {
        const o = cam.at(wc * 4 + 1);
        const c = data.camera;
        [c.fov, c.distance, c.height, c.targetHeight].forEach((x, i) => cd.setFloat32(o + i * 4, x, false));
    }
    files.set('kartCameraParam.bin', cam.bytes);
    return files;
}
