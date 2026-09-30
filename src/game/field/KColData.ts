/**
 * Port of Kinoko source/game/field/KColData.{hh,cc}.
 *
 * Credit: em-eight/mkw, stblr/Hanachan
 *
 * Pointer representation: C++ keeps `const u16 *m_prismIter`, which may point into the KCL block
 * data (a list of big-endian prism indices) or into the local prism cache. In TS the iterator is
 * the pair (m_prismIterArr, m_prismIterIdx). Block data prism lists are pre-parsed into a native
 * Uint16Array (`m_blockU16`) indexed by (byte offset from the block data start) / 2. The prism
 * cache stores already-parsed values; since every comparison in C++ is between raw values of the
 * same endianness, comparing parsed values is equivalent.
 */

import type { Box } from '../../egg/core/Box';
import { Sphere3f } from '../../egg/geom/Sphere';
import { BoundBox3f } from '../../egg/math/BoundBox';
import { fmax, fmin, fr, sqrt } from '../../egg/math/Math';
import type { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';
import { RamStream } from '../../egg/util/Stream';
import {
    KCL_ATTRIBUTE_TYPE_BIT,
    KCL_TYPE_DIRECTIONAL,
    KCL_TYPE_FLOOR,
    KCL_TYPE_WALL,
    KCOL_HEADER_SIZE,
    type KCLTypeMask,
} from './KCollisionTypes';

/** std::numeric_limits<f32>::min() (smallest positive normal f32, 2^-126). */
export const F32_MIN = 1.1754943508222875e-38;

/** Reads a Vector3f from a big-endian stream (C++ `Vector3f::read`). */
function readVector3f(stream: RamStream, out: Vector3f): void {
    out.x = stream.read_f32();
    out.y = stream.read_f32();
    out.z = stream.read_f32();
}

/**
 * C++ `static_cast<int>(f32)`. Out-of-range values saturate (matches arm64 / PPC); NaN yields 0
 * (arm64 fcvtzs). In-range values truncate toward zero.
 */
function f32ToS32(f: number): number {
    if (Number.isNaN(f)) {
        return 0;
    }
    if (f >= 2147483647) {
        return 2147483647;
    }
    if (f <= -2147483648) {
        return -2147483648;
    }
    return Math.trunc(f);
}

export class CollisionInfoPartial {
    bbox = new BoundBox3f();
    tangentOff = new Vector3f();

    update(offset: Readonly<Vector3f>): void {
        this.bbox.min.copy(this.bbox.min.minimize(offset));
        this.bbox.max.copy(this.bbox.max.maximize(offset));
    }
}

export class CollisionInfo {
    bbox = new BoundBox3f();
    tangentOff = new Vector3f();
    floorNrm = new Vector3f();
    wallNrm = new Vector3f();
    roadVelocity = new Vector3f();
    floorDist = 0.0;
    wallDist = 0.0;
    movingFloorDist = 0.0;
    perpendicularity = 0.0;

    updateFloor(dist: number, fnrm: Readonly<Vector3f>): void {
        if (dist > this.floorDist) {
            this.floorDist = dist;
            this.floorNrm.copy(fnrm);
        }
    }

    updateWall(dist: number, fnrm: Readonly<Vector3f>): void {
        if (dist > this.wallDist) {
            this.wallDist = dist;
            this.wallNrm.copy(fnrm);
        }
    }

    reset(): void {
        this.bbox.setZero();
        this.movingFloorDist = -F32_MIN;
        this.wallDist = -F32_MIN;
        this.floorDist = -F32_MIN;
        this.perpendicularity = 0.0;
    }

    update(
        now_dist: number,
        offset: Readonly<Vector3f>,
        fnrm: Readonly<Vector3f>,
        kclAttributeTypeBit: number,
    ): void {
        this.bbox.min.copy(this.bbox.min.minimize(offset));
        this.bbox.max.copy(this.bbox.max.maximize(offset));

        if (kclAttributeTypeBit & KCL_TYPE_FLOOR) {
            this.updateFloor(now_dist, fnrm);
        } else if (kclAttributeTypeBit & KCL_TYPE_WALL) {
            if (this.wallDist > -F32_MIN) {
                const dot = fr(1.0 - this.wallNrm.ps_dot(fnrm));
                if (dot > this.perpendicularity) {
                    this.perpendicularity = fmin(dot, 1.0);
                }
            }

            this.updateWall(now_dist, fnrm);
        }
    }

    /** @addr{0x807C26AC} */
    transformInfo(rhs: CollisionInfo, mtx: Readonly<Matrix34f>, v: Readonly<Vector3f>): void {
        rhs.bbox.min.copy(mtx.ps_multVector33(rhs.bbox.min));
        rhs.bbox.max.copy(mtx.ps_multVector33(rhs.bbox.max));

        const min = rhs.bbox.min.clone();

        rhs.bbox.min.copy(min.minimize(rhs.bbox.max));
        rhs.bbox.max.copy(min.maximize(rhs.bbox.max));

        this.bbox.min.copy(this.bbox.min.minimize(rhs.bbox.min));
        this.bbox.max.copy(this.bbox.max.maximize(rhs.bbox.max));

        if (this.floorDist < rhs.floorDist) {
            this.floorDist = rhs.floorDist;
            this.floorNrm.copy(mtx.ps_multVector33(rhs.floorNrm));
        }

        if (this.wallDist < rhs.wallDist) {
            this.wallDist = rhs.wallDist;
            this.wallNrm.copy(mtx.ps_multVector33(rhs.wallNrm));
        }

        if (this.movingFloorDist < rhs.floorDist) {
            this.movingFloorDist = rhs.floorDist;
            this.roadVelocity.copy(v);
        }

        this.perpendicularity = fmax(this.perpendicularity, rhs.perpendicularity);
    }
}

export enum CollisionCheckType {
    Edge,
    Plane,
    Movement,
}

export class KCollisionPrism {
    height: number;
    pos_i: number;
    fnrm_i: number;
    enrm1_i: number;
    enrm2_i: number;
    enrm3_i: number;
    attribute: number;

    constructor(
        height = 0.0,
        posIndex = 0,
        faceNormIndex = 0,
        edge1NormIndex = 0,
        edge2NormIndex = 0,
        edge3NormIndex = 0,
        attribute = 0,
    ) {
        this.height = height;
        this.pos_i = posIndex;
        this.fnrm_i = faceNormIndex;
        this.enrm1_i = edge1NormIndex;
        this.enrm2_i = edge2NormIndex;
        this.enrm3_i = edge3NormIndex;
        this.attribute = attribute;
    }
}

const KCOLLISION_PRISM_SIZE = 0x10;
const VECTOR3F_SIZE = 0xc;
const PRISM_CACHE_SIZE = 256;

const POINT_EPSILON = fr(0.01);
const POINT_EPSILON2 = fr(0.02);

/** Performs lookups for KCL triangles. */
export class KColData {
    static readonly CollisionCheckType = CollisionCheckType;
    static readonly KCollisionPrism = KCollisionPrism;

    private m_file: Uint8Array;
    private m_view: DataView;
    /** Byte offsets of each section within m_file (C++ keeps raw pointers). */
    private m_posData: number;
    private m_nrmData: number;
    private m_prismData: number;
    private m_blockData: number;
    /** Block data section parsed as native u16s, indexed by (byte offset from m_blockData) / 2. */
    private m_blockU16: Uint16Array;

    private m_prismThickness: number;
    private m_areaMinPos = new Vector3f();
    private m_areaXWidthMask: number;
    private m_areaYWidthMask: number;
    private m_areaZWidthMask: number;
    private m_blockWidthShift: number;
    private m_areaXBlocksShift: number;
    private m_areaXYBlocksShift: number;
    private m_sphereRadius: number;
    private m_pos = new Vector3f();
    private m_prevPos = new Vector3f();
    private m_movement = new Vector3f();
    private m_radius = 0.0;
    private m_typeMask: KCLTypeMask = 0;
    private m_prismIterArr: Uint16Array | null = null;
    private m_prismIterIdx = 0;
    private m_bbox = new BoundBox3f();
    private m_prismCache = new Uint16Array(PRISM_CACHE_SIZE);
    private m_prismCacheTop = 0;
    /** Always `m_prismCache.data() - 1`, i.e. (m_prismCache, -1). */
    private m_cachedPrismArrayIdx = -1;
    private m_cachedPos = new Vector3f();
    private m_cachedRadius = 0.0;

    private m_prisms: KCollisionPrism[] = [];
    private m_nrms: Vector3f[] = [];
    private m_vertices: Vector3f[] = [];

    /** @addr{0x807BDC5C} */
    constructor(file: Uint8Array) {
        this.m_file = file;
        this.m_view = new DataView(file.buffer, file.byteOffset, file.byteLength);

        const stream = RamStream.from(file, 0, KCOL_HEADER_SIZE);

        const posOffset = stream.read_u32();
        const nrmOffset = stream.read_u32();
        const prismOffset = stream.read_u32();
        const blockOffset = stream.read_u32();

        this.m_posData = posOffset;
        this.m_nrmData = nrmOffset;
        this.m_prismData = prismOffset;
        this.m_blockData = blockOffset;

        this.m_prismThickness = stream.read_f32();
        readVector3f(stream, this.m_areaMinPos);
        this.m_areaXWidthMask = stream.read_u32();
        this.m_areaYWidthMask = stream.read_u32();
        this.m_areaZWidthMask = stream.read_u32();
        this.m_blockWidthShift = stream.read_u32();
        this.m_areaXBlocksShift = stream.read_u32();
        this.m_areaXYBlocksShift = stream.read_u32();
        this.m_sphereRadius = stream.read_f32();

        this.m_pos.setZero();
        this.m_prevPos.setZero();
        this.m_movement.setZero();
        this.m_radius = 0.0;
        this.m_prismIterArr = null;
        this.m_prismIterIdx = 0;
        this.m_cachedPrismArrayIdx = -1;

        // Parse the block data section as native u16s for prism list iteration.
        const blockBytes = Math.max(0, file.byteLength - blockOffset);
        this.m_blockU16 = new Uint16Array(blockBytes >>> 1);
        for (let i = 0; i < this.m_blockU16.length; ++i) {
            this.m_blockU16[i] = this.m_view.getUint16(blockOffset + i * 2, false);
        }

        // NOTE: Collision is expensive on the CPU, so we preload all of the prism data to ensure
        // we're not constantly handling endianness.
        this.preloadPrisms();
        this.preloadNormals();
        this.preloadVertices();

        this.computeBBox();
    }

    /** @addr{0x807C24C0} */
    narrowScopeLocal(pos: Readonly<Vector3f>, radius: number, mask: KCLTypeMask): void {
        this.m_prismCacheTop = 0;
        this.m_pos.copy(pos);
        this.m_radius = radius;
        this.m_typeMask = mask;
        this.m_cachedPos.copy(pos);
        this.m_cachedRadius = radius;

        if (radius <= this.m_sphereRadius) {
            this.narrowPolygon_EachBlock(this.searchBlock(pos));
        }

        this.m_prismCache[this.m_prismCacheTop] = 0;
    }

    /**
     * @addr{0x807C243C}
     * @param prismArray Index into the block data u16 array (see searchBlock), or null.
     */
    narrowPolygon_EachBlock(prismArray: number | null): void {
        this.setPrismIterBlock(prismArray);

        while (this.checkSphereSingle(null, null, null)) {
            // We assume the cache has same endianness as the archive file,
            // so do not parse out the prism index and directly store it in the cache.
            this.m_prismCache[this.m_prismCacheTop++] = this.m_prismIterArr![this.m_prismIterIdx]!;

            if (this.m_prismCacheTop === PRISM_CACHE_SIZE) {
                --this.m_prismCacheTop;
                return;
            }
        }
    }

    /**
     * Calculates a BoundBox3f that describes the boundary of the track's KCL
     * @addr{0x807BDDFC}
     */
    computeBBox(): void {
        this.m_bbox.max.setAll(-999999.0);
        this.m_bbox.min.setAll(999999.0);

        for (let i = 1; i < this.m_prisms.length; ++i) {
            const prism = this.m_prisms[i]!;
            const fnrm = this.m_nrms[prism.fnrm_i]!;
            const enrm1 = this.m_nrms[prism.enrm1_i]!;
            const enrm2 = this.m_nrms[prism.enrm2_i]!;
            const enrm3 = this.m_nrms[prism.enrm3_i]!;
            const vtx1 = this.m_vertices[prism.pos_i]!;

            const vtx2 = KColData.GetVertex(prism.height, vtx1, fnrm, enrm3, enrm1);
            const vtx3 = KColData.GetVertex(prism.height, vtx1, fnrm, enrm3, enrm2);

            this.m_bbox.min.copy(this.m_bbox.min.minimize(vtx1));
            this.m_bbox.min.copy(this.m_bbox.min.minimize(vtx2));
            this.m_bbox.min.copy(this.m_bbox.min.minimize(vtx3));
            this.m_bbox.max.copy(this.m_bbox.max.maximize(vtx1));
            this.m_bbox.max.copy(this.m_bbox.max.maximize(vtx2));
            this.m_bbox.max.copy(this.m_bbox.max.maximize(vtx3));
        }
    }

    /** @addr{0x807C1F80} */
    checkPointCollision(
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        flagsOut: Box<number> | null,
    ): boolean {
        return Number.isFinite(this.m_prevPos.y)
            ? this.checkPointMovement(distOut, fnrmOut, flagsOut)
            : this.checkPoint(distOut, fnrmOut, flagsOut);
    }

    /** @addr{0x807C2410} */
    checkSphereCollision(
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        flagsOut: Box<number> | null,
    ): boolean {
        return Number.isFinite(this.m_prevPos.y)
            ? this.checkSphereMovement(distOut, fnrmOut, flagsOut)
            : this.checkSphere(distOut, fnrmOut, flagsOut);
    }

    /**
     * Iterates the list of looked-up triangles to see if we are colliding
     * @addr{0x807C1514}
     */
    checkSphere(
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        flagsOut: Box<number> | null,
    ): boolean {
        // If there's no list of triangles to check, there's no collision
        const arr = this.m_prismIterArr;
        if (!arr) {
            return false;
        }

        // Check collision for all triangles, and continuously call the function until we're out
        while (arr[++this.m_prismIterIdx]! !== 0) {
            const prism = this.m_prisms[arr[this.m_prismIterIdx]!]!;
            if (this.checkCollision(CollisionCheckType.Plane, prism, distOut, fnrmOut, flagsOut)) {
                return true;
            }
        }

        // We're out of triangles to check - another list must be prepared for subsequent calls
        this.m_prismIterArr = null;
        return false;
    }

    /** @addr{0x807C0F00} */
    checkSphereSingle(
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        flagsOut: Box<number> | null,
    ): boolean {
        const arr = this.m_prismIterArr;
        if (!arr) {
            return false;
        }

        const cache = this.m_prismCache;

        while (arr[++this.m_prismIterIdx]! !== 0) {
            const iterVal = arr[this.m_prismIterIdx]!;

            if (this.m_prismCacheTop !== 0) {
                // NOTE: When the search passes the start of the cache, C++ reads one element
                // before the array (UB). Regardless of the value read there, the loop exits with
                // puVar10 < begin, so the prism is not skipped. We replicate that outcome.
                let puVar10 = this.m_prismCacheTop - 1;
                while (puVar10 < 0 || iterVal !== cache[puVar10]!) {
                    if (puVar10-- < 0) {
                        break;
                    }
                }

                if (puVar10 >= 0) {
                    continue;
                }
            }

            const prism = this.m_prisms[iterVal]!;
            if (this.checkCollision(CollisionCheckType.Edge, prism, distOut, fnrmOut, flagsOut)) {
                return true;
            }
        }

        this.m_prismIterArr = null;
        return false;
    }

    /**
     * Sets members in preparation of a subsequent point collision check call
     * @addr{0x807C1B0C}
     */
    lookupPoint(
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        typeMask: KCLTypeMask,
    ): void {
        this.setPrismIterBlock(this.searchBlock(pos));
        this.m_pos.copy(pos);
        this.m_prevPos.copy(prevPos);
        this.m_movement = pos.sub(prevPos);
        this.m_typeMask = typeMask;
    }

    /**
     * Sets members in preparation of a subsequent sphere collision check call
     * @addr{0x807C1BB4}
     */
    lookupSphere(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        typeMask: KCLTypeMask,
    ): void {
        this.setPrismIterBlock(this.searchBlock(pos));
        this.m_pos.copy(pos);
        this.m_prevPos.copy(prevPos);
        this.m_movement = pos.sub(prevPos);
        this.m_radius = fmin(radius, this.m_sphereRadius);
        this.m_typeMask = typeMask;
    }

    /** @addr{0x807C1DE8} */
    lookupSphereCached(
        p1: Readonly<Vector3f>,
        p2: Readonly<Vector3f>,
        typeMask: number,
        radius: number,
    ): void {
        const sphere1 = new Sphere3f(p1, radius);
        const sphere2 = new Sphere3f(this.m_cachedPos, this.m_cachedRadius);

        if (!sphere1.isInsideOtherSphere(sphere2)) {
            this.setPrismIterBlock(this.searchBlock(p1));
            this.m_radius = fmin(this.m_sphereRadius, radius);
        } else {
            this.m_radius = radius;
            this.m_prismIterArr = this.m_prismCache;
            this.m_prismIterIdx = this.m_cachedPrismArrayIdx;
        }

        this.m_pos.copy(p1);
        this.m_prevPos.copy(p2);
        this.m_movement = p1.sub(p2);
        this.m_typeMask = typeMask;
    }

    /**
     * Finds the data block corresponding to the provided position
     * @addr{0x807BE030}
     * @return The index (into the block data as u16s) of the leaf's prism list, or null.
     */
    searchBlock(point: Readonly<Vector3f>): number | null {
        // Calculate the x, y, and z offsets of the point from the minimum
        // corner of the tree's bounding box.
        const x = f32ToS32(fr(point.x - this.m_areaMinPos.x));
        const y = f32ToS32(fr(point.y - this.m_areaMinPos.y));
        const z = f32ToS32(fr(point.z - this.m_areaMinPos.z));

        // Check if the point is outside the tree's bounding box in the x, y,
        // or z dimensions. If it is, return 0.
        if (
            (x & this.m_areaXWidthMask) !== 0 ||
            (y & this.m_areaYWidthMask) !== 0 ||
            (z & this.m_areaZWidthMask) !== 0
        ) {
            return null;
        }

        const ux = x >>> 0;
        const uy = y >>> 0;
        const uz = z >>> 0;

        // Initialize the current tree node to the root node of the tree.
        let shift = this.m_blockWidthShift;
        let curBlock = this.m_blockData;
        let offset: number;

        // Traverse the tree to find the leaf node containing the input point.
        let index =
            (4 *
                ((((uz >>> shift) << this.m_areaXYBlocksShift) |
                    ((uy >>> shift) << this.m_areaXBlocksShift) |
                    (ux >>> shift)) >>>
                    0)) >>>
            0;

        while (true) {
            // Get the offset of the current node's child node.
            offset = this.m_view.getUint32(curBlock + index, false);

            // If the offset is negative, the current node is a leaf node.
            if ((offset & 0x80000000) !== 0) {
                break;
            }

            // If the offset is non-negative, update the current node to be
            // the child node and continue traversing the tree.
            shift--;
            curBlock += offset;

            const x_shift = (1 * (ux >>> shift)) & 1;
            const y_shift = (2 * (uy >>> shift)) & 2;
            const z_shift = (4 * (uz >>> shift)) & 4;

            index = 4 * (x_shift | y_shift | z_shift);
        }

        // We have to remove the MSB since it's solely used to identify leaves.
        const byteOffset = curBlock + (offset & 0x7fffffff) - this.m_blockData;
        if ((byteOffset & 1) !== 0) {
            throw new Error('KColData: misaligned prism list');
        }
        return byteOffset >>> 1;
    }

    // Getters

    bbox(): Readonly<BoundBox3f> {
        return this.m_bbox;
    }

    prismCache(idx: number): number {
        return this.m_prismCache[idx]!;
    }

    prisms(): readonly KCollisionPrism[] {
        return this.m_prisms;
    }

    nrms(): readonly Vector3f[] {
        return this.m_nrms;
    }

    vertices(): readonly Vector3f[] {
        return this.m_vertices;
    }

    /**
     * Computes a prism vertex based off of the triangle's normal vectors
     * @addr{0x807BDF54}
     */
    static GetVertex(
        height: number,
        vertex1: Readonly<Vector3f>,
        fnrm: Readonly<Vector3f>,
        enrm3: Readonly<Vector3f>,
        enrm: Readonly<Vector3f>,
    ): Vector3f {
        const cross = fnrm.cross(enrm);
        const dp = cross.ps_dot(enrm3);
        cross.mulEq(fr(height / dp));

        return cross.add(vertex1);
    }

    private setPrismIterBlock(prismArray: number | null): void {
        if (prismArray === null) {
            this.m_prismIterArr = null;
            this.m_prismIterIdx = 0;
        } else {
            this.m_prismIterArr = this.m_blockU16;
            this.m_prismIterIdx = prismArray;
        }
    }

    /** Creates a copy of the prisms in memory. */
    private preloadPrisms(): void {
        const prismCount = Math.trunc((this.m_blockData - this.m_prismData) / KCOLLISION_PRISM_SIZE);

        const stream = RamStream.from(
            this.m_file,
            this.m_prismData,
            KCOLLISION_PRISM_SIZE * prismCount,
        );

        this.m_prisms = new Array<KCollisionPrism>(prismCount);
        for (let i = 0; i < prismCount; ++i) {
            this.m_prisms[i] = new KCollisionPrism();
        }

        // Because the prisms are one-indexed, we insert an empty prism
        stream.skip(KCOLLISION_PRISM_SIZE);

        for (let i = 1; i < prismCount; ++i) {
            const prism = this.m_prisms[i]!;
            prism.height = stream.read_f32();
            prism.pos_i = stream.read_u16();
            prism.fnrm_i = stream.read_u16();
            prism.enrm1_i = stream.read_u16();
            prism.enrm2_i = stream.read_u16();
            prism.enrm3_i = stream.read_u16();
            prism.attribute = stream.read_u16();
        }
    }

    /** Creates a copy of the normals in memory. */
    private preloadNormals(): void {
        const normalCount = Math.trunc(
            (this.m_prismData + KCOLLISION_PRISM_SIZE - this.m_nrmData) / VECTOR3F_SIZE,
        );

        this.m_nrms = new Array<Vector3f>(normalCount);
        const stream = RamStream.from(this.m_file, this.m_nrmData, VECTOR3F_SIZE * normalCount);

        for (let i = 0; i < normalCount; ++i) {
            const nrm = new Vector3f();
            readVector3f(stream, nrm);
            this.m_nrms[i] = nrm;
        }
    }

    /** Creates a copy of the vertices in memory. */
    private preloadVertices(): void {
        const vertexCount = Math.trunc((this.m_nrmData - this.m_posData) / VECTOR3F_SIZE);

        this.m_vertices = new Array<Vector3f>(vertexCount);
        const stream = RamStream.from(this.m_file, this.m_posData, VECTOR3F_SIZE * vertexCount);

        for (let i = 0; i < vertexCount; ++i) {
            const vert = new Vector3f();
            readVector3f(stream, vert);
            this.m_vertices[i] = vert;
        }
    }

    /**
     * This is a combination of the three collision checks in the base game.
     * 1. Edge (0x807C0F00), 2. Plane (0x807C1514), 3. Movement (0x807C0884)
     */
    private checkCollision(
        type: CollisionCheckType,
        prism: KCollisionPrism,
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        flagsOut: Box<number> | null,
    ): boolean {
        // Responsible for updating the output params
        const out = (dist: number): boolean => {
            if (distOut) {
                distOut.value = dist;
            }
            if (fnrmOut) {
                fnrmOut.copy(this.m_nrms[prism.fnrm_i]!);
            }
            if (flagsOut) {
                flagsOut.value = prism.attribute;
            }
            return true;
        };

        // The flag check occurs earlier than in the base game here. We don't want to do math if
        // the tri we're checking doesn't have matching flags.
        const attributeMask = KCL_ATTRIBUTE_TYPE_BIT(prism.attribute);
        if (!(attributeMask & this.m_typeMask)) {
            return false;
        }

        const relativePos = this.m_pos.sub(this.m_vertices[prism.pos_i]!);
        const radius = this.m_radius;

        // Edge normals point outside the triangle
        const enrm1 = this.m_nrms[prism.enrm1_i]!;
        const dist_ca = relativePos.ps_dot(enrm1);
        if (radius <= dist_ca) {
            return false;
        }

        const enrm2 = this.m_nrms[prism.enrm2_i]!;
        const dist_ab = relativePos.ps_dot(enrm2);
        if (radius <= dist_ab) {
            return false;
        }

        const enrm3 = this.m_nrms[prism.enrm3_i]!;
        const dist_bc = fr(relativePos.ps_dot(enrm3) - prism.height);
        if (radius <= dist_bc) {
            return false;
        }

        const fnrm = this.m_nrms[prism.fnrm_i]!;
        const plane_dist = relativePos.ps_dot(fnrm);
        const dist_in_plane = fr(radius - plane_dist);
        if (dist_in_plane <= 0.0) {
            return false;
        }

        let typeDistance = this.m_prismThickness;
        if (type === CollisionCheckType.Edge) {
            typeDistance = fr(typeDistance + radius);
        }

        if (dist_in_plane >= typeDistance) {
            return false;
        }

        if (type === CollisionCheckType.Movement) {
            if (attributeMask & KCL_TYPE_DIRECTIONAL && this.m_movement.dot(fnrm) > 0.0) {
                return false;
            }
        }

        // Originally part of the edge searching, but moved out for simplicity
        // If these are all zero, then we're inside the triangle
        if (dist_ab <= 0.0 && dist_bc <= 0.0 && dist_ca <= 0.0) {
            if (type === CollisionCheckType.Movement) {
                const lastPos = relativePos.sub(this.m_movement);
                // We're only colliding if we are moving towards the face
                if (plane_dist < 0.0 && lastPos.ps_dot(fnrm) < 0.0) {
                    return false;
                }
            }
            return out(dist_in_plane);
        }

        let edge_nor: Readonly<Vector3f>;
        let other_edge_nor: Readonly<Vector3f>;
        let edge_dist: number;
        let other_edge_dist: number;
        let swap = false;
        let swapNorms = false;
        // > means further, < means closer, = means same distance
        if (dist_ab >= dist_ca && dist_ab > dist_bc) {
            // AB is the furthest edge
            edge_nor = enrm2;
            edge_dist = dist_ab;
            if (dist_ca >= dist_bc) {
                // CA is the second furthest edge
                other_edge_nor = enrm1;
                other_edge_dist = dist_ca;
                swapNorms = true;
            } else {
                // BC is the second furthest edge
                other_edge_nor = enrm3;
                other_edge_dist = dist_bc;
                swap = true;
            }
        } else if (dist_bc >= dist_ca) {
            // BC is the furthest edge
            edge_nor = enrm3;
            edge_dist = dist_bc;
            if (dist_ab >= dist_ca) {
                // AB is the second furthest edge
                other_edge_nor = enrm2;
                other_edge_dist = dist_ab;
                swapNorms = true;
            } else {
                // CA is the second furthest edge
                other_edge_nor = enrm1;
                other_edge_dist = dist_ca;
                swap = true;
            }
        } else {
            // CA is the furthest edge
            edge_nor = enrm1;
            edge_dist = dist_ca;
            if (dist_bc >= dist_ab) {
                // BC is the second furthest edge
                other_edge_nor = enrm3;
                other_edge_dist = dist_bc;
                swapNorms = true;
            } else {
                // AB is the second furthest edge
                other_edge_nor = enrm2;
                other_edge_dist = dist_ab;
                swap = true;
            }
        }

        const cos = edge_nor.ps_dot(other_edge_nor);
        let sq_dist: number;
        if (fr(cos * edge_dist) > other_edge_dist) {
            if (type === CollisionCheckType.Plane) {
                if (edge_dist > plane_dist) {
                    return false;
                }
            }
            sq_dist = fr(fr(radius * radius) - fr(edge_dist * edge_dist));
        } else {
            const sq_sin = fr(fr(cos * cos) - 1.0);

            if (swap) {
                const tmp = edge_dist;
                edge_dist = other_edge_dist;
                other_edge_dist = tmp;
            }

            if (swapNorms) {
                const tmp = edge_nor;
                edge_nor = other_edge_nor;
                other_edge_nor = tmp;
            }

            const t = fr(fr(fr(cos * edge_dist) - other_edge_dist) / sq_sin);
            const s = fr(edge_dist - fr(t * cos));
            const corner_pos = edge_nor.mul(t).add(other_edge_nor.mul(s));

            const cornerDot = corner_pos.ps_squareMag();
            if (type === CollisionCheckType.Plane) {
                if (cornerDot > fr(plane_dist * plane_dist)) {
                    return false;
                }
            }

            sq_dist = fr(fr(radius * radius) - cornerDot);
        }

        if (sq_dist < fr(plane_dist * plane_dist) || sq_dist <= 0.0) {
            return false;
        }

        const dist = fr(sqrt(sq_dist) - plane_dist);
        if (dist <= 0.0) {
            return false;
        }

        if (type === CollisionCheckType.Movement) {
            const lastPos = relativePos.sub(this.m_movement);
            // We're only colliding if we are moving towards the face
            if (lastPos.ps_dot(fnrm) < 0.0) {
                return false;
            }
        }

        return out(dist);
    }

    /**
     * This is a combination of two point collision check functions. They only vary based on
     * whether we are checking movement.
     */
    private checkPointCollisionPrism(
        prism: KCollisionPrism,
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        flagsOut: Box<number> | null,
        movement: boolean,
    ): boolean {
        const attrMask = KCL_ATTRIBUTE_TYPE_BIT(prism.attribute);
        if (!(attrMask & this.m_typeMask)) {
            return false;
        }

        const relativePos = this.m_pos.sub(this.m_vertices[prism.pos_i]!);

        const enrm1 = this.m_nrms[prism.enrm1_i]!;
        const dist_ca = relativePos.ps_dot(enrm1);
        if (dist_ca >= POINT_EPSILON) {
            return false;
        }

        const enrm2 = this.m_nrms[prism.enrm2_i]!;
        const dist_ab = relativePos.ps_dot(enrm2);
        if (dist_ab >= POINT_EPSILON) {
            return false;
        }

        const enrm3 = this.m_nrms[prism.enrm3_i]!;
        const dist_bc = fr(relativePos.ps_dot(enrm3) - prism.height);
        if (dist_bc >= POINT_EPSILON) {
            return false;
        }

        const fnrm = this.m_nrms[prism.fnrm_i]!;
        const plane_dist = relativePos.ps_dot(fnrm);
        const dist_in_plane = fr(POINT_EPSILON - plane_dist);
        if (dist_in_plane <= 0.0) {
            return false;
        }

        if (
            this.m_prismThickness <= dist_in_plane &&
            fr(POINT_EPSILON2 + this.m_prismThickness) <= dist_in_plane
        ) {
            return false;
        }

        if (movement && attrMask & KCL_TYPE_DIRECTIONAL && this.m_movement.dot(fnrm) < 0.0) {
            return false;
        }

        if (distOut) {
            distOut.value = dist_in_plane;
        }

        if (fnrmOut) {
            fnrmOut.copy(fnrm);
        }

        if (flagsOut) {
            flagsOut.value = prism.attribute;
        }

        return true;
    }

    /**
     * Iterates the local data block to check for directional collision
     * @addr{0x807C0884}
     */
    private checkSphereMovement(
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        attributeOut: Box<number> | null,
    ): boolean {
        // If there's no list of triangles to check, there's no collision
        const arr = this.m_prismIterArr;
        if (!arr) {
            return false;
        }

        // Check collision for all triangles, and continuously call the function until we're out
        while (arr[++this.m_prismIterIdx]! !== 0) {
            const prism = this.m_prisms[arr[this.m_prismIterIdx]!]!;
            if (
                this.checkCollision(
                    CollisionCheckType.Movement,
                    prism,
                    distOut,
                    fnrmOut,
                    attributeOut,
                )
            ) {
                return true;
            }
        }

        // We're out of triangles to check - another list must be prepared for subsequent calls
        this.m_prismIterArr = null;
        return false;
    }

    /** @addr{0x807C21F4} */
    private checkPoint(
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        attributeOut: Box<number> | null,
    ): boolean {
        const arr = this.m_prismIterArr;
        if (!arr) {
            return false;
        }

        while (arr[++this.m_prismIterIdx]! !== 0) {
            const prism = this.m_prisms[arr[this.m_prismIterIdx]!]!;
            if (this.checkPointCollisionPrism(prism, distOut, fnrmOut, attributeOut, false)) {
                return true;
            }
        }

        this.m_prismIterArr = null;
        return false;
    }

    /** @addr{0x807C1F80} */
    private checkPointMovement(
        distOut: Box<number> | null,
        fnrmOut: Vector3f | null,
        attributeOut: Box<number> | null,
    ): boolean {
        const arr = this.m_prismIterArr;
        if (!arr) {
            return false;
        }

        while (arr[++this.m_prismIterIdx]! !== 0) {
            const prism = this.m_prisms[arr[this.m_prismIterIdx]!]!;
            if (this.checkPointCollisionPrism(prism, distOut, fnrmOut, attributeOut, true)) {
                return true;
            }
        }

        this.m_prismIterArr = null;
        return false;
    }
}

