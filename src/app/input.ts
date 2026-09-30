/**
 * Keyboard / mouse / gamepad input, converted to the engine's raw controller format: face
 * buttons (accelerate / brake / item / drift), the stick quantized to 15 steps per axis (raw 0..14,
 * 7 = neutral), and the trick d-pad. Several control schemes are selectable; a gamepad always works.
 */

export const enum TrickDir {
    None = 0,
    Up = 1,
    Down = 2,
    Left = 3,
    Right = 4,
}

export interface RawPadState {
    /** Bit 0 accelerate, bit 1 brake, bit 2 item, bit 3 drift. */
    buttons: number;
    /** 0..14 with 7 as neutral (left = 0). */
    stickXRaw: number;
    /** 0..14 with 7 as neutral (down = 0). */
    stickYRaw: number;
    trick: TrickDir;
    /** The trick came from a d-pad direction (sent as is, not turned into a side trick by steering). */
    explicitTrick?: boolean;
}

export const BUTTON_ACCELERATE = 0x1;
export const BUTTON_BRAKE = 0x2;
export const BUTTON_ITEM = 0x4;
export const BUTTON_DRIFT = 0x8;

export type SchemeId = 'wasd' | 'mouse' | 'classic';

type Action =
    | 'accelerate'
    | 'brake'
    | 'drift'
    | 'item'
    | 'left'
    | 'right'
    | 'up'
    | 'down'
    | 'halfTilt'
    | 'trick'
    | 'trickDown'
    | 'trickLeft'
    | 'trickRight';

export interface ControlScheme {
    id: SchemeId;
    name: string;
    tagline: string;
    keys: Partial<Record<Action, string[]>>;
    /** Mouse buttons (MouseEvent.button) mapped to actions. */
    mouse?: Partial<Record<Action, number>>;
    /** Horizontal mouse movement steers (pointer lock). */
    mouseSteer?: boolean;
    /** Tricks are d-pad directions sent as pressed (the arrows layout), not trick key + steer. */
    dpadTricks?: boolean;
    /** Human-readable help rows: [keys, action]. */
    help: [string, string][];
    /** The name on a small tab. */
    short: string;
    /** The first lap's keys, [keys (space separated), action]: the controls screen. */
    quick: [string, string][];
}

