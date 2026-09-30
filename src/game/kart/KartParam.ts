/** Port of Kinoko's game/kart/KartParam.{hh,cc}. */

import { type Character, Vehicle, type WeightClass } from '../../Common';
import { fr } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';
import type { RamStream } from '../../egg/util/Stream';

import { KartParamFileManager } from './KartParamFileManager';

/** C++ `EGG::Vector3f::read(stream)`: reads x, y, z in order. */
function readVector3f(v: Vector3f, stream: RamStream): void {
    v.x = stream.read_f32();
    v.y = stream.read_f32();
    v.z = stream.read_f32();
}

/** C++ implicit f32 -> u16 conversion. */
function f32ToU16(f: number): number {
    return Math.trunc(f) & 0xffff;
}

/** Houses hitbox and wheel positions, radii, and suspension info. */
export class BSP {
    initialYPos = 0.0;
    /** Array of vehicle hitboxes, not all of which are active. */
    readonly hitboxes: BSP.Hitbox[] = [];
    /** Mask cuboids for computing moment of inertia. */
    readonly cuboids: [Vector3f, Vector3f] = [new Vector3f(), new Vector3f()];
    angVel0Factor = 0.0;
    _1a0 = 0.0;
    readonly wheels: BSP.Wheel[] = [];
    /** Max vertical distance of the vehicle body's rumble animation. */
    rumbleHeight = 0.0;
    /** Speed of the vehicle body's rumble animation (u16). */
    rumbleSpeed = 0;

    constructor(stream?: RamStream) {
        for (let i = 0; i < 16; ++i) this.hitboxes.push(new BSP.Hitbox());
        for (let i = 0; i < 4; ++i) this.wheels.push(new BSP.Wheel());

        if (stream) {
            this.read(stream);
        }
    }

    read(stream: RamStream): void {
        this.initialYPos = stream.read_f32();

        for (const hitbox of this.hitboxes) {
            hitbox.enable = stream.read_u16();
            stream.skip(2);
            readVector3f(hitbox.position, stream);
            hitbox.radius = stream.read_f32();
            hitbox.wallsOnly = stream.read_u16();
            hitbox.tireCollisionIdx = stream.read_u16();
        }

        readVector3f(this.cuboids[0], stream);
        readVector3f(this.cuboids[1], stream);
        this.angVel0Factor = stream.read_f32();
        this._1a0 = stream.read_f32();

        for (const wheel of this.wheels) {
            wheel.enable = stream.read_u16();
            stream.skip(2);
            wheel.springStiffness = stream.read_f32();
            wheel.dampingFactor = stream.read_f32();
            wheel.maxTravel = stream.read_f32();
            readVector3f(wheel.relPosition, stream);
            wheel.xRot = stream.read_f32();
            wheel.wheelRadius = stream.read_f32();
            wheel.sphereRadius = stream.read_f32();
            wheel._28 = stream.read_u32();
        }

        this.rumbleHeight = stream.read_f32();
        // C++ assigns read_f32() to a u16 member
        this.rumbleSpeed = f32ToU16(stream.read_f32());
    }
}

export namespace BSP {
    /** Represents one of the many hitboxes that make up a vehicle. */
    export class Hitbox {
        /** Specifies if this is an active hitbox (since BSP always has 16). */
        enable = 0;
        /** The relative position of the hitbox. */
        readonly position = new Vector3f();
        radius = 0.0;
        wallsOnly = 0;
        tireCollisionIdx = 0;
    }

    /** Info pertaining to the suspension, position, etc. of a wheel. */
    export class Wheel {
        enable = 0;
        springStiffness = 0.0;
        dampingFactor = 0.0;
        maxTravel = 0.0;
        readonly relPosition = new Vector3f();
        xRot = 0.0;
        wheelRadius = 0.0;
        sphereRadius = 0.0;
        _28 = 0;
    }

    /** sizeof(BSP) */
    export const SIZE = 0x25c;
}

