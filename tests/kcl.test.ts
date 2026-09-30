/**
 * World (field/system) smoke tests: KCL queries on an in-memory KCL, and parsing of the generated
 * course files (public/data/courses/golden_gate/course.{kcl,kmp}) when present.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeKCL, type Tri } from '../tools/course/lib/kcl';
import { box } from '../src/egg/core/Box';
import { fr } from '../src/egg/math/Math';
import { Vector3f } from '../src/egg/math/Vector';
import { KColData } from '../src/game/field/KColData';
import {
    COL_TYPE_ROAD,
    COL_TYPE_WALL,
    KCL_ANY,
    KCL_ATTRIBUTE_TYPE,
    KCL_TYPE_B0E82DFF,
    KCL_TYPE_DIRECTIONAL,
    KCL_TYPE_DRIVER_FLOOR,
    KCL_TYPE_DRIVER_SOLID_SURFACE,
    KCL_TYPE_DRIVER_WALL,
    KCL_TYPE_FLOOR,
    KCL_TYPE_NON_DIRECTIONAL,
    KCL_TYPE_SOLID_SURFACE,
    KCL_TYPE_VEHICLE_COLLIDEABLE,
    KCL_TYPE_VEHICLE_INTERACTABLE,
    KCL_TYPE_WALL,
} from '../src/game/field/KCollisionTypes';
import { CourseMap } from '../src/game/system/CourseMap';
import { ArchiveId, ResourceManager } from '../src/game/system/ResourceManager';

function floorKcl(): Uint8Array {
    const S = 1000;
    const tris: Tri[] = [
        // Floor at y = 0 (normal +Y)
        { a: [-S, 0, -S], b: [-S, 0, S], c: [S, 0, S], attr: COL_TYPE_ROAD },
        { a: [-S, 0, -S], b: [S, 0, S], c: [S, 0, -S], attr: COL_TYPE_ROAD },
        // Wall at x = S facing -X
        { a: [S, 0, -S], b: [S, 0, S], c: [S, 500, S], attr: COL_TYPE_WALL },
        { a: [S, 0, -S], b: [S, 500, S], c: [S, 500, -S], attr: COL_TYPE_WALL },
    ];
    return encodeKCL(tris, {
        prismThickness: 300,
        sphereRadius: 250,
        maxTrisPerLeaf: 12,
        minLeafShift: 8,
        rootShift: 12,
        margin: 2000,
    }).bytes;
}

describe('KCollisionTypes', () => {
    it('masks match the documented values', () => {
        expect(KCL_TYPE_DIRECTIONAL).toBe(0x05070000);
        expect(KCL_TYPE_SOLID_SURFACE).toBe(0xf0f8ffff);
        expect(KCL_TYPE_FLOOR).toBe(0x20e80fff);
        expect(KCL_TYPE_DRIVER_FLOOR).toBe(0x20e80dff);
        expect(KCL_TYPE_WALL).toBe(0xd010f000);
        expect(KCL_TYPE_DRIVER_WALL).toBe(0xc010b000);
        expect(KCL_TYPE_VEHICLE_INTERACTABLE).toBe(0xefffbdff);
        expect(KCL_TYPE_VEHICLE_COLLIDEABLE).toBe(0xeaf8bdff);
        expect(KCL_TYPE_NON_DIRECTIONAL).toBe(0xe0f8bdff);
        expect(KCL_TYPE_DRIVER_SOLID_SURFACE).toBe(0xeafabdff);
        expect(KCL_TYPE_B0E82DFF).toBe(0xb0e82dff);
    });
});

describe('KColData', () => {
    const data = new KColData(floorKcl());

    it('finds the floor under a sphere', () => {
        const pos = new Vector3f(0, 50, 0);
        data.lookupSphere(100, pos, Vector3f.inf, KCL_ANY);
        const dist = box(0);
        const nrm = new Vector3f();
        const attr = box(0);
        const hits: number[] = [];
        while (data.checkSphereCollision(dist, nrm, attr)) {
            hits.push(dist.value);
            expect(nrm.y).toBe(1);
            expect(KCL_ATTRIBUTE_TYPE(attr.value)).toBe(COL_TYPE_ROAD);
        }
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]).toBe(50);
    });

    it('finds nothing far above the floor', () => {
        data.lookupSphere(100, new Vector3f(0, 500, 0), Vector3f.inf, KCL_ANY);
        expect(data.checkSphereCollision(null, null, null)).toBe(false);
    });

    it('finds the wall and respects the type mask', () => {
        const pos = new Vector3f(fr(1000 - 30), 200, 0);
        data.lookupSphere(100, pos, Vector3f.inf, KCL_TYPE_WALL);
        const dist = box(0);
        const nrm = new Vector3f();
        expect(data.checkSphereCollision(dist, nrm, null)).toBe(true);
        expect(dist.value).toBe(70);
        expect(nrm.x).toBe(-1);

        data.lookupSphere(100, pos, Vector3f.inf, KCL_TYPE_FLOOR);
        expect(data.checkSphereCollision(null, null, null)).toBe(false);
    });

    it('narrows the prism cache and queries it', () => {
        const pos = new Vector3f(0, 50, 0);
        data.narrowScopeLocal(pos, 250, KCL_ANY);
        expect(data.prismCache(0)).not.toBe(0);
        data.lookupSphereCached(pos, Vector3f.inf, KCL_ANY, 100);
        const dist = box(0);
        expect(data.checkSphereCollision(dist, null, null)).toBe(true);
        expect(dist.value).toBe(50);
    });

    it('returns null outside the octree', () => {
        expect(data.searchBlock(new Vector3f(1e7, 0, 0))).toBeNull();
    });
});

const KCL_PATH = 'public/data/courses/golden_gate/course.kcl';
const KMP_PATH = 'public/data/courses/golden_gate/course.kmp';

describe.skipIf(!existsSync(KCL_PATH) || !existsSync(KMP_PATH))('generated course', () => {
    it('parses the KMP and finds the start point, checkpoints and the floor', () => {
        const kcl = new Uint8Array(readFileSync(KCL_PATH));
        const kmp = new Uint8Array(readFileSync(KMP_PATH));

        ResourceManager.CreateInstance();
        try {
            const resMgr = ResourceManager.Instance();
            resMgr.registerFile(ArchiveId.Course, 'course.kcl', kcl);
            resMgr.registerFile(ArchiveId.Course, 'course.kmp', kmp);

            CourseMap.CreateInstance().init();
            const courseMap = CourseMap.Instance();
            expect(courseMap.getStartPointCount()).toBeGreaterThan(0);
            expect(courseMap.getCheckPointCount()).toBeGreaterThan(0);
            expect(courseMap.getCheckPathCount()).toBeGreaterThan(0);

            const pos = new Vector3f();
            const rot = new Vector3f();
            courseMap.getStartPoint(0)!.findKartStartPoint(pos, rot, 0, 1);
            expect(Number.isFinite(pos.x) && Number.isFinite(pos.z)).toBe(true);

            const ratio = box(0);
            const sector = courseMap.findSector(pos, 0, ratio);
            expect(sector).toBeGreaterThanOrEqual(0);

            const data = new KColData(resMgr.getFile('course.kcl', null, ArchiveId.Course)!);
            const probe = new Vector3f(pos.x, fr(pos.y + 50), pos.z);
            data.lookupSphere(100, probe, Vector3f.inf, KCL_TYPE_FLOOR);
            expect(data.checkSphereCollision(null, null, null)).toBe(true);
        } finally {
            CourseMap.DestroyInstance();
            ResourceManager.DestroyInstance();
        }
    });
});