export const SCHEMES: Record<SchemeId, ControlScheme> = {
    wasd: {
        id: 'wasd',
        name: 'WASD',
        short: 'WASD',
        tagline: 'Keyboard only. Left hand drives, thumb drifts.',
        quick: [
            ['W', 'Go'],
            ['A D', 'Steer'],
            ['Space', 'Drift'],
            ['E', 'Speed-up'],
            ['S', 'Brake'],
        ],
        keys: {
            accelerate: ['KeyW'],
            brake: ['KeyS'],
            left: ['KeyA'],
            right: ['KeyD'],
            drift: ['Space'],
            item: ['KeyE'],
            trick: ['ShiftLeft', 'KeyQ'],
            up: ['KeyR'],
            down: ['KeyF'],
        },
        help: [
            ['W', 'accelerate'],
            ['A / D', 'steer'],
            ['Space', 'hop / drift · trick off a ramp (+ A/D: side trick)'],
            ['S', 'brake / reverse'],
            ['R / F', 'stick up / down (dive in the air)'],
            ['Shift or Q', 'wheelie (e-bike) · trick'],
            ['E', 'speed-up'],
        ],
    },
    mouse: {
        id: 'mouse',
        name: 'WASD + Mouse',
        short: 'Mouse',
        quick: [
            ['W', 'Go'],
            ['Mouse', 'Steer'],
            ['Click', 'Drift'],
            ['E', 'Speed-up'],
            ['S', 'Brake'],
        ],
        tagline: 'Analog steering with the mouse, so you can feather drift angles like a real stick.',
        keys: {
            accelerate: ['KeyW'],
            brake: ['KeyS'],
            left: ['KeyA'],
            right: ['KeyD'],
            drift: ['ShiftLeft'],
            item: ['KeyE'],
            trick: ['Space'],
            up: ['KeyR'],
            down: ['KeyF'],
        },
        mouse: { drift: 0, item: 2 },
        mouseSteer: true,
        help: [
            ['W', 'accelerate'],
            ['Mouse ↔', 'steer (analog)'],
            ['Left click or Shift', 'hop / drift · trick off a ramp (+ steer: side trick)'],
            ['Right click or E', 'speed-up'],
            ['Space', 'wheelie (e-bike) · trick'],
            ['S', 'brake / reverse'],
            ['R / F', 'stick up / down (dive in the air)'],
        ],
    },
    classic: {
        id: 'classic',
        name: 'Arrows',
        short: 'Arrows',
        quick: [
            ['X', 'Go'],
            ['← →', 'Steer'],
            ['W', 'Drift'],
            ['Q', 'Speed-up'],
            ['Z', 'Brake'],
        ],
        tagline: 'A classic emulator keyboard layout: the arrows are the whole stick.',
        keys: {
            accelerate: ['KeyX'],
            brake: ['KeyZ'],
            drift: ['KeyW'],
            item: ['KeyQ'],
            left: ['ArrowLeft'],
            right: ['ArrowRight'],
            up: ['ArrowUp'],
            down: ['ArrowDown'],
            halfTilt: ['ShiftLeft', 'ShiftRight'],
            trick: ['KeyT'],
            trickDown: ['KeyG'],
            trickLeft: ['KeyF'],
            trickRight: ['KeyH'],
        },
        dpadTricks: true,
        help: [
            ['X', 'accelerate (A)'],
            ['Arrows', 'stick: steer, ↑ / ↓ dive in the air'],
            ['Shift', 'half tilt'],
            ['W', 'hop / drift (R) · trick off a ramp'],
            ['Z', 'brake / reverse (B)'],
            ['T F G H', 'trick / wheelie (d-pad)'],
            ['Q', 'speed-up (L)'],
        ],
    },
};

/**
 * An 8-bit analog stick -> 15-step race input (raw 0..14, 7 = neutral): the stick values (1.0 =
 * 127 counts from center) at which each step starts. Right steps are 9 counts apart from 24; left
 * ones are shifted one step.
 */
const STICK_STEPS_RIGHT = [0.19, 0.26, 0.33, 0.4, 0.47, 0.54, 0.61];
const STICK_STEPS_LEFT = [0.13, 0.19, 0.26, 0.33, 0.4, 0.47, 0.54];
/** The stick reaches about 100 of its 127 counts at its gate. */
const STICK_GATE = 100 / 127;

/** Quantizes a stick value (1.0 = 127 counts) exactly like the engine. */
function quantizeStick(g: number): number {
    const steps = g >= 0 ? STICK_STEPS_RIGHT : STICK_STEPS_LEFT;
    const m = Math.abs(g);
    let n = 0;
    for (const t of steps) if (m >= t) ++n;
    return g >= 0 ? 7 + n : 7 - n;
}

/**
 * Quantizes an analog axis in [-1, 1] (a pad's full throw = the stick at its gate) to the
 * engine's 15-step raw value, with the controller's dead zone and step thresholds.
 */
function quantizeAxis(v: number): number {
    return quantizeStick(Math.max(-1, Math.min(1, v)) * STICK_GATE);
}

export interface InputSettings {
    scheme: SchemeId;
    /** Keyboard steering ramps to full lock over a few frames instead of snapping. */
    smoothSteer: boolean;
    /** Mouse steering sensitivity (stick units per pixel ×1000). */
    mouseSensitivity: number;
}

