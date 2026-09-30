/** Port of Kinoko source/game/field/RailManager.{hh,cc}. */

import { CourseMap } from '../system/CourseMap';
import { type Rail, RailLine, RailSpline } from './Rail';

let s_instance: RailManager | null = null; ///< @addr{0x809C22B0}

export class RailManager {
    private m_rails: Rail[] = [];
    private m_totalRails = 0; // u16
    private m_extraInterplatorCount = 0; // u16
    private m_pointCount = 0; // u16

    rail(idx: number): Rail {
        if (idx >= this.m_rails.length) {
            throw new Error(`RailManager::rail: index ${idx} out of range`);
        }
        return this.m_rails[idx]!;
    }

    /** @addr{0x806F09C8} */
    static CreateInstance(): RailManager {
        if (s_instance) throw new Error('RailManager already exists');
        s_instance = new RailManager();
        s_instance.createPaths();
        return s_instance;
    }

    /** @addr{0x806F0A4C} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): RailManager {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x806F0A3C} */
    private constructor() {}

    /** @addr{0x806F0AD8} */
    private createPaths(): void {
        const courseMap = CourseMap.Instance()!;
        this.m_pointCount = courseMap.getPointInfoCount();
        this.m_extraInterplatorCount = 8;
        const geoCount = courseMap.getGeoObjCount();

        for (let i = 0; i < this.m_pointCount; ++i) {
            let isObjectRoute = false;
            const pointInfo = courseMap.getPointInfo(i)!;
            const isSpline = pointInfo.setting(0) !== 0;

            for (let j = 0; j < geoCount; ++j) {
                const geoObj = courseMap.getGeoObj(j)!;

                if (geoObj.pathId() !== i) {
                    continue;
                }

                if (isSpline) {
                    this.m_rails.push(new RailSpline(i, pointInfo));
                } else {
                    this.m_rails.push(new RailLine(i, pointInfo));
                }

                isObjectRoute = true;
                break;
            }

            if (isObjectRoute) {
                continue;
            }

            if (isSpline) {
                this.m_rails.push(new RailSpline(i, pointInfo));
            } else {
                this.m_rails.push(new RailLine(i, pointInfo));
            }
        }
    }
}
