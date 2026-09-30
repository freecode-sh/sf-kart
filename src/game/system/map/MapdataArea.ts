/** Port of Kinoko source/game/system/map/MapdataArea.{hh,cc}. */

import { DEG2RAD, fr } from '../../../egg/math/Math';
import { Quatf } from '../../../egg/math/Quat';
import { Vector3f } from '../../../egg/math/Vector';
import type { RamStream } from '../../../egg/util/Stream';
import { CourseMap } from '../CourseMap';
import {
    MapdataAccessorBase,
    type MapdataPointer,
    type MapSectionHeader,
    readVector3f,
    streamAt,
} from './MapdataAccessorBase';
import type { MapdataPointInfo } from './MapdataPointInfo';

const SDATA_SIZE = 0x30;

export enum Shape {
    Box = 0,
    Cylinder = 1,
}

export enum Type {
    MovingRoad = 3,
}

export abstract class MapdataAreaBase {
    static readonly Shape = Shape;
    static readonly Type = Type;

    protected m_rawData: MapdataPointer;
    protected m_type: Type = 0 as Type;
    protected m_priority = 0;
    protected m_position = new Vector3f();
    protected m_rotation = new Vector3f();
    protected m_scale = new Vector3f();
    protected m_params: [number, number] = [0, 0];
    protected m_railId = 0;

    protected m_right: Vector3f;
    protected m_up: Vector3f;
    protected m_forward: Vector3f;
    protected m_dimensions: Vector3f;
    protected m_ellipseRadiusSq: number;
    protected m_ellipseAspectRatio: number;
    /** Used to phase out intersection tests early. */
    protected m_sqBoundingSphereRadius: number;
    protected m_index: number;

    /** @addr{0x80516050} */
    constructor(data: MapdataPointer, index: number) {
        this.m_rawData = data;
        this.m_index = index;
        const stream = streamAt(
            data,
            CourseMap.Instance()!.version() > 2200 ? SDATA_SIZE : SDATA_SIZE - 4,
        );
        this.read(stream);

        this.m_sqBoundingSphereRadius = 0.0;
        this.m_ellipseAspectRatio = 0.0;
        this.m_ellipseRadiusSq = 0.0;
        this.m_dimensions = Vector3f.zero.clone();
        this.m_right = Vector3f.zero.clone();
        this.m_up = Vector3f.zero.clone();
        this.m_forward = Vector3f.zero.clone();
    }

    read(stream: RamStream): void {
        stream.skip(1);
        this.m_type = stream.read_s8() as Type;
        stream.skip(1);
        this.m_priority = stream.read_u8();
        readVector3f(stream, this.m_position);
        readVector3f(stream, this.m_rotation);
        readVector3f(stream, this.m_scale);

        for (let i = 0; i < 2; ++i) {
            this.m_params[i] = stream.read_s16();
        }

        if (CourseMap.Instance()!.version() > 2200) {
            this.m_railId = stream.read_s8();
        }
    }

    abstract testImpl(pos: Readonly<Vector3f>): boolean;

    /** @addr{0x805160B0} */
    test(pos: Readonly<Vector3f>): boolean {
        return this.m_position.sub(pos).squaredLength() > this.m_sqBoundingSphereRadius
            ? false
            : this.testImpl(pos);
    }

    /** @addr{0x80516168} */
    getPointInfo(): MapdataPointInfo | null {
        // The rail ID doesn't exist in prior versions, so there's no point info
        const courseMap = CourseMap.Instance()!;
        if (courseMap.version() < 2200) {
            return null;
        }

        return courseMap.getPointInfo(this.m_railId & 0xffff);
    }

    type(): Type {
        return this.m_type;
    }

    priority(): number {
        return this.m_priority;
    }

    param(i: number): number {
        return this.m_params[i]!;
    }

    index(): number {
        return this.m_index;
    }

    protected initRotation(): void {
        const rotation = Quatf.FromRPY3(
            fr(DEG2RAD * this.m_rotation.x),
            fr(DEG2RAD * this.m_rotation.y),
            fr(DEG2RAD * this.m_rotation.z),
        );

        this.m_right = rotation.rotateVector(Vector3f.ex);
        this.m_up = rotation.rotateVector(Vector3f.ey);
        this.m_forward = rotation.rotateVector(Vector3f.ez);
    }
}