/** Houses stats regarding a given character/vehicle combo. */
export class KartParam {
    private m_stats: KartParam.Stats = new KartParam.Stats();
    private m_bikeDisp: KartParam.BikeDisp = new KartParam.BikeDisp();
    private m_kartDisp: KartParam.KartDisp = new KartParam.KartDisp();
    private m_bsp: BSP = new BSP();
    private m_camera: KartParam.KartCameraParam = new KartParam.KartCameraParam();
    private m_playerIdx = 0;
    private m_isBike = false;
    private m_suspCount = 0;
    private m_tireCount = 0;

    constructor(character: Character, vehicle: Vehicle, playerIdx: number) {
        this.initStats(character, vehicle);
        this.initHitboxes(vehicle);
        this.m_playerIdx = playerIdx & 0xff;
        this.m_isBike = vehicle >= Vehicle.Standard_Bike_S;
        if (this.m_isBike) {
            this.initBikeDispParams(vehicle);
        } else {
            this.initKartDispParams(vehicle);
        }

        this.initCameraParams(character);
    }

    setTireCount(tireCount: number): void {
        this.m_tireCount = tireCount & 0xffff;
    }

    setSuspCount(suspCount: number): void {
        this.m_suspCount = suspCount & 0xffff;
    }

    bsp(): BSP {
        return this.m_bsp;
    }

    stats(): KartParam.Stats {
        return this.m_stats;
    }

    bikeDisp(): KartParam.BikeDisp {
        return this.m_bikeDisp;
    }

    kartDisp(): KartParam.KartDisp {
        return this.m_kartDisp;
    }

    /** @addr{0x805927D4} */
    camera(): KartParam.KartCameraParam {
        return this.m_camera;
    }

    playerIdx(): number {
        return this.m_playerIdx;
    }

    isBike(): boolean {
        return this.m_isBike;
    }

    isVehicleRelativeBike(): boolean {
        return this.m_stats.body === KartParam.Stats.Body.Vehicle_Relative_Bike;
    }

    suspCount(): number {
        return this.m_suspCount;
    }

    tireCount(): number {
        return this.m_tireCount;
    }

    /** @addr{0x80591FA4} */
    private initStats(character: Character, vehicle: Vehicle): void {
        const fileManager = KartParamFileManager.Instance();

        const vehicleStream = fileManager.getVehicleStream(vehicle);
        const driverStream = fileManager.getDriverStream(character);

        this.m_stats = new KartParam.Stats(vehicleStream);
        this.m_stats.applyCharacterBonus(driverStream);
    }

    private initBikeDispParams(vehicle: Vehicle): void {
        const fileManager = KartParamFileManager.Instance();

        const dispParamsStream = fileManager.getBikeDispParamsStream(vehicle);
        this.m_bikeDisp = new KartParam.BikeDisp(dispParamsStream);
    }

    private initKartDispParams(vehicle: Vehicle): void {
        const fileManager = KartParamFileManager.Instance();

        const dispParamsStream = fileManager.getKartDispParamsStream(vehicle);
        this.m_kartDisp = new KartParam.KartDisp(dispParamsStream);
    }

    private initHitboxes(vehicle: Vehicle): void {
        const fileManager = KartParamFileManager.Instance();

        const hitboxStream = fileManager.getHitboxStream(vehicle);
        this.m_bsp = new BSP(hitboxStream);
    }

    private initCameraParams(character: Character): void {
        const fileManager = KartParamFileManager.Instance();

        const cameraStream = fileManager.getKartCameraStream(character);
        this.m_camera = new KartParam.KartCameraParam(cameraStream);
    }
}

export namespace KartParam {
    export class BikeDisp {
        m_cameraDistY = 0.0;
        readonly m_handlePos = new Vector3f();
        readonly m_handleRot = new Vector3f();

        constructor(stream?: RamStream) {
            if (stream) {
                this.read(stream);
            }
        }

        read(stream: RamStream): void {
            this.m_cameraDistY = stream.read_f32();
            stream.skip(0x8);
            readVector3f(this.m_handlePos, stream);
            readVector3f(this.m_handleRot, stream);
        }

        /** sizeof(BikeDisp) */
        static readonly SIZE = 0xb0;
    }

    export class KartDisp {
        m_cameraDistY = 0.0;

