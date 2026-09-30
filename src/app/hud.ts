/** DOM overlay: timer, laps, speed, mini-turbo charge, state tags, speed-ups, countdown, messages, debug panel. */

import { DEV_TOOLS } from './devMode';
import type { PickupKind } from './sf/itemBoxes';

/** The item button's speed-ups, named and drawn as the vehicle's pickup (battery / gas / coffee). */
const PICKUPS: Record<PickupKind, { name: string; plural: string; icon: string }> = {
    battery: {
        name: 'battery',
        plural: 'batteries',
        icon: `<svg viewBox="0 0 20 32" aria-hidden="true"><rect x="7" y="1" width="6" height="4" rx="1" fill="#dfe3e6"/><rect x="2" y="4" width="16" height="27" rx="3" fill="#2bd67b" stroke="#0d3b24" stroke-width="1.5"/><rect x="2.75" y="25" width="14.5" height="5.25" rx="2" fill="#1d2226"/><path d="M11.5 7 L5.5 17 H9.5 L8 24 L14.5 13.5 H10.5 Z" fill="#fffbe0"/></svg>`,
    },
    gas: {
        name: 'gas',
        plural: 'gas cans',
        icon: `<svg viewBox="0 0 28 32" aria-hidden="true"><path d="M5 3 H15 V7 H5 Z" fill="none" stroke="#e8401e" stroke-width="3"/><path d="M19 2 L25 6 L22 9 L17 6 Z" fill="#2a2a2e"/><rect x="2" y="7" width="23" height="24" rx="3" fill="#e8401e" stroke="#5a1406" stroke-width="1.5"/><path d="M6 11 L21 27 M21 11 L6 27" stroke="#b02c14" stroke-width="3" stroke-linecap="round"/></svg>`,
    },
    coffee: {
        name: 'coffee',
        plural: 'coffees',
        icon: `<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M8 1 C7 3 9 4 8 6 M13 1 C12 3 14 4 13 6" stroke="#fff" stroke-width="1.3" fill="none" opacity="0.8"/><rect x="2" y="7" width="20" height="4" rx="1.5" fill="#fff" stroke="#6b5a4a" stroke-width="1"/><path d="M3.5 11 H20.5 L18 31 H6 Z" fill="#f6f2ea" stroke="#6b5a4a" stroke-width="1"/><path d="M4.6 16 H19.4 L18.5 24 H5.6 Z" fill="#a8733f"/><path d="M5 19 H19 L18.8 20.6 H5.2 Z" fill="#2bd67b"/></svg>`,
    },
};

export interface HudData {
    raceFrames: number | null; // null before the race timer starts
    lap: number;
    maxLap: number;
    lapTimes: number[]; // frames
    speed: number;
    mtCharge: number;
    mtChargeMax: number;
    mtCharged: boolean;
    tags: { label: string; on: boolean }[];
    countdown: string | null;
    speedUps: number;
    paused: boolean;
    debug: string | null;
}

export interface HudExtras {
    /** Mouse-steering stick position in [-1, 1], or null when the scheme doesn't use the mouse. */
    mouseStick: number | null;
    pointerLocked: boolean;
    itemKey: string;
    courseName: string;
    best: number | null;
}

