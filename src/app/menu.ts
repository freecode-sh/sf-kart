/** The pause menu (Esc in race): Resume or Restart, and the few settings: ride, controls, volume, street detail, ghosts. */

import { ENGINE_CREDIT, REMIX_GUIDE_URL } from './brand';
import { DEV_TOOLS } from './devMode';
import { SF_CREDITS } from './sf/credits';
import { SCHEMES, type SchemeId } from './input';
import { STOCK_TUNE, TUNE_KNOBS, withTune, type StatSummary, type TuneKey, type VehicleTune } from './tuning';
import { DEFAULT_VEHICLE, PICKER_ORDER, VEHICLES, vehicleDef, type VehicleId } from './vehicles';
import { button, el, extLink, kbd, setChildren, type Child } from './ui/dom';
import { freecodeLockup, wordmark } from './ui/identity';

export interface MenuState {
    scheme: SchemeId;
    smoothSteer: boolean;
    /** Blend between game frames when drawing (smoother on fast displays, up to a frame of lag). */
    interpolate: boolean;
    mouseSensitivity: number;
    volume: number;
    muted: boolean;
    /** San Francisco street detail from DataSF: crosswalks, sidewalks, bike lanes, meters (B in race). */
    streetDetail: boolean;
    vehicle: VehicleId;
    /** Stat adjustments being tried, per vehicle (on top of its data; dev tools only). */
    tunes: Partial<Record<VehicleId, Partial<VehicleTune>>>;
    /** Race translucent ghosts of your best run in each of the other vehicles. */
    ghosts: boolean;
}

/** The tune a vehicle races with: its data, then (dev tools only) the menu's adjustments. */
export function effectiveTune(s: MenuState, id: VehicleId): VehicleTune {
    return DEV_TOOLS ? withTune(STOCK_TUNE, s.tunes[id]) : { ...STOCK_TUNE };
}

export interface MenuCallbacks {
    onStart(state: MenuState): void;
    onChange(state: MenuState): void;
    /** The vehicle's race stats with `tune`. */
    statsFor(vehicle: VehicleId, tune: VehicleTune): StatSummary;
}

const STORAGE_KEY = 'kart.settings.v1';

export function loadMenuState(): MenuState {
    const defaults: MenuState = {
        scheme: 'wasd',
        smoothSteer: true,
        interpolate: false,
        mouseSensitivity: 4,
        volume: 0.6,
        muted: false,
        streetDetail: true,
        vehicle: DEFAULT_VEHICLE,
        tunes: {},
        ghosts: true,
    };
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<MenuState>;
        const s = { ...defaults, ...saved };
        if (!(s.scheme in SCHEMES)) s.scheme = defaults.scheme;
        if (typeof s.streetDetail !== 'boolean') s.streetDetail = defaults.streetDetail;
        if (!VEHICLES.some((v) => v.id === s.vehicle)) s.vehicle = defaults.vehicle;
        if (typeof s.tunes !== 'object' || s.tunes === null) s.tunes = {};
        return s;
    } catch {
        return defaults;
    }
}

