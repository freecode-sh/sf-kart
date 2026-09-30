/**
 * Port of Kinoko source/game/field/obj/ObjectBase.{hh,cc}.
 *
 * C++ has two constructors: `ObjectBase(const MapdataGeoObj &)` and
 * `ObjectBase(const char *name, pos, rot, scale)`; the TS constructor takes either form.
 * `m_boxColUnit` holds a live reference to `m_pos` (BoxColUnit::m_pos), so m_pos is only ever
 * mutated in place.
 *
 * Import-cycle note: this module imports ObjectDirector (runtime), which imports the concrete
 * objects that extend this class. Only reach ObjectBase/ObjectCollidable/concrete objects through
 * ObjectDirector (or with `import type`), never as the first runtime import of the object graph.
 */

import { ResFile } from '../../../abstract/g3d/ResFile';
import { TBitFlag } from '../../../egg/core/BitFlag';
import { abs, CosFIdx, DEG2RAD, fr, RAD2FIDX, SinFIdx } from '../../../egg/math/Math';
import { Matrix34f } from '../../../egg/math/Matrix';
import { Quatf } from '../../../egg/math/Quat';
import { Vector3f } from '../../../egg/math/Vector';
import type { AnmType } from '../../render/AnmMgr';
import { DrawMdl } from '../../render/DrawMdl';
import { CourseMap } from '../../system/CourseMap';
import type { MapdataGeoObj } from '../../system/map/MapdataGeoObj';
import { ArchiveId, ResourceManager } from '../../system/ResourceManager';
import { BoxColManager, type BoxColUnit, eBoxColFlag } from '../BoxColManager';
import { ObjectDirector } from '../ObjectDirector';
import { type RailInterpolator, RailLinearInterpolator, RailSmoothInterpolator } from '../RailInterpolator';
import type { ObjectId } from './ObjectId';

export enum eFlags {
    Position = 0,
    Rotation = 1,
    Matrix = 2,
    Scale = 3,
}

export abstract class ObjectBase {
    static readonly eFlags = eFlags;

    protected m_drawMdl: DrawMdl | null;
    protected m_resFile: ResFile | null;
    protected m_id: ObjectId;
    protected m_railInterpolator: RailInterpolator | null;
    protected m_boxColUnit: BoxColUnit | null = null;
    protected m_mapObj: MapdataGeoObj | null;

    private m_flags = new TBitFlag<eFlags>();
    private m_pos: Vector3f;
    private m_scale: Vector3f;
    private m_rot: Vector3f;
    private m_rotLock: boolean;
    private m_transform: Matrix34f;

    /**
     * @addr{0x8081F828} `ObjectBase(const System::MapdataGeoObj &params)`
     * @addr{0x8081FB04} `ObjectBase(const char *name, pos, rot, scale)`
     */
    constructor(params: MapdataGeoObj);
    constructor(name: string, pos: Readonly<Vector3f>, rot: Readonly<Vector3f>, scale: Readonly<Vector3f>);
    constructor(
        a: MapdataGeoObj | string,
        pos?: Readonly<Vector3f>,
        rot?: Readonly<Vector3f>,
        scale?: Readonly<Vector3f>,
    ) {
        this.m_drawMdl = null;
        this.m_resFile = null;
        this.m_railInterpolator = null;
        this.m_rotLock = true;
        this.m_transform = Matrix34f.ident.clone();

        if (typeof a === 'string') {
            this.m_mapObj = null;
            this.m_pos = pos!.clone();
            this.m_scale = scale!.clone();
            this.m_rot = rot!.clone();
            this.m_flags.setBit(eFlags.Position, eFlags.Rotation, eFlags.Scale);
            this.m_id = ObjectDirector.Instance()!.flowTable().getIdFromName(a);
        } else {
            const params = a;
            this.m_id = params.id() as ObjectId;
            this.m_mapObj = params;
            this.m_pos = params.pos().clone();
            this.m_scale = params.scale().clone();
            this.m_rot = params.rot().mul(DEG2RAD);
            this.m_flags.setBit(eFlags.Position, eFlags.Rotation, eFlags.Scale);
        }
    }

