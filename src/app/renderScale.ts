/**
 * Adaptive render resolution: draws at the device pixel ratio (capped at 2) while frames keep up
 * with the display, and steps the drawing buffer's pixel ratio down (2 → 1.75 → 1.5 → 1.25 → 1,
 * never below 1) when they don't, back up after sustained headroom. Presentation only: the
 * simulation runs on its fixed 59.94 Hz clock whatever the frame rate, so nothing here can change a
 * race. The HUD is DOM and stays at full resolution.
 *
 * Measured over 1 s windows of rAF intervals in play (not in the menu or paused), against the
 * display's refresh period (the fastest interval the browser hands out):
 *  - Down, straight away: frames 10 % over the period for 2 windows running (1 when 50 % over). A
 *    step that didn't make frames faster (script- or loading-bound, not pixels) is undone, and step
 *    downs wait 30 s, then 60, 120, 240.
 *  - Up, after frames kept up for 5 s of play, made only at a calm moment (menu, pause, countdown,
 *    after the finish): resizing the drawing buffer stalls for 5-85 ms. A step up that comes back
 *    down within 5 s of play makes the next one wait longer (10, 20, 40, 80 s).
 * (The GPU timer query, EXT_disjoint_timer_query_webgl2, isn't used: on Apple GPUs it read 27-29 ms
 * for frames that took 18.)
 * No allocations per frame.
 */

import type * as THREE from 'three';

const STEP = 0.25;
/** Length of a measuring window (ms of frames). */
const WINDOW_MS = 1000;
/** Frames skipped after a resize or a gap (the resize itself, a hidden tab...). */
const SETTLE_FRAMES = 10;
/** rAF intervals this long (main.ts clamps at 250 ms) are gaps (tab hidden, loading), not frame times. */
const GAP_MS = 250;
/** Mean frame time over the refresh period that steps down (2 windows running; 1 when severe)... */
const DOWN_OVER = 1.1;
const DOWN_SEVERE = 1.5;
/** ...and that counts as keeping up. */
const KEEP_UP = 1.03;
/** Frames kept up (ms of play) before a step up, lengthening with each step up that failed. */
const UP_AFTER_MS = [5000, 10000, 20000, 40000, 80000];
/** A step down this soon after a step up (ms of play) means the step up failed. */
const UP_FAIL_MS = 5000;
/** Step downs held off (ms of play) after one that didn't help, doubling up to 8×. */
const HOLD_DOWN_MS = 30000;

/** Where the game is, for RenderScale.update. */
export const enum ScaleMoment {
    /** Menu or pause: not measured (a still picture), any change made. */
    Idle,
    /** Countdown, after the finish: measured, any change made. */
    Calm,
    /** Racing: measured, only step downs made. */
    Racing,
}

export class RenderScale {
    /** The drawing buffer's pixel ratio now. */
    scale = 1;
    /** The top step: the device pixel ratio, capped at 2. */
    private max = 1;
    /** Dev override: the scale pinned (null: adaptive). */
    private pinned: number | null = null;
    /** Dev override: the frame budget in ms (null: the display's refresh period). */
    private budgetPin: number | null = null;
    /** The display's refresh period (ms): the fastest rAF interval seen (a window's second fastest, against strays). */
    refreshMs = 1000 / 60;

    // The current window.
    private winMs = 0;
    private winFrames = 0;
    private winMin1 = Infinity;
    private winMin2 = Infinity;
    private settle = SETTLE_FRAMES;
    /** Last window's mean frame time (dev readout). */
    frameMs = 0;

    private overRun = 0;
    /** Frames kept up (ms of play) at this scale. */
    private keptUpMs = 0;
    /** A step up is due at the next calm moment. */
    private pendingUp = false;
    /** Play since the last step up (ms), and how many step ups came back down. */
    private sinceUpMs = Infinity;
    private failedUps = 0;
    /** The frame time before the last step down, to check it helped (0: nothing to check). */
    private beforeDownMs = 0;
    /** Step downs held off (ms of play) after one that didn't help, and how many didn't. */
    private holdDownMs = 0;
    private failedDowns = 0;

    constructor(private readonly renderer: THREE.WebGLRenderer) {
        this.max = Math.min(window.devicePixelRatio, 2);
        this.scale = this.max;
        renderer.setPixelRatio(this.scale);
    }

    /** The device pixel ratio changed (another screen, browser zoom): the top step follows it. */
    setMax(devicePixelRatio: number): void {
        this.max = Math.min(devicePixelRatio, 2);
        if (this.pinned === null && this.scale > this.max) this.apply(this.max);
    }