export class MapdataAreaBox extends MapdataAreaBase {
    /** @addr{0x80516220} */
    constructor(data: MapdataPointer, index: number) {
        super(data, index);
        this.m_dimensions.x = fr(0.5 * fr(10000.0 * this.m_scale.x));
        this.m_dimensions.y = fr(10000.0 * this.m_scale.y);
        this.m_dimensions.z = fr(0.5 * fr(10000.0 * this.m_scale.z));

        this.m_ellipseAspectRatio = 0.0;
        this.m_ellipseRadiusSq = 0.0;
        this.m_sqBoundingSphereRadius = this.m_dimensions.squaredLength();

        this.initRotation();
    }

    /** @addr{0x805163F4} */
    testImpl(pos: Readonly<Vector3f>): boolean {
        const relPos = pos.sub(this.m_position);

        const u = relPos.dot(this.m_up);
        if (u > this.m_dimensions.y || u < 0.0) {
            return false;
        }

        const r = relPos.dot(this.m_right);
        if (r > this.m_dimensions.x || r < -this.m_dimensions.x) {
            return false;
        }

        const f = relPos.dot(this.m_forward);
        if (f > this.m_dimensions.z || f < -this.m_dimensions.z) {
            return false;
        }

        return true;
    }
}

export class MapdataAreaCylinder extends MapdataAreaBase {
    /** @addr{0x805164FC} */
    constructor(data: MapdataPointer, index: number) {
        super(data, index);
        this.m_dimensions = this.m_scale.mul(5000.0);
        this.m_ellipseRadiusSq = fr(this.m_dimensions.x * this.m_dimensions.x);
        this.m_sqBoundingSphereRadius = fr(
            fr(this.m_dimensions.x * this.m_dimensions.x) +
                fr(this.m_dimensions.z * this.m_dimensions.z),
        );
        this.m_ellipseAspectRatio = fr(this.m_scale.x / this.m_scale.z);

        this.initRotation();
    }

    /** @addr{0x80516688} */
    testImpl(pos: Readonly<Vector3f>): boolean {
        const relPos = pos.sub(this.m_position);

        if (relPos.dot(this.m_up) > this.m_dimensions.y) {
            return false;
        }

        const f = fr(this.m_ellipseAspectRatio * relPos.dot(this.m_forward));
        const r = relPos.dot(this.m_right);
        if (fr(fr(r * r) + fr(f * f)) < this.m_ellipseRadiusSq) {
            return false;
        }

        return true;
    }
}

export class MapdataAreaAccessor extends MapdataAccessorBase<MapdataAreaBase> {
    private m_sortedEntries: (MapdataAreaBase | null)[] = [];

    /** @addr{0x80515E50} */
    constructor(header: MapSectionHeader) {
        super(header);
        this.initAreas(this.m_sectionHeader.plus(1), this.m_sectionHeader.count());

        this.m_sortedEntries = new Array<MapdataAreaBase | null>(this.m_entryCount).fill(null);
    }

    /** C++ `MapdataAreaAccessor::init(const SData *start, u16 count)`. */
    private initAreas(start: MapdataPointer, count: number): void {
        if (count !== 0) {
            this.m_entryCount = count;
            this.m_entries = new Array<MapdataAreaBase>(count);
        }

        const stride = CourseMap.Instance()!.version() > 2200 ? SDATA_SIZE : SDATA_SIZE - 4;

        for (let i = 0; i < count; ++i) {
            // Iterators will be wrong for versions < 2200, so we need to factor out the new members
            const data: MapdataPointer = { data: start.data, offset: start.offset + i * stride };

            // Reading this is safe because 8-bit integers are immune to endianness issues
            const shape = ((data.data[data.offset]! << 24) >> 24) as Shape;

            switch (shape) {
                case Shape.Box:
                    this.m_entries[i] = new MapdataAreaBox(data, i);
                    break;
                case Shape.Cylinder:
                    this.m_entries[i] = new MapdataAreaCylinder(data, i);
                    break;
                default:
                    throw new Error('Invalid area shape!');
            }
        }
    }

    /** @addr{0x80515F8C} */
    sort(): void {
        for (let i = 0; i < this.m_entryCount; ++i) {
            this.m_sortedEntries[i] = this.get(i);
        }

        // NOTE: Faithful to Kinoko (compares against [i] and never writes the moved element).
        for (let i = 1; i < this.m_entryCount; ++i) {
            let j = i;
            for (
                ;
                j > 0 &&
                this.m_sortedEntries[j - 1]!.priority() < this.m_sortedEntries[i]!.priority();
                --j
            ) {
                this.m_sortedEntries[j] = this.m_sortedEntries[j - 1]!;
            }
        }
    }

    getSorted(i: number): MapdataAreaBase | null {
        return i < this.m_entryCount ? this.m_sortedEntries[i]! : null;
    }
}