function saveMenuState(s: MenuState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export class Menu {
    private readonly el: HTMLElement;
    private visible = false;
    /** A race has been started (the menu offers Resume). */
    private raced = false;
    /** Vehicle and tune of the race in progress (changing either restarts). */
    private raceVehicle: VehicleId | null = null;
    private raceTune = '';

    constructor(
        public state: MenuState,
        private readonly cb: MenuCallbacks,
    ) {
        this.el = document.createElement('div');
        this.el.className = 'menu';
        document.body.appendChild(this.el);
        this.render();
    }

    isOpen(): boolean {
        return this.visible;
    }

    open(): void {
        this.visible = true;
        this.render();
        this.el.classList.add('open');
    }

    close(): void {
        this.visible = false;
        this.el.classList.remove('open');
    }

    /** Starts the race with the current selection (Enter / button). */
    start(): void {
        this.raced = true;
        this.raceVehicle = this.state.vehicle;
        this.raceTune = JSON.stringify(effectiveTune(this.state, this.state.vehicle));
        saveMenuState(this.state);
        this.close();
        this.cb.onStart(this.state);
    }

    /**
     * Dev tuning: stores a vehicle's adjustments (undefined: back to its data) and takes them
     * as the running race's, since they were applied live (no restart on resume).
     */
    setTuneLive(id: VehicleId, tune: Partial<VehicleTune> | undefined): void {
        const tunes = { ...this.state.tunes };
        if (tune) tunes[id] = tune;
        else delete tunes[id];
        this.state.tunes = tunes;
        saveMenuState(this.state);
        if (this.raceVehicle === id) this.raceTune = JSON.stringify(effectiveTune(this.state, id));
    }

    set<K extends keyof MenuState>(key: K, value: MenuState[K]): void {
        this.state[key] = value;
        saveMenuState(this.state);
        this.cb.onChange(this.state);
        this.render();
    }

    private render(): void {
        const s = this.state;
        const row = (label: string, ...control: Child[]) => el('div', { class: 'setting' }, el('span', { class: 'label' }, label), ...control);
        const onOff = (key: 'streetDetail' | 'ghosts') =>
            this.segments([true, false].map((on) => [on ? 'On' : 'Off', s[key] === on, () => this.set(key, on)] as const));
        setChildren(
            this.el,
            el(
                'section',
                { class: 'card' },
                wordmark('small'),
                el('h2', null, this.raced ? 'Paused' : 'Settings'),
                row('Ride', this.segments(PICKER_ORDER.map((id) => [vehicleDef(id).short, id === s.vehicle, () => this.set('vehicle', id)] as const))),
                row('Controls', this.segments(Object.values(SCHEMES).map((sc) => [sc.short, sc.id === s.scheme, () => this.set('scheme', sc.id)] as const))),
                s.scheme === 'mouse' ? row('Mouse', this.range('mouseSensitivity', 1, 12, 0.5)) : null,
                row('Volume', this.range('volume', 0, 1, 0.05)),
                row('Street detail', onOff('streetDetail')),
                row('Ghosts', onOff('ghosts')),
                DEV_TOOLS ? this.tuningPanel() : null,
                el(
                    'div',
                    { class: 'menu-links' },
                    freecodeLockup(),
                    extLink(REMIX_GUIDE_URL, 'Remix it'),
                    el('details', null, el('summary', null, 'Credits'), el('ul', null, ...[ENGINE_CREDIT, ...SF_CREDITS].map((c) => el('li', null, c)))),
                ),
                el(
                    'div',
                    { class: 'card-foot' },
                    this.raced ? button({ class: 'back', on: { click: () => this.start() } }, 'Restart', kbd('Enter')) : el('span'),
                    this.raced
                        ? button({ class: 'go', on: { click: () => this.resume() } }, 'Resume', kbd('Esc'))
                        : button({ class: 'go', on: { click: () => this.start() } }, 'Race!', kbd('Enter')),
                ),
            ),
        );
    }

    /** One of a few (label, selected, choose). */
    private segments(opts: readonly (readonly [string, boolean, () => void])[]): HTMLElement {
        return el(
            'div',
            { class: 'segments', role: 'radiogroup' },
            ...opts.map(([label, sel, pick]) => button({ class: sel ? 'sel' : '', role: 'radio', 'aria-checked': sel, on: { click: pick } }, label)),
        );
    }

    /** A settings slider. Moving the volume unmutes. */
    private range(key: 'mouseSensitivity' | 'volume', min: number, max: number, step: number): HTMLInputElement {
        const input = el('input', {
            type: 'range',
            min,
            max,
            step,
            value: this.state[key],
            on: {
                input: () => {
                    if (key === 'volume') this.state.muted = false;
                    this.setOpt(key, Number(input.value), false);
                },
            },
        });
        return input;
    }

    /** Stores a setting from the menu's controls (sliders update in place, the rest re-render). */
    private setOpt<K extends keyof MenuState>(key: K, v: MenuState[K], rerender: boolean): void {
        this.state[key] = v;
        saveMenuState(this.state);
        this.cb.onChange(this.state);
        if (rerender) this.render();
    }

    /** Closes the menu without restarting, if nothing that requires a restart changed. */
    resume(): void {
        if (
            !this.raced ||
            this.raceVehicle !== this.state.vehicle ||
            this.raceTune !== JSON.stringify(effectiveTune(this.state, this.state.vehicle))
        ) {
            this.start();
            return;
        }
        saveMenuState(this.state);
        this.close();
        this.cb.onChange(this.state);
    }

    /** Label of a tuning knob: the multiplier and what it does to the stat. */
    private knobText(key: TuneKey): Child[] {
        const t = effectiveTune(this.state, this.state.vehicle);
        const v = t[key];
        if (key === 'miniTurbo') return [`${v >= 0 ? '+' : ''}${v} f`];
        const pct = (v - 1) * 100;
        return [`×${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} `, el('small', null, `(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`)];
    }

    /** Every vehicle's non-stock tune (multipliers on its data). */
    tuneJson(): string {
        const out: Record<string, Partial<VehicleTune>> = {};
        for (const v of VEHICLES) {
            const t = effectiveTune(this.state, v.id);
            const diff: Partial<VehicleTune> = {};
            for (const k of Object.keys(STOCK_TUNE) as TuneKey[]) if (t[k] !== STOCK_TUNE[k]) diff[k] = t[k];
            if (Object.keys(diff).length) out[v.id] = diff;
        }
        return JSON.stringify(out, null, 2);
    }


    /** Sliders for the selected vehicle's stat adjustments. */
    private tuningPanel(): HTMLElement {
        const s = this.state;
        const def = vehicleDef(s.vehicle);
        const t = effectiveTune(s, s.vehicle);
        const stock = this.cb.statsFor(s.vehicle, STOCK_TUNE);
        const now = this.cb.statsFor(s.vehicle, t);
        const knobs = TUNE_KNOBS.filter((k) => !(k.kartOnly && def.kind === 'bike'));
        const json = this.tuneJson();
        const knobRow = (k: (typeof TUNE_KNOBS)[number]) => {
            const a = stock[k.key];
            const b = now[k.key];
            const fmt = (x: number) => (k.key === 'miniTurbo' ? `${x}f` : x.toPrecision(4));
            const out = el('output', null, ...this.knobText(k.key));
            const input = el('input', {
                type: 'range',
                min: k.min,
                max: k.max,
                step: k.step,
                value: t[k.key],
                on: {
                    input: () => {
                        const tune = { ...(this.state.tunes[this.state.vehicle] ?? {}) };
                        tune[k.key] = Number(input.value);
                        this.state.tunes = { ...this.state.tunes, [this.state.vehicle]: tune };
                        saveMenuState(this.state);
                        setChildren(out, ...this.knobText(k.key));
                    },
                    change: () => this.render(),
                },
            });
            return el(
                'tr',
                { title: k.help },
                el('td', null, k.label),
                el('td', null, input, ' ', out),
                el('td', null, el('small', null, ...(a === b ? [fmt(a)] : [`${fmt(a)} → `, el('b', null, fmt(b))]))),
            );
        };
        const copy = button(
            {
                class: 'pill',
                on: {
                    click: () => {
                        void navigator.clipboard?.writeText(this.tuneJson());
                        copy.textContent = 'Copied';
                    },
                },
            },
            'Copy tuning',
        );
        return el(
            'details',
            { class: 'tuning', open: !!s.tunes[s.vehicle] },
            el('summary', null, `Tuning: ${def.name} `, el('small', null, '(small nudges on the stock numbers; applies when the race restarts)')),
            el('table', null, ...knobs.map(knobRow)),
            el(
                'div',
                { class: 'menu-row' },
                button(
                    {
                        class: 'pill',
                        on: {
                            click: () => {
                                const tunes = { ...this.state.tunes };
                                delete tunes[this.state.vehicle];
                                this.set('tunes', tunes);
                            },
                        },
                    },
                    `Reset ${def.name} to stock`,
                ),
                copy,
                el('small', null, "Multipliers on the vehicle's numbers: bake them into public/data/vehicles/vehicles.json to make them the default."),
            ),
            json !== '{}' ? el('pre', { class: 'tune-json' }, json) : null,
        );
    }
}