    private budget(): number {
        return this.budgetPin ?? this.refreshMs;
    }

    private apply(scale: number): void {
        if (scale === this.scale) return;
        this.scale = scale;
        this.renderer.setPixelRatio(scale);
        this.resetWindow();
        this.settle = SETTLE_FRAMES;
        this.overRun = 0;
        this.keptUpMs = 0;
        this.pendingUp = false;
    }

    private resetWindow(): void {
        this.winMs = 0;
        this.winFrames = 0;
        this.winMin1 = this.winMin2 = Infinity;
    }

    /** Once per animation frame, before the draw, with the time since the last frame. */
    update(intervalMs: number, moment: ScaleMoment): void {
        if (this.pinned !== null) {
            this.apply(this.pinned);
            return;
        }
        if (moment === ScaleMoment.Idle || intervalMs >= GAP_MS || document.hidden) {
            this.resetWindow();
            this.settle = SETTLE_FRAMES;
        } else if (this.settle > 0) {
            --this.settle;
        } else {
            if (intervalMs < this.winMin1) {
                this.winMin2 = this.winMin1;
                this.winMin1 = intervalMs;
            } else if (intervalMs < this.winMin2) this.winMin2 = intervalMs;
            this.winMs += intervalMs;
            ++this.winFrames;
            if (this.winMs >= WINDOW_MS) this.endWindow();
        }
        if (this.pendingUp && moment !== ScaleMoment.Racing) {
            this.apply(Math.min(this.max, this.scale + STEP));
            this.sinceUpMs = 0;
        }
    }

    private endWindow(): void {
        const ms = this.winMs;
        const frame = ms / this.winFrames;
        this.refreshMs = Math.max(1000 / 240, Math.min(this.refreshMs, this.winMin2));
        this.frameMs = frame;
        this.resetWindow();
        this.sinceUpMs += ms;
        this.holdDownMs = Math.max(0, this.holdDownMs - ms);
        const budget = this.budget();

        // A step down that didn't make frames faster is undone (at the next calm moment). (Not with
        // the budget pinned: frames can't beat the display's refresh however few pixels.)
        const before = this.beforeDownMs;
        this.beforeDownMs = 0;
        if (before > 0 && this.budgetPin === null) {
            const helped = frame < before * 0.93 || frame <= budget * DOWN_OVER;
            if (!helped) {
                this.holdDownMs = HOLD_DOWN_MS * 2 ** Math.min(this.failedDowns++, 3);
                this.pendingUp = true;
                return;
            }
        }

        const over = frame > budget * DOWN_OVER;
        this.overRun = over ? this.overRun + 1 : 0;
        if (over && this.scale > 1 && this.holdDownMs === 0 && (this.overRun >= 2 || frame > budget * DOWN_SEVERE)) {
            // A step up that couldn't hold: wait longer before the next.
            if (this.sinceUpMs < UP_FAIL_MS) this.failedUps = Math.min(this.failedUps + 1, UP_AFTER_MS.length - 1);
            this.beforeDownMs = frame;
            this.apply(Math.max(1, this.scale - STEP));
            return;
        }

        if (this.scale >= this.max || this.pendingUp) return;
        this.keptUpMs = frame <= budget * KEEP_UP ? this.keptUpMs + ms : 0;
        if (this.keptUpMs >= UP_AFTER_MS[this.failedUps]!) this.pendingUp = true;
    }

    // Dev tools (window.__kart.renderScale, the ` debug panel).

    /** Pins the scale (dev); null returns to adaptive. */
    pin(scale: number | null): void {
        this.pinned = scale === null ? null : Math.max(1, Math.min(2, scale));
        this.settle = SETTLE_FRAMES;
    }

    /** Pins the frame budget in ms (dev), to force a step down; null: the display's refresh period. */
    pinBudget(ms: number | null): void {
        this.budgetPin = ms;
    }

    info() {
        return {
            scale: this.scale,
            max: this.max,
            pinned: this.pinned,
            refreshMs: +this.refreshMs.toFixed(2),
            budgetMs: +this.budget().toFixed(2),
            frameMs: +this.frameMs.toFixed(2),
            pendingUp: this.pendingUp,
            failedUps: this.failedUps,
            holdDownMs: this.holdDownMs,
        };
    }

    debugText(): string {
        return `render ×${this.scale}${this.pinned !== null ? ' (pinned)' : ''} of ${this.max} · frame ${this.frameMs.toFixed(1)} / ${this.budget().toFixed(1)} ms${this.pendingUp ? ' · up when calm' : ''}`;
    }
}