    init(): void {}
    calc(): void {}

    /** @addr{0x808217B8} */
    calcModel(): void {
        this.calcTransform();
    }

    abstract load(): void;

    /** @addr{0x80680730} */
    getResources(): string {
        const flowTable = ObjectDirector.Instance()!.flowTable();
        const collisionSet = flowTable.set(flowTable.slot(this.id()));
        if (!collisionSet) {
            throw new Error(`ObjectBase::getResources: no flow table entry for 0x${this.id().toString(16)}`);
        }
        return collisionSet.resources;
    }

    /** @addr{0x8081FD10} */
    loadGraphics(): void {
        const name = this.getResources();
        if (name === '-') {
            return;
        }

        const filename = `${name}.brres`;

        const resMgr = ResourceManager.Instance()!;
        const resFile = resMgr.getFile(filename, null, ArchiveId.Course);
        if (resFile) {
            this.m_resFile = new ResFile(resFile);
            this.m_drawMdl = new DrawMdl();
        }
    }

    loadAnims(): void {}

    abstract createCollision(): void;

    /** @addr{0x80820980} */
    loadRail(): void {
        if (!this.m_mapObj) {
            return;
        }

        const pathId = this.m_mapObj.pathId();

        if (pathId === -1) {
            return;
        }

        const point = CourseMap.Instance()!.getPointInfo(pathId)!;
        const speed = fr(this.m_mapObj.setting(0));

        if (point.setting(0) === 0) {
            this.m_railInterpolator = new RailLinearInterpolator(speed, pathId);
        } else {
            this.m_railInterpolator = new RailSmoothInterpolator(speed, pathId);
        }
    }

    abstract calcCollisionTransform(): void;

    /** @addr{0x80680784} */
    getName(): string {
        const flowTable = ObjectDirector.Instance()!.flowTable();
        const collisionSet = flowTable.set(flowTable.slot(this.id()));
        if (!collisionSet) {
            throw new Error(`ObjectBase::getName: no flow table entry for 0x${this.id().toString(16)}`);
        }
        return collisionSet.name;
    }

    /** @addr{0x806BF434} */
    loadFlags(): number {
        // TODO: This references LOD to determine load flags
        return 0;
    }

    /** @addr{0x806806DC} */
    getKclName(): string {
        const flowTable = ObjectDirector.Instance()!.flowTable();
        const collisionSet = flowTable.set(flowTable.slot(this.id()));
        if (!collisionSet) {
            throw new Error(`ObjectBase::getKclName: no flow table entry for 0x${this.id().toString(16)}`);
        }
        return collisionSet.resources;
    }

    /** @addr{0x80821DB8} */
    resize(radius: number, maxSpeed: number): void {
        this.m_boxColUnit!.resize(radius, maxSpeed);
    }

    /** @addr{0x80821DD8} */
    unregisterCollision(): void {
        const ref = { value: this.m_boxColUnit };
        BoxColManager.Instance()!.remove(ref);
        this.m_boxColUnit = ref.value;
    }

    /** @addr{0x80821DEC} */
    disableCollision(): void {
        this.m_boxColUnit!.m_flag.setBit(eBoxColFlag.Intangible);
    }

    /** @addr{0x80821E00} */
    enableCollision(): void {
        this.m_boxColUnit!.m_flag.resetBit(eBoxColFlag.Intangible);
    }

    /** @addr{0x80680618} */
    getUnit(): BoxColUnit | null {
        return this.m_boxColUnit;
    }

    railInterpolator(): RailInterpolator | null {
        return this.m_railInterpolator;
    }

    /** @addr{0x80681598} */
    getPosition(): Readonly<Vector3f> {
        return this.m_pos;
    }

    /** @addr{0x8080BDC0} */
    getCollisionRadius(): number {
        return 100.0;
    }

    /** @addr{0x80572574} */
    id(): ObjectId {
        return this.m_id;
    }

    setPos(pos: Readonly<Vector3f>): void {
        this.m_flags.setBit(eFlags.Position);
        this.m_pos.copy(pos);
    }