export class InputManager {
    private readonly down = new Set<string>();
    private readonly pressedThisFrame = new Set<string>();
    private readonly mouseDown = new Set<number>();
    /** Virtual analog stick driven by the mouse, in [-1, 1]. */
    private mouseStick = 0;
    private mouseMovedRecently = 0;
    /** Smoothed keyboard steering value, in [-1, 1]. */
    private keySteer = 0;
    /** Trick direction held on the previous sample (tricks fire on the press only). */
    private lastTrickHeld = TrickDir.None;
    /** A trick key pressed since the last sample (so a tap shorter than a frame still counts). */
    private pendingTrick = TrickDir.None;
    settings: InputSettings = { scheme: 'wasd', smoothSteer: true, mouseSensitivity: 4 };
    /** Off while the menu is open: sample() then gives an idle pad. */
    enabled = true;
    /** A gamepad was used since this was last cleared (run files note the input device). */
    usedGamepad = false;

    constructor(private readonly target: HTMLElement) {
        window.addEventListener('keydown', (e) => {
            // Typing in a text field (the leaderboard's name) isn't driving.
            if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
            if (this.isBound(e.code) || e.code === 'Space') e.preventDefault();
            if (!this.down.has(e.code)) {
                this.pressedThisFrame.add(e.code);
                const k = this.scheme().keys;
                if (k.trick?.includes(e.code)) this.pendingTrick = TrickDir.Up;
                else if (k.trickDown?.includes(e.code)) this.pendingTrick = TrickDir.Down;
                else if (k.trickLeft?.includes(e.code)) this.pendingTrick = TrickDir.Left;
                else if (k.trickRight?.includes(e.code)) this.pendingTrick = TrickDir.Right;
            }
            this.down.add(e.code);
        });
        window.addEventListener('keyup', (e) => this.down.delete(e.code));
        window.addEventListener('blur', () => {
            this.down.clear();
            this.mouseDown.clear();
        });
        target.addEventListener('mousedown', (e) => {
            this.mouseDown.add(e.button);
            if (this.scheme().mouseSteer && document.pointerLockElement !== target) {
                void target.requestPointerLock();
            }
        });
        window.addEventListener('mouseup', (e) => this.mouseDown.delete(e.button));
        target.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('mousemove', (e) => {
            if (!this.scheme().mouseSteer || document.pointerLockElement !== target) return;
            const k = this.settings.mouseSensitivity / 1000;
            this.mouseStick = Math.max(-1, Math.min(1, this.mouseStick + e.movementX * k));
            this.mouseMovedRecently = 6;
        });
    }

    scheme(): ControlScheme {
        return SCHEMES[this.settings.scheme];
    }

    setScheme(id: SchemeId): void {
        this.settings.scheme = id;
        this.mouseStick = 0;
        if (!SCHEMES[id].mouseSteer && document.pointerLockElement) document.exitPointerLock();
    }

    /** Current mouse-stick position for the HUD steering indicator, or null. */
    mouseStickValue(): number | null {
        return this.scheme().mouseSteer ? this.mouseStick : null;
    }

    pointerLocked(): boolean {
        return document.pointerLockElement === this.target;
    }

    recenterMouse(): void {
        this.mouseStick = 0;
    }

    private isBound(code: string): boolean {
        return Object.values(this.scheme().keys).some((codes) => codes?.includes(code));
    }

    private held(action: Action): boolean {
        const s = this.scheme();
        if (s.keys[action]?.some((c) => this.down.has(c))) return true;
        const mb = s.mouse?.[action];
        return mb !== undefined && this.mouseDown.has(mb);
    }

    /** True once per key press (edge-triggered), for UI actions. */
    consumePress(code: string): boolean {
        const had = this.pressedThisFrame.has(code);
        this.pressedThisFrame.delete(code);
        return had;
    }

    endFrame(): void {
        this.pressedThisFrame.clear();
    }

