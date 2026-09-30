/** Port of Kinoko source/game/system/map/MapdataStartPoint.{hh,cc}. */

import { CosFIdx, DEG2FIDX, DEG2RAD, fr, SinFIdx } from '../../../egg/math/Math';
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

const SDATA_SIZE = 0x1c;

// We have to define these early so they're available for findKartStartPoint
const X_TRANSLATION_TABLE: readonly (readonly number[])[] = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [-5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [-10, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [-10, 5, -5, 10, 0, 0, 0, 0, 0, 0, 0, 0],
    [-10, 0, 10, -5, 5, 0, 0, 0, 0, 0, 0, 0],
    [-10, -2, 6, -6, 2, 10, 0, 0, 0, 0, 0, 0],
    [-5, 5, -10, 0, 10, -5, 5, 0, 0, 0, 0, 0],
    [-10, 0, 10, -5, 5, -10, 0, 10, 0, 0, 0, 0],
    [-10, -2, 6, -6, 2, 10, -10, -2, 6, 0, 0, 0],
    [-10, 0, 10, -5, 5, -10, 0, 10, -5, 5, 0, 0],
    [-10, -2, 6, -6, 2, 10, -10, -2, 6, -6, 2, 0],
    [-10, -2, 6, -6, 2, 10, -10, -2, 6, -6, 2, 10],
];

const Z_TRANSLATION_TABLE: readonly (readonly number[])[] = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 1, 2, 2, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 2, 2, 2, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 2, 2, 2, 0, 0, 0],
    [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 0, 0],
    [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 0],
    [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
];

export class MapdataStartPoint {
    private m_rawData: MapdataPointer;
    private m_position = new Vector3f();
    private m_rotation = new Vector3f();
    private m_playerIndex = 0;

    constructor(data: MapdataPointer) {
        this.m_rawData = data;
        const stream = streamAt(data, SDATA_SIZE);
        this.read(stream);
    }

    read(stream: RamStream): void {
        readVector3f(stream, this.m_position);
        readVector3f(stream, this.m_rotation);
        if (CourseMap.Instance()!.version() > 1830) {
            this.m_playerIndex = stream.read_s16();
        } else {
            this.m_playerIndex = 0;
        }
    }

    /**
     * @addr{0x80514368}
     * @param pos Out-param (mutated in place).
     * @param angles Out-param (mutated in place).
     */
    findKartStartPoint(
        pos: Vector3f,
        angles: Vector3f,
        placement: number,
        playerCount: number,
    ): void {
        const rotation = Quatf.FromRPY(this.m_rotation.mul(DEG2RAD));
        const zAxis = rotation.rotateVector(Vector3f.ez.neg());
        const xAxis = rotation.rotateVector(Vector3f.ex.neg());

        const courseMap = CourseMap.Instance()!;
        const stageInfo = courseMap.getStageInfo()!;
        const translationDirection = stageInfo.polePosition() === 1 ? -1 : 1;

        const cos = CosFIdx(fr(courseMap.startTmpAngle() * DEG2FIDX));
        const sin = fr(SinFIdx(fr(courseMap.startTmpAngle() * DEG2FIDX)) * translationDirection);

        const xTranslation = translationDirection * X_TRANSLATION_TABLE[playerCount - 1]![0]!;
        const xScalar = fr(
            fr(sin * fr(fr(courseMap.startTmp0() * fr(fr(xTranslation) + 10.0)) / 10.0)) / cos,
        );
        const xTmp = zAxis.neg().mul(xScalar);

        const zTranslation = Z_TRANSLATION_TABLE[playerCount - 1]![placement]!;
        const zScalar = fr(
            fr(
                fr(courseMap.startTmp2() * fr(Math.trunc(zTranslation / 2))) +
                    fr(courseMap.startTmp1() * fr(zTranslation)),
            ) + fr(courseMap.startTmp3() * fr(Math.trunc((zTranslation + 1) / 2))),
        );
        const zTmp = zAxis.mul(zScalar);

        const tmp0 = xTmp.add(zTmp);
        const tmp1 = xAxis.mul(courseMap.startTmp0());
        const tmp2 = tmp0.sub(tmp1);
        const tmpPos = tmp2.add(this.m_position);

        const vCos = xAxis.mul(cos);
        const vSin = zAxis.mul(sin);
        const vRes = vCos.add(vSin);

        const tmpTranslation =
            translationDirection * X_TRANSLATION_TABLE[playerCount - 1]![placement]!;
        const tmpScalar = fr(
            fr(courseMap.startTmp0() * fr(fr(tmpTranslation) + 10.0)) / fr(cos * 10.0),
        );
        const tmpRes = vRes.mul(tmpScalar);

        pos.copy(tmpPos.add(tmpRes));
        angles.copy(this.m_rotation);
    }
}

export class MapdataStartPointAccessor extends MapdataAccessorBase<MapdataStartPoint> {
    /** @addr{0x80514258} */
    constructor(header: MapSectionHeader) {
        super(header);
        if (CourseMap.Instance()!.version() > 1830) {
            this.initEntries(
                this.m_sectionHeader.plus(1),
                this.m_sectionHeader.count(),
                SDATA_SIZE,
                (p) => new MapdataStartPoint(p),
            );
        } else {
            this.initEntries(
                this.m_sectionHeader.plus(4),
                1,
                SDATA_SIZE,
                (p) => new MapdataStartPoint(p),
            );
        }
    }
}
