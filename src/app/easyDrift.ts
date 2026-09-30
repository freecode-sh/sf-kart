/**
 * Easy drifting on top of the engine: one forgiving drift for every vehicle, on the engine's own
 * physics. The engine keeps racing in manual mode (hops, mini-turbos and, on the cars, super
 * mini-turbo charge and lengths); this layer only decides when the drift/brake button is held, from
 * the raw inputs and the kart's state.
 *
 * Late steering: hold drift, and if you hopped straight (or landed without a direction) and then
 * steer, it hops again into that direction, so holding drift + steering always ends up drifting.
 * Nothing drifts without the button: plain steering is plain steering.
 *
 * Deterministic: the same raw inputs on the same kart state give the same button presses, so a run
 * can be replayed from its raw inputs.
 */

export interface DriftKart {
    grounded: boolean;
    /** In a manual drift (DriftManual). */
    drifting: boolean;
    /** Mid-hop. */
    hopping: boolean;
    /** Fast enough to start a drift (the engine's 55% of base speed). */
    fast: boolean;
}

/** Minimum frames between hops started by this layer. */
const REHOP_COOLDOWN = 10;

export class EasyDrift {
    private frame = 0;
    private lastPress = -1000;
    private prevOut = false;

    reset(): void {
        this.frame = 0;
        this.lastPress = -1000;
        this.prevOut = false;
    }

    /**
     * Whether the engine's drift/brake button is held this frame. `held`: the player holds drift (or
     * brake); `stickX`: steering in [-1, 1].
     */
    update(held: boolean, accel: boolean, stickX: number, k: DriftKart): boolean {
        this.frame++;
        let out = held;
        // Late steering: holding drift on the ground without a drift, while steering: hop again.
        if (out && this.prevOut && accel && k.grounded && k.fast && !k.drifting && !k.hopping && Math.abs(stickX) >= 0.5 && this.frame - this.lastPress > REHOP_COOLDOWN) {
            out = false;
        }
        if (out && !this.prevOut) this.lastPress = this.frame;
        this.prevOut = out;
        return out;
    }
}