export function formatFrames(frames: number): string {
    // The game runs at 59.94 Hz and its timer counts milliseconds from that rate.
    const ms = Math.floor((frames * 1000) / 59.94);
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

export class Hud {
    private readonly q: (sel: string) => HTMLElement;

    constructor(root: HTMLElement) {
        root.innerHTML = `
      <div class="hud-top-left"><div class="hud-course"></div><div class="hud-best"></div></div>
      <div class="hud-top-right">
        <div class="hud-time">0:00.000</div>
        <div class="hud-lap">LAP 1/3</div>
        <div class="hud-laps"></div>
      </div>
      <div class="hud-items"><div class="hud-item-slot"></div><div class="hud-item-key"></div></div>
      <div class="hud-center"></div>
      <div class="hud-flash"></div>
      <div class="hud-paused" style="display:none">PAUSED — ${DEV_TOOLS ? '<kbd>.</kbd> step frame · ' : ''}<kbd>P</kbd> resume</div>
      <div class="hud-mouse"><div class="hud-mouse-bar"><div class="hud-mouse-dot"></div></div><div class="hud-mouse-hint"></div></div>
      <div class="hud-bottom-right">
        <div class="hud-speed">0<small> u/f</small></div>
        <div class="hud-mt"><div></div></div>
        <div class="hud-tags"></div>
      </div>
      <div class="hud-debug" style="display:none"></div>`;
        const els = new Map<string, HTMLElement>();
        this.q = (sel: string) => {
            let el = els.get(sel);
            if (!el) els.set(sel, (el = root.querySelector(sel) as HTMLElement));
            return el;
        };
    }

    private readonly shown = new Map<string, string>();

    /**
     * Writes a text, markup or style value only when it changed: the HUD updates every frame, and
     * every write (even of the same value) costs the page a style / layout pass.
     */
    private put(sel: string, prop: 'text' | 'html' | 'width' | 'left' | 'display', value: string): void {
        const key = `${sel}|${prop}`;
        if (this.shown.get(key) === value) return;
        this.shown.set(key, value);
        const el = this.q(sel);
        if (prop === 'text') el.textContent = value;
        else if (prop === 'html') el.innerHTML = value;
        else el.style[prop] = value;
    }

    private flashTimer = 0;
    private pickup: PickupKind = 'coffee';

    /** Which speed-up the item button holds (the vehicle's pickup). */
    setPickup(kind: PickupKind): void {
        this.pickup = kind;
    }

    /** Shows a short message mid-screen for a moment. */
    flash(text: string): void {
        const el = this.q('.hud-flash');
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(this.flashTimer);
        this.flashTimer = window.setTimeout(() => el.classList.remove('show'), 1200);
    }

    update(d: HudData, x: HudExtras): void {
        const q = this.q;
        const put = this.put.bind(this);
        put('.hud-time', 'text', formatFrames(d.raceFrames ?? 0));
        put('.hud-lap', 'text', `LAP ${Math.min(Math.max(d.lap, 1), d.maxLap)}/${d.maxLap}`);
        put('.hud-laps', 'html', d.lapTimes.map((f, i) => `L${i + 1} ${formatFrames(f)}`).join('<br>'));
        put('.hud-speed', 'html', `${d.speed.toFixed(2)}<small> u/f</small>`);
        const ratio = d.mtChargeMax > 0 ? Math.min(1, d.mtCharge / d.mtChargeMax) : 0;
        put('.hud-mt > div', 'width', `${(ratio * 100).toFixed(1)}%`);
        q('.hud-mt').classList.toggle('charged', d.mtCharged);
        put(
            '.hud-tags',
            'html',
            d.tags
                .filter((t) => t.on)
                .map((t) => `<span class="on">${t.label === 'SPEED-UP' ? `${PICKUPS[this.pickup].name.toUpperCase()} BOOST` : t.label}</span>`)
                .join(''),
        );
        put('.hud-center', 'text', d.countdown ?? '');
        q('.hud-center').classList.toggle('show', !!d.countdown);

        // (The engine's time-trial item stock: shown as the vehicle's speed-ups.)
        const pk = PICKUPS[this.pickup];
        put('.hud-item-slot', 'html', d.speedUps > 0 ? pk.icon.repeat(d.speedUps) : `<span class="empty">no ${pk.plural}</span>`);
        put('.hud-item-key', 'text', d.speedUps > 0 ? `${x.itemKey}: ${pk.name} boost` : '');
        put('.hud-paused', 'display', d.paused ? '' : 'none');

        const stick = x.mouseStick;
        if (stick !== null) {
            put('.hud-mouse', 'display', '');
            // Show the quantized position the game actually sees (15 steps).
            const steps = Math.round(stick * 7);
            put('.hud-mouse-dot', 'left', `${50 + (steps / 7) * 50}%`);
            put('.hud-mouse-hint', 'text', x.pointerLocked ? '' : 'click to capture the mouse');
        } else {
            put('.hud-mouse', 'display', 'none');
        }

        put('.hud-course', 'text', x.courseName);
        put('.hud-best', 'text', x.best !== null ? `best ${formatFrames(x.best)}` : '');

        if (d.debug !== null) {
            put('.hud-debug', 'display', '');
            put('.hud-debug', 'text', d.debug);
        } else {
            put('.hud-debug', 'display', 'none');
        }
    }
}