    addPos(v: Readonly<Vector3f>): void {
        this.m_flags.setBit(eFlags.Position);
        this.m_pos.addEq(v);
    }

    subPos(v: Readonly<Vector3f>): void {
        this.m_flags.setBit(eFlags.Position);
        this.m_pos.subEq(v);
    }

    /** C++ overloads `setScale(const EGG::Vector3f &)` and `setScale(f32)`. */
    setScale(scale: Readonly<Vector3f> | number): void {
        this.m_flags.setBit(eFlags.Scale);
        if (typeof scale === 'number') {
            this.m_scale.setAll(scale);
        } else {
            this.m_scale.copy(scale);
        }
    }

    setRot(rot: Readonly<Vector3f>): void {
        this.m_flags.setBit(eFlags.Rotation);
        this.m_rot.copy(rot);
    }

    setRotNoFlag(rot: Readonly<Vector3f>): void {
        this.m_rot.copy(rot);
    }

    addRot(v: Readonly<Vector3f>): void {
        this.m_rotLock = true;
        this.m_flags.setBit(eFlags.Rotation);
        this.m_rot.addEq(v);
    }

    subRot(v: Readonly<Vector3f>): void {
        this.m_rotLock = true;
        this.m_flags.setBit(eFlags.Rotation);
        this.m_rot.subEq(v);
    }

    /** @addr{0x806C296C} */
    setTransform(mat: Readonly<Matrix34f>): void {
        this.m_rotLock = false;
        this.m_flags.setBit(eFlags.Matrix);
        this.m_transform.copy(mat);
        this.m_pos.copy(mat.base(3));
    }

    pos(): Readonly<Vector3f> {
        return this.m_pos;
    }

    scale(): Readonly<Vector3f> {
        return this.m_scale;
    }

    rot(): Readonly<Vector3f> {
        return this.m_rot;
    }

    transform(): Readonly<Matrix34f> {
        return this.m_transform;
    }

    /** @addr{0x80821640} */
    protected calcTransform(): void {
        if (this.m_flags.onBit(eFlags.Rotation)) {
            this.m_transform.makeRT(this.m_rot, this.m_pos);
            this.m_flags.resetBit(eFlags.Rotation, eFlags.Position);
        } else if (this.m_flags.onBit(eFlags.Position)) {
            this.m_transform.setBase(3, this.m_pos);
            this.m_flags.setBit(eFlags.Matrix);
        }
    }

    protected calcRotLock(): void {
        if (!this.m_rotLock) {
            this.m_rotLock = true;
            this.m_rot.copy(this.m_transform.calcRPY());
        }
    }

    /** @addr{0x80820EB8} */
    protected linkAnims(names: readonly string[], types: readonly AnmType[]): void {
        if (!this.m_drawMdl) {
            return;
        }

        if (names.length !== types.length) {
            throw new Error('ObjectBase::linkAnims: names/types size mismatch');
        }

        for (let i = 0; i < names.length; ++i) {
            this.m_drawMdl.linkAnims(i, this.m_resFile!, names[i]!, types[i]!);
        }
    }

    /** @addr{0x80821910} */
    protected setMatrixTangentTo(up: Readonly<Vector3f>, tangent: Readonly<Vector3f>): void {
        this.m_rotLock = false;
        this.m_flags.setBit(eFlags.Matrix);
        ObjectBase.SetRotTangentHorizontal(this.m_transform, up, tangent);
        this.m_transform.setBase(3, this.m_pos);
    }

    /** @addr{0x808218B0} */
    protected setMatrixFromOrthonormalBasisAndPos(v: Readonly<Vector3f>): void {
        this.m_flags.setBit(eFlags.Matrix);
        this.m_transform.copy(ObjectBase.OrthonormalBasis(v));
        this.m_transform.setBase(3, this.m_pos);
    }

    /** @addr{0x806B38A8} Calculates on what side of line segment ab point lies. */
    protected static CheckPointAgainstLineSegment(
        point: Readonly<Vector3f>,
        a: Readonly<Vector3f>,
        b: Readonly<Vector3f>,
    ): number {
        return fr(fr(fr(b.x - a.x) * fr(point.z - a.z)) - fr(fr(point.x - a.x) * fr(b.z - a.z)));
    }

