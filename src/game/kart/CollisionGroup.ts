/** Port of Kinoko's game/kart/CollisionGroup.{hh,cc}. */

import { fr } from '../../egg/math/Math';
import type { Matrix34f } from '../../egg/math/Matrix';
import type { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';

/**
 * Structural mirror of `BSP::Hitbox` (defined in KartParam). Declared here so CollisionGroup can
 * allocate its own tire hitboxes (see createSingleHitbox) without depending on KartParam.
 */
export interface BspHitbox {
    enable: number;
    position: Vector3f;
    radius: number;
    wallsOnly: number;
    tireCollisionIdx: number;
}

/** Information about the current collision and its properties. */
export class CollisionData {
    tangentOff = new Vector3f();
    floorNrm = new Vector3f();
    wallNrm = new Vector3f();
    noBounceWallNrm = new Vector3f();
    vel = new Vector3f();
    relPos = new Vector3f();
    movement = new Vector3f();
    roadVelocity = new Vector3f();
    speedFactor = 0.0;
    rotFactor = 0.0;
    closestFloorFlags = 0; ///< KCLTypeMask
    closestFloorSettings = 0; ///< u32
    closestWallFlags = 0; ///< KCLTypeMask
    closestWallSettings = 0; ///< u32
    intensity = 0; ///< s32
    colPerpendicularity = 0.0;

    bFloor = false;
    bWall = false;
    bInvisibleWall = false;
    bTrickable = false;
    bMovingWaterMomentum = false;
    bWall3 = false;
    bInvisibleWallOnly = false;
    bMovingWaterDecaySpeed = false;
    bSoftWall = false;
    bMovingWaterStickyRoad = false;
    bMovingWaterDisableAccel = false;
    bHasRoadVel = false;
    bWallAtLeftCloser = false;
    bWallAtRightCloser = false;
    bMovingWaterVertical = false;

    /** @addr{0x805B821C} */
    reset(): void {
        this.tangentOff.setZero();
        this.floorNrm.setZero();
        this.wallNrm.setZero();
        this.vel.setZero();
        this.relPos.setZero();
        this.movement.setZero();
        this.roadVelocity.setZero();
        this.speedFactor = 1.0;
        this.rotFactor = 0.0;
        this.closestFloorFlags = 0;
        this.closestFloorSettings = 0xffffffff;
        this.closestWallFlags = 0;
        // NOTE: Faithful to Kinoko: closestFloorSettings is assigned twice and closestWallSettings
        // (as well as noBounceWallNrm) is left untouched.
        this.closestFloorSettings = 0xffffffff;
        this.intensity = 0;
        this.colPerpendicularity = 0.0;

        this.bFloor = false;
        this.bWall = false;
        this.bInvisibleWall = false;
        this.bTrickable = false;
        this.bMovingWaterMomentum = false;
        this.bWall3 = false;
        this.bInvisibleWallOnly = false;
        this.bMovingWaterDecaySpeed = false;
        this.bSoftWall = false;
        this.bMovingWaterStickyRoad = false;
        this.bMovingWaterDisableAccel = false;
        this.bHasRoadVel = false;
        this.bWallAtLeftCloser = false;
        this.bWallAtRightCloser = false;
        this.bMovingWaterVertical = false;
    }

    /** C++ copy-assignment (`a = b`). */
    copy(rhs: Readonly<CollisionData>): this {
        this.tangentOff.copy(rhs.tangentOff);
        this.floorNrm.copy(rhs.floorNrm);
        this.wallNrm.copy(rhs.wallNrm);
        this.noBounceWallNrm.copy(rhs.noBounceWallNrm);
        this.vel.copy(rhs.vel);
        this.relPos.copy(rhs.relPos);
        this.movement.copy(rhs.movement);
        this.roadVelocity.copy(rhs.roadVelocity);
        this.speedFactor = rhs.speedFactor;
        this.rotFactor = rhs.rotFactor;
        this.closestFloorFlags = rhs.closestFloorFlags;
        this.closestFloorSettings = rhs.closestFloorSettings;
        this.closestWallFlags = rhs.closestWallFlags;
        this.closestWallSettings = rhs.closestWallSettings;
        this.intensity = rhs.intensity;
        this.colPerpendicularity = rhs.colPerpendicularity;

        this.bFloor = rhs.bFloor;
        this.bWall = rhs.bWall;
        this.bInvisibleWall = rhs.bInvisibleWall;
        this.bTrickable = rhs.bTrickable;
        this.bMovingWaterMomentum = rhs.bMovingWaterMomentum;
        this.bWall3 = rhs.bWall3;
        this.bInvisibleWallOnly = rhs.bInvisibleWallOnly;
        this.bMovingWaterDecaySpeed = rhs.bMovingWaterDecaySpeed;
        this.bSoftWall = rhs.bSoftWall;
        this.bMovingWaterStickyRoad = rhs.bMovingWaterStickyRoad;
        this.bMovingWaterDisableAccel = rhs.bMovingWaterDisableAccel;
        this.bHasRoadVel = rhs.bHasRoadVel;
        this.bWallAtLeftCloser = rhs.bWallAtLeftCloser;
        this.bWallAtRightCloser = rhs.bWallAtRightCloser;
        this.bMovingWaterVertical = rhs.bMovingWaterVertical;
        return this;
    }

    /** C++ copy-construction. */
    clone(): CollisionData {
        return new CollisionData().copy(this);
    }
}

/** Represents a hitbox for the kart body or a wheel. */
export class Hitbox {
    private m_bspHitbox: BspHitbox | null;
    private m_radius = 0.0;
    private m_worldPos = new Vector3f();
    private m_lastPos = new Vector3f();
    private m_relPos = new Vector3f();

    private m_ownsBSP: boolean;

    /** @addr{0x805B7F48} */
    constructor() {
        this.m_bspHitbox = null;
        this.m_ownsBSP = false;
    }

    /**
     * @addr{0x805B7FBC}
     * Calculates the position of a given hitbox, both relative to the player and world.
     */
    calc(
        totalScale: number,
        sinkDepth: number,
        scale: Readonly<Vector3f>,
        rot: Readonly<Quatf>,
        pos: Readonly<Vector3f>,
    ): void {
        const bspHitbox = this.m_bspHitbox!;

        let fVar1 = 0.0;
        if (scale.y < totalScale) {
            fVar1 = fr(fr(totalScale - scale.y) * bspHitbox.radius);
        }

        const scaledPos = bspHitbox.position.mulV(scale);
        scaledPos.y = fr(fr(fr(bspHitbox.position.y + sinkDepth) * scale.y) + fVar1);

        this.m_relPos.copy(rot.rotateVector(scaledPos));
        this.m_worldPos.copy(this.m_relPos.add(pos));
    }

    /** @addr{0x805B7F84} */
    reset(): void {
        this.m_worldPos.setZero();
        this.m_lastPos.setZero();
        this.m_relPos.setZero();
    }

    setRadius(radius: number): void {
        this.m_radius = radius;
    }

    setBspHitbox(hitbox: BspHitbox | null, owns = false): void {
        this.m_ownsBSP = owns;
        this.m_bspHitbox = hitbox;
    }

    setWorldPos(pos: Readonly<Vector3f>): void {
        this.m_worldPos.copy(pos);
    }

    /**
     * Overloaded like C++:
     *  - `setLastPos(pos)`
     *  - `setLastPos(scale, pose)` @addr{0x805B80A8}
     */
    setLastPos(posOrScale: Readonly<Vector3f>, pose?: Readonly<Matrix34f>): void {
        if (pose === undefined) {
            this.m_lastPos.copy(posOrScale);
            return;
        }

        const scale = posOrScale;
        let yScaleFactor = scale.y;
        const scaledPos = this.m_bspHitbox!.position.clone();
        scaledPos.x = fr(scaledPos.x * scale.x);
        scaledPos.z = fr(scaledPos.z * scale.z);

        if (scale.y !== scale.z && scale.y < 1.0) {
            scaledPos.y = fr(scaledPos.y + fr(fr(1.0 - scale.y) * this.m_radius));
            yScaleFactor = scale.z;
        }

        scaledPos.y = fr(scaledPos.y * yScaleFactor);
        this.m_lastPos.copy(pose.ps_multVector(scaledPos));
    }

    bspHitbox(): BspHitbox {
        return this.m_bspHitbox!;
    }

    worldPos(): Readonly<Vector3f> {
        return this.m_worldPos;
    }

    lastPos(): Readonly<Vector3f> {
        return this.m_lastPos;
    }

    relPos(): Readonly<Vector3f> {
        return this.m_relPos;
    }

    radius(): number {
        return this.m_radius;
    }
}

/** Houses hitbox and collision info for an object (body or wheel). */
export class CollisionGroup {
    private m_boundingRadius = 0.0;
    private m_collisionData = new CollisionData();
    private m_hitboxes: Hitbox[] = [];
    private m_hitboxScale: number;

    /** @addr{0x805B82BC} */
    constructor() {
        this.m_hitboxScale = 1.0;
        this.m_collisionData.reset();
    }

    /**
     * @addr{0x805B84C0}
     * Initializes the hitbox array based on the KartParam's BSP hitboxes.
     * @return The furthest point out of the hitboxes' spheres
     */
    initHitboxes(hitboxes: readonly BspHitbox[]): number {
        let bspHitboxCount = 0;

        for (const hitbox of hitboxes) {
            if (hitbox.enable !== 0) {
                ++bspHitboxCount;
            }
        }

        this.m_hitboxes = [];
        for (let i = 0; i < bspHitboxCount; ++i) {
            this.m_hitboxes.push(new Hitbox());
        }
        let hitboxIdx = 0;

        for (const bspHitbox of hitboxes) {
            if (bspHitbox.enable !== 0) {
                this.m_hitboxes[hitboxIdx++]!.setBspHitbox(bspHitbox);
            }
        }

        return this.computeCollisionLimits();
    }

    /**
     * @addr{0x805B883C}
     * Sets the bounding radius.
     * @return The furthest point of all the hitboxes' spheres
     */
    computeCollisionLimits(): number {
        let max = Vector3f.zero.clone();

        for (const hitbox of this.m_hitboxes) {
            const bspHitbox = hitbox.bspHitbox();

            if (bspHitbox.enable === 0) {
                continue;
            }

            max = max.maximize(bspHitbox.position.abs().addScalar(bspHitbox.radius));
        }

        // Get largest component of the vector
        let maxComponent = max.z;

        if (max.x <= max.y) {
            if (max.z < max.y) {
                maxComponent = max.y;
            }
        } else if (max.z < max.x) {
            maxComponent = max.x;
        }

        this.m_boundingRadius = maxComponent;

        return fr(max.z * 0.5);
    }

    /**
     * @addr{0x805B875C}
     * Creates a hitbox to represent a tire.
     */
    createSingleHitbox(radius: number, relPos: Readonly<Vector3f>): void {
        this.m_hitboxes = [new Hitbox()];

        for (const hitbox of this.m_hitboxes) {
            hitbox.reset();
            const bspHitbox: BspHitbox = {
                enable: 0,
                position: new Vector3f(),
                radius: 0.0,
                wallsOnly: 0,
                tireCollisionIdx: 0,
            };
            hitbox.setBspHitbox(bspHitbox, true);
            bspHitbox.position.copy(relPos);
            bspHitbox.radius = radius;
            hitbox.setRadius(radius);
        }
        this.m_boundingRadius = radius;
    }

    /** @addr{0x805B8330} */
    reset(): void {
        this.m_collisionData.reset();

        for (const hitbox of this.m_hitboxes) {
            hitbox.reset();
            hitbox.setRadius(fr(hitbox.bspHitbox().radius * this.m_hitboxScale));
        }
    }

    resetCollision(): void {
        this.m_collisionData.reset();
    }

    /** @addr{0x805B83D8} */
    setHitboxScale(scale: number): void {
        this.m_hitboxScale = scale;

        for (const hitbox of this.m_hitboxes) {
            hitbox.setRadius(fr(hitbox.bspHitbox().radius * this.m_hitboxScale));
        }
    }

    boundingRadius(): number {
        return this.m_boundingRadius;
    }

    hitbox(hitboxIdx: number): Hitbox {
        return this.m_hitboxes[hitboxIdx]!;
    }

    hitboxCount(): number {
        return this.m_hitboxes.length;
    }

    collisionData(): CollisionData {
        return this.m_collisionData;
    }
}