        constructor(stream?: RamStream) {
            if (stream) {
                this.read(stream);
            }
        }

        read(stream: RamStream): void {
            this.m_cameraDistY = stream.read_f32();
        }

        /** sizeof(KartDisp) */
        static readonly SIZE = 0x150;
    }

    /** Various character/vehicle-related handling and speed stats. */
    export class Stats {
        body: Stats.Body = Stats.Body.Four_Wheel_Kart;
        driftType: Stats.DriftType = Stats.DriftType.Outside_Drift_Kart;
        weightClass: WeightClass = 0;
        /** @unused */
        _00c = 0.0;

        /** Contrary to popular belief, this does not affect gravity. */
        weight = 0.0;
        bumpDeviationLevel = 0.0;
        /** Base full speed of the character/vehicle combo. */
        speed = 0.0;
        /** Speed decrement percentage of the vehicle when handling. */
        turningSpeed = 0.0;
        tilt = 0.0;
        readonly accelerationStandardA: number[] = [0.0, 0.0, 0.0, 0.0];
        readonly accelerationStandardT: number[] = [0.0, 0.0, 0.0];
        readonly accelerationDriftA: number[] = [0.0, 0.0];
        readonly accelerationDriftT: number[] = [0.0];
        handlingManualTightness = 0.0;
        handlingAutomaticTightness = 0.0;
        handlingReactivity = 0.0;
        driftManualTightness = 0.0;
        driftAutomaticTightness = 0.0;
        driftReactivity = 0.0;
        driftOutsideTargetAngle = 0.0;
        driftOutsideDecrement = 0.0;
        /** The framecount duration of a charged mini-turbo (u32). */
        miniTurbo = 0;
        /** Speed multipliers, indexed using KCL attributes. */
        readonly kclSpeed: number[] = new Array<number>(32).fill(0.0);
        /** Rotation scalars, indexed using KCL attributes. */
        readonly kclRot: number[] = new Array<number>(32).fill(0.0);
        itemUnk170 = 0.0;
        itemUnk174 = 0.0;
        itemUnk178 = 0.0;
        itemUnk17c = 0.0;
        maxNormalAcceleration = 0.0;
        megaScale = 0.0;
        shrinkScale = 0.0;

        constructor(stream?: RamStream) {
            if (stream) {
                this.read(stream);
            }
        }

        /** Parses out the stats for a given KartParam.bin stream. */
        read(stream: RamStream): void {
            this.body = stream.read_s32();
            this.driftType = stream.read_s32();
            this.weightClass = stream.read_s32();
            this._00c = stream.read_f32();
            this.weight = stream.read_f32();
            this.bumpDeviationLevel = stream.read_f32();
            this.speed = stream.read_f32();
            this.turningSpeed = stream.read_f32();
            this.tilt = stream.read_f32();
            this.accelerationStandardA[0] = stream.read_f32();
            this.accelerationStandardA[1] = stream.read_f32();
            this.accelerationStandardA[2] = stream.read_f32();
            this.accelerationStandardA[3] = stream.read_f32();
            this.accelerationStandardT[0] = stream.read_f32();
            this.accelerationStandardT[1] = stream.read_f32();
            this.accelerationStandardT[2] = stream.read_f32();
            this.accelerationDriftA[0] = stream.read_f32();
            this.accelerationDriftA[1] = stream.read_f32();
            this.accelerationDriftT[0] = stream.read_f32();
            this.handlingManualTightness = stream.read_f32();
            this.handlingAutomaticTightness = stream.read_f32();
            this.handlingReactivity = stream.read_f32();
            this.driftManualTightness = stream.read_f32();
            this.driftAutomaticTightness = stream.read_f32();
            this.driftReactivity = stream.read_f32();
            this.driftOutsideTargetAngle = stream.read_f32();
            this.driftOutsideDecrement = stream.read_f32();
            this.miniTurbo = stream.read_u32();

            for (let i = 0; i < this.kclSpeed.length; ++i) {
                this.kclSpeed[i] = stream.read_f32();
            }
            for (let i = 0; i < this.kclRot.length; ++i) {
                this.kclRot[i] = stream.read_f32();
            }

            this.itemUnk170 = stream.read_f32();
            this.itemUnk174 = stream.read_f32();
            this.itemUnk178 = stream.read_f32();
            this.itemUnk17c = stream.read_f32();
            this.maxNormalAcceleration = stream.read_f32();
            this.megaScale = stream.read_f32();
            this.shrinkScale = stream.read_f32();
        }