    /** @addr{0x806B3900} Rotates a vector around the Y-axis and returns the XZ-plane portion of the vector. */
    protected static RotateXZByYaw(angle: number, v: Readonly<Vector3f>): Vector3f {
        const y = SinFIdx(fr(RAD2FIDX * fr(0.5 * angle)));
        const w = CosFIdx(fr(RAD2FIDX * fr(0.5 * angle)));
        const quat = new Quatf(w, 0.0, y, 0.0);
        return quat.rotateVector(new Vector3f(v.x, 0.0, v.z));
    }

    /** @addr{0x806B3AC4} */
    protected static RotateAxisAngle(angle: number, axis: Readonly<Vector3f>, v1: Readonly<Vector3f>): Vector3f {
        const mat = new Matrix34f();
        mat.setBase(3, Vector3f.zero);
        mat.setAxisRotation(angle, axis);
        return mat.ps_multVector(v1);
    }

    /** @addr{0x806B41E0} */
    protected static SetRotTangentHorizontal(
        mat: Matrix34f,
        up: Readonly<Vector3f>,
        tangent: Readonly<Vector3f>,
    ): void {
        const vec = tangent.sub(up.mul(tangent.dot(up)));
        vec.normalise2();

        mat.setBase(0, up.cross(vec));
        mat.setBase(1, up);
        mat.setBase(2, vec);
    }

    /** @addr{0x806B3CA4} */
    protected static OrthonormalBasis(v: Readonly<Vector3f>): Matrix34f {
        const z = v.clone();

        if (abs(z.y) < fr(0.001)) {
            z.y = fr(0.001);
        }

        const h = new Vector3f(v.x, 0.0, v.z);
        h.normalise2();

        const x = z.y > 0.0 ? h.neg().cross(z) : h.cross(z);
        x.normalise2();

        const mat = new Matrix34f();
        mat.setBase(3, Vector3f.zero);
        mat.setBase(0, x);
        mat.setBase(1, z.cross(x));
        mat.setBase(2, z);

        return mat;
    }

    /** @addr{0x806B46A4} */
    protected static RailOrthonormalBasis(railInterpolator: RailInterpolator): Matrix34f {
        const mat = ObjectBase.OrthonormalBasis(railInterpolator.curTangentDir());
        mat.setBase(3, railInterpolator.curPos());
        return mat;
    }

    /** @addr{0x807DE934} `forward` is taken by value. */
    protected static AdjustVecForward(
        sidewaysScalar: number,
        forwardScalar: number,
        minSpeed: number,
        src: Readonly<Vector3f>,
        forwardIn: Readonly<Vector3f>,
    ): Vector3f {
        let forward = forwardIn.clone();
        if (forward.y > 0.0) {
            forward.y = 0.0;
            const [mag, tmp] = forward.ps_normalized();

            if (mag <= 0.0) {
                return src.clone();
            }

            forward = tmp;
        }

        const proj = forward.mul(src.ps_dot(forward));
        const sideways = src.sub(proj).mul(sidewaysScalar);

        let newForward = proj.mul(-forwardScalar);
        if (newForward.squaredLength() < fr(minSpeed * minSpeed)) {
            newForward = forward.mul(minSpeed);
        }

        return sideways.add(newForward);
    }

    /**
     * @addr{0x806B59A8}
     * Solves the standard kinematic equation y(t) = v0 t - 1/2 a t^2.
     */
    protected static CalcParabolicDisplacement(initVel: number, accel: number, frame: number): number {
        const t = fr(frame >>> 0);
        return fr(fr(initVel * t) - fr(t * fr(fr(0.5 * accel) * t)));
    }

    /** @addr{0x8086C098} */
    protected static Interpolate(t: number, v0: Readonly<Vector3f>, v1: Readonly<Vector3f>): Vector3f {
        return v0.add(v1.sub(v0).mul(t));
    }
}
