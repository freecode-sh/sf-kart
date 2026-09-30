/** Port of Kinoko source/abstract/g3d/AnmObj.{hh,cc}. Credit: kiwi515/ogws. */

import { fr } from '../../egg/math/Math';

export enum AnmPolicy {
    OneTime = 0,
    Loop = 1,
    Max = 2,
}

export type PlayPolicyFunc = (start: number, end: number, frame: number) => number;

/** @addr{0x800604F0} */
export function PlayPolicy_Onetime(_start: number, _end: number, frame: number): number {
    return frame;
}

/** @addr{0x80060500} */
export function PlayPolicy_Loop(start: number, end: number, frame: number): number {
    const length = fr(end - start);

    if (frame >= 0.0) {
        // fmodf of two f32 values is exact.
        return fr(frame % length);
    }

    const offset = fr(fr(frame + length) % length);

    return offset >= 0.0 ? offset : fr(offset + length);
}

const POLICY_TABLE: readonly PlayPolicyFunc[] = [PlayPolicy_Onetime, PlayPolicy_Loop];

export function GetAnmPlayPolicy(policy: AnmPolicy): PlayPolicyFunc {
    const idx = policy as number;
    if (idx >= AnmPolicy.Max) {
        throw new Error(`GetAnmPlayPolicy: invalid policy ${idx}`);
    }
    return POLICY_TABLE[idx]!;
}

let s_baseUpdateRate = 1.0;

export class FrameCtrl {
    private m_frame: number;
    private m_updateRate: number;
    private m_startFrame: number;
    private m_endFrame: number;
    private m_playPolicy: PlayPolicyFunc;

    constructor(start: number, end: number, policy: PlayPolicyFunc) {
        this.m_frame = 0.0;
        this.m_updateRate = 1.0;
        this.m_startFrame = start;
        this.m_endFrame = end;
        this.m_playPolicy = policy;
    }

    updateFrame(): void {
        this.setFrame(fr(fr(this.m_updateRate * s_baseUpdateRate) + this.m_frame));
    }

    frame(): number {
        return this.m_frame;
    }

    rate(): number {
        return this.m_updateRate;
    }

    playPolicy(): PlayPolicyFunc {
        return this.m_playPolicy;
    }

    setFrame(frame: number): void {
        this.m_frame = this.m_playPolicy(this.m_startFrame, this.m_endFrame, frame);
    }

    setRate(rate: number): void {
        this.m_updateRate = rate;
    }

    setPlayPolicy(func: PlayPolicyFunc): void {
        this.m_playPolicy = func;
    }

    static BaseUpdateRate(): number {
        return s_baseUpdateRate;
    }

    static SetBaseUpdateRate(rate: number): void {
        s_baseUpdateRate = rate;
    }
}