    /** Samples the current state in the engine's raw format. Call once per physics frame. */
    sample(): RawPadState {
        if (!this.enabled) {
            this.pendingTrick = TrickDir.None;
            return { buttons: 0, stickXRaw: 7, stickYRaw: 7, trick: TrickDir.None };
        }

        let buttons = 0;
        // Direction held right now; the race input only gets it on the frame it's pressed (the real
        // controller layer does this: every trick in real ghosts lasts exactly one frame, so
        // holding the button through a landing doesn't start a wheelie).
        let trick = TrickDir.None;
        if (this.held('accelerate')) buttons |= BUTTON_ACCELERATE;
        if (this.held('brake')) buttons |= BUTTON_BRAKE;
        if (this.held('drift')) buttons |= BUTTON_DRIFT;
        if (this.held('item')) buttons |= BUTTON_ITEM;
        if (this.held('trick')) trick = TrickDir.Up;
        else if (this.held('trickDown')) trick = TrickDir.Down;
        else if (this.held('trickLeft')) trick = TrickDir.Left;
        else if (this.held('trickRight')) trick = TrickDir.Right;
        let explicitTrick = this.scheme().dpadTricks === true;

        // Digital steering (optionally ramped).
        const dir = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
        if (this.settings.smoothSteer) {
            // Reaches full lock in 4 frames; releases in 2 (a thumb snapping back to center).
            const rate = dir === 0 ? 0.5 : Math.sign(dir) !== Math.sign(this.keySteer) ? 0.5 : 0.25;
            if (this.keySteer < dir) this.keySteer = Math.min(dir, this.keySteer + rate);
            else if (this.keySteer > dir) this.keySteer = Math.max(dir, this.keySteer - rate);
        } else {
            this.keySteer = dir;
        }
        let stickX = this.keySteer;

        const s = this.scheme();
        if (s.mouseSteer) {
            // Very gentle auto-centering once the mouse rests, so the wheel doesn't drift off.
            if (this.mouseMovedRecently > 0) this.mouseMovedRecently--;
            else this.mouseStick *= 0.985;
            if (Math.abs(this.mouseStick) < 0.02) this.mouseStick = 0;
            if (dir === 0) stickX = this.mouseStick;
        }

        // Stick up / down (in the air: dive / lean back). Keys move the stick instantly.
        const yDir = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0);

        // Keyboard / mouse steering goes through the same stick curve as a pad.
        // The arrows layout pushes the stick past the gate (1.0, square gate), and its
        // modifier (Shift) to half tilt; otherwise full lock = the stick at its gate.
        let stickXRaw: number;
        let stickYRaw: number;
        if (s.dpadTricks) {
            const tilt = this.held('halfTilt') ? 0.5 : 1.0;
            stickXRaw = quantizeStick(stickX * tilt);
            stickYRaw = quantizeStick(yDir * tilt);
        } else {
            stickXRaw = quantizeAxis(stickX);
            stickYRaw = quantizeAxis(yDir);
        }

        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const pad of pads) {
            if (!pad || !pad.connected) continue;
            const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
            // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 12-15 d-pad.
            if (btn(0)) buttons |= BUTTON_ACCELERATE;
            if (btn(1) || btn(2)) buttons |= BUTTON_BRAKE;
            if (btn(5) || btn(7)) buttons |= BUTTON_DRIFT;
            if (btn(4) || btn(6)) buttons |= BUTTON_ITEM;
            if (btn(12) || btn(13) || btn(14) || btn(15)) explicitTrick = true;
            if (btn(12)) trick = TrickDir.Up;
            else if (btn(13)) trick = TrickDir.Down;
            else if (btn(14)) trick = TrickDir.Left;
            else if (btn(15)) trick = TrickDir.Right;
            const ax = pad.axes[0] ?? 0;
            const ay = -(pad.axes[1] ?? 0);
            const qx = quantizeAxis(ax);
            const qy = quantizeAxis(ay);
            if (qx !== 7) stickXRaw = qx;
            if (qy !== 7) stickYRaw = qy;
            if (qx !== 7 || qy !== 7 || pad.buttons.some((b) => b.pressed)) this.usedGamepad = true;
            break;
        }

        const held = trick;
        trick = held !== TrickDir.None && held !== this.lastTrickHeld ? held : this.pendingTrick;
        this.pendingTrick = TrickDir.None;
        this.lastTrickHeld = held;
        return { buttons, stickXRaw, stickYRaw, trick, explicitTrick };
    }
}
