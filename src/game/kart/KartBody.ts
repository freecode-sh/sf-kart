/** Port of Kinoko's game/kart/KartBody.{hh,cc}. */

import { DEG2RAD, fmax, fr } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';

import { KartObjectProxy } from './KartObjectProxy';
import type { KartPhysics } from './KartPhysics';

const F_0_1 = fr(0.1);

export class KartBody extends KartObjectProxy {
    protected m_physics: KartPhysics;
    protected m_anAngle: number;
    /** Vehicle offset applied downward into collision. */
    protected m_sinkDepth: number;
    protected m_targetSinkDepth: number;

    /** @addr{0x8056C394} */
    constructor(physics: KartPhysics) {
        super();
        this.m_physics = physics;
        this.m_anAngle = 0.0;
        this.m_sinkDepth = 0.0;
        this.m_targetSinkDepth = 0.0;
    }

    /**
     * @addr{0x8056C604}
     * Computes a matrix to represent wheel rotation. For Karts, this is wheel-agnostic.
     */
    wheelMatrix(_wheelIdx: number): Matrix34f {
        const mat = new Matrix34f();
        mat.makeQT(this.fullRot(), this.pos());
        return mat;
    }

    /** @addr{0x8056C4B4} */
    reset(): void {
        this.m_physics.reset();
        this.m_anAngle = 0.0;
        this.m_sinkDepth = 0.0;
        this.m_targetSinkDepth = 0.0;
    }

    /** @addr{0x8056C9C4} */
    calcSinkDepth(): void {
        this.m_sinkDepth = fr(
            this.m_sinkDepth + fr(fr(this.m_targetSinkDepth - this.m_sinkDepth) * F_0_1),
        );
    }

    /** @addr{0x8056C950} */
    trySetTargetSinkDepth(val: number): void {
        this.m_targetSinkDepth = fmax(val, this.m_targetSinkDepth);
    }

    /** @addr{0x8056C964} */
    calcTargetSinkDepth(): void {
        this.m_targetSinkDepth = fr(3.0 * fr(this.collisionData().intensity));
    }

    /** @addr{0x8056E424} */
    setAngle(val: number): void {
        this.m_anAngle = val;
    }

    override physics(): KartPhysics {
        return this.m_physics;
    }

    sinkDepth(): number {
        return this.m_sinkDepth;
    }
}

export class KartBodyKart extends KartBody {
    /** @addr{0x8056CCC0} */
    constructor(physics: KartPhysics) {
        super(physics);
    }
}

export class KartBodyBike extends KartBody {
    /** @addr{0x8056D858} */
    constructor(physics: KartPhysics) {
        super(physics);
    }

    /**
     * @addr{0x8056DD54}
     * Computes a matrix to represent the rotation of a wheel. For the front wheel, we factor in
     * the handlebar rotation. For the rear wheel, we only factor in the kart's rotation.
     * @param wheelIdx 0 for front wheel, 1 for rear wheel
     */
    override wheelMatrix(wheelIdx: number): Matrix34f {
        let mat = new Matrix34f();

        mat.makeQT(this.fullRot(), this.pos());
        if (wheelIdx !== 0) {
            return mat;
        }

        const position = this.param().bikeDisp().m_handlePos.mulV(this.scale());
        const rotation = this.param().bikeDisp().m_handleRot.mul(DEG2RAD);

        const handleMatrix = new Matrix34f();
        handleMatrix.makeRT(rotation, position);
        const tmp = mat.multiplyTo(handleMatrix);

        const yRotation = new Vector3f(0.0, fr(DEG2RAD * this.m_anAngle), 0.0);
        const yRotMatrix = new Matrix34f();
        yRotMatrix.makeR(yRotation);
        mat = tmp.multiplyTo(yRotMatrix);

        return mat;
    }
}

export class KartBodyQuacker extends KartBodyBike {
    constructor(physics: KartPhysics) {
        super(physics);
    }

    override wheelMatrix(_wheelIdx: number): Matrix34f {
        const mat = new Matrix34f();
        mat.makeQT(this.fullRot(), this.pos());
        return mat;
    }
}