        /**
         * Applies character stats on top of the kart stats.
         * NOTE: The accelerationStandardT bonuses are (faithfully) added to accelerationStandardA.
         */
        applyCharacterBonus(stream: RamStream): void {
            stream.skip(0x10);
            this.weight = fr(this.weight + stream.read_f32());

            stream.skip(0x4);
            this.speed = fr(this.speed + stream.read_f32());
            this.turningSpeed = fr(this.turningSpeed + stream.read_f32());

            stream.skip(0x4);
            const A = this.accelerationStandardA;
            A[0] = fr(A[0]! + stream.read_f32());
            A[1] = fr(A[1]! + stream.read_f32());
            A[2] = fr(A[2]! + stream.read_f32());
            A[3] = fr(A[3]! + stream.read_f32());
            A[0] = fr(A[0]! + stream.read_f32());
            A[1] = fr(A[1]! + stream.read_f32());
            A[2] = fr(A[2]! + stream.read_f32());
            this.accelerationDriftA[0] = fr(this.accelerationDriftA[0]! + stream.read_f32());
            this.accelerationDriftA[1] = fr(this.accelerationDriftA[1]! + stream.read_f32());
            this.accelerationDriftT[0] = fr(this.accelerationDriftT[0]! + stream.read_f32());
            this.handlingManualTightness = fr(this.handlingManualTightness + stream.read_f32());
            this.handlingAutomaticTightness = fr(
                this.handlingAutomaticTightness + stream.read_f32(),
            );
            this.handlingReactivity = fr(this.handlingReactivity + stream.read_f32());
            this.driftManualTightness = fr(this.driftManualTightness + stream.read_f32());
            this.driftAutomaticTightness = fr(this.driftAutomaticTightness + stream.read_f32());
            this.driftReactivity = fr(this.driftReactivity + stream.read_f32());
            this.driftOutsideTargetAngle = fr(this.driftOutsideTargetAngle + stream.read_f32());
            this.driftOutsideDecrement = fr(this.driftOutsideDecrement + stream.read_f32());
            this.miniTurbo = (this.miniTurbo + stream.read_u32()) >>> 0;

            for (let i = 0; i < this.kclSpeed.length; ++i) {
                this.kclSpeed[i] = fr(this.kclSpeed[i]! + stream.read_f32());
            }

            for (let i = 0; i < this.kclRot.length; ++i) {
                this.kclRot[i] = fr(this.kclRot[i]! + stream.read_f32());
            }
        }

        /** sizeof(Stats) */
        static readonly SIZE = 0x18c;
    }

    export namespace Stats {
        /** The body style of the vehicle. Basically the number of wheels. */
        export enum Body {
            Four_Wheel_Kart = 0,
            Handle_Relative_Bike = 1,
            Vehicle_Relative_Bike = 2,
            Three_Wheel_Kart = 3,
        }

        /** The type of drift (inside/outside). */
        export enum DriftType {
            Outside_Drift_Kart = 0,
            Outside_Drift_Bike = 1,
            Inside_Drift_Bike = 2,
        }
    }

    export class KartCameraParam {
        fov = 0.0;
        dist = 0.0;
        posY = 0.0;
        targetPosY = 0.0;

        constructor(stream?: RamStream) {
            if (stream) {
                this.read(stream);
            }
        }

        read(stream: RamStream): void {
            this.fov = stream.read_f32();
            this.dist = stream.read_f32();
            this.posY = stream.read_f32();
            this.targetPosY = stream.read_f32();
        }

        /** sizeof(KartCameraParam) */
        static readonly SIZE = 0x10;
    }
}

// Flat alias for the nested C++ type `KartParam::Stats`. Either spelling works.
export type Stats = KartParam.Stats;
export const Stats = KartParam.Stats;
