/** Start / pause menu: vehicle, control scheme, audio, input and display settings. */

import { ENGINE_CREDIT, FREECODE_URL, INSTALL_COMMAND, REMIX_GUIDE_URL, SOURCE_URL } from './brand';
import { DEV_TOOLS } from './devMode';
import { SF_CREDITS } from './sf/credits';
import { SCHEMES, type SchemeId } from './input';
import { STOCK_TUNE, TUNE_KNOBS, withTune, type StatSummary, type TuneKey, type VehicleTune } from './tuning';
import { DEFAULT_VEHICLE, VEHICLES, vehicleDef, type VehicleId } from './vehicles';

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
    /** Race translucent ghosts of your best run in each vehicle. */
    ghosts: boolean;
}

/** The tune a vehicle races with: its data, then (dev tools only) the menu's adjustments. */
export function effectiveTune(s: MenuState, id: VehicleId): VehicleTune {
    return DEV_TOOLS ? withTune(STOCK_TUNE, s.tunes[id]) : { ...STOCK_TUNE };
}

export interface MenuCallbacks {
    onStart(state: MenuState): void;
    onChange(state: MenuState): void;
    /** The leaderboard's menu panel (kept across renders) and its refresh when the menu opens. */
    leaderboard?: { panel: HTMLElement; open(): void };
    bestFor(vehicle: VehicleId): string | null;
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
        this.cb.leaderboard?.open();
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
        const resume = this.raced;
        this.el.innerHTML = `
      <div class="menu-panel">
        <div class="menu-title">SF KART <span>Golden Gate</span></div>
        <div class="menu-sub">Race real San Francisco streets, from Crissy Field across the Golden Gate Bridge and back. Map data © OpenStreetMap contributors.</div>

        <div class="menu-section">Vehicle <small>(<kbd>C</kbd> in race switches and restarts)</small></div>
        ${this.vehicleCards()}
        <div class="menu-row small">Drifting: hold drift and steer (even after the hop) to slide; sparks go blue (mini-turbo), then orange on the cars (super); let go to boost. No button, no drift.</div>
        <div class="menu-row">
          <label><input type="checkbox" data-opt="ghosts" ${s.ghosts ? 'checked' : ''}/> Compare ghosts <small>(race translucent ghosts of your best run in each vehicle; the results compare section splits)</small></label>
        </div>
        ${this.cb.leaderboard ? '<div data-leaderboard></div>' : ''}
        ${DEV_TOOLS ? this.tuningPanel() : ''}

        <div class="menu-row">
          <span>Street detail <small>(San Francisco · <kbd>B</kbd> in race)</small></span>
          <button class="pill ${s.streetDetail ? 'sel' : ''}" data-detail="on">On</button>
          <button class="pill ${s.streetDetail ? '' : 'sel'}" data-detail="off">Off</button>
          <small>Crosswalks, sidewalks and curbs, bike lanes, curb ramps and parking meters from DataSF.</small>
        </div>

        <div class="menu-section">Controls</div>
        <div class="menu-cards schemes">
          ${Object.values(SCHEMES)
              .map(
                  (sc) => `<button class="card ${sc.id === s.scheme ? 'sel' : ''}" data-scheme="${sc.id}">
                <b>${sc.name}</b><small>${sc.tagline}</small>
                <table>${sc.help.map(([k, a]) => `<tr><td><kbd>${k}</kbd></td><td>${a}</td></tr>`).join('')}</table>
              </button>`,
              )
              .join('')}
        </div>
        <div class="menu-row">
          <label><input type="checkbox" data-opt="smoothSteer" ${s.smoothSteer ? 'checked' : ''}/> Smooth keyboard steering <small>(ramps to full lock over 4 frames instead of snapping)</small></label>
        </div>
        <div class="menu-row">
          <label><input type="checkbox" data-opt="interpolate" ${s.interpolate ? 'checked' : ''}/> Smooth frame interpolation <small>(blends between game frames on high-refresh displays; off shows each frame as soon as it's computed, with less lag)</small></label>
        </div>
        <div class="menu-row ${s.scheme === 'mouse' ? '' : 'dim'}">
          <label>Mouse sensitivity <input type="range" min="1" max="12" step="0.5" value="${s.mouseSensitivity}" data-opt="mouseSensitivity"/> <span>${s.mouseSensitivity}</span></label>
        </div>
        <div class="menu-row">
          <label>Volume <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-opt="volume"/></label>
          <label><input type="checkbox" data-opt="muted" ${s.muted ? 'checked' : ''}/> Mute</label>
        </div>
        <div class="menu-row small">
          Gamepad always works: A accelerate · B brake · RB/RT hop, drift and tricks · LB/LT speed-up · D-pad ↑ wheelie.
          In race: <kbd>Esc</kbd> menu · <kbd>Backspace</kbd> restart · <kbd>P</kbd> pause${DEV_TOOLS ? ' · <kbd>.</kbd> frame step · <kbd>`</kbd> debug · <kbd>K</kbd> live tuning' : ''}
        </div>
        <button class="menu-go">${resume ? 'Restart' : 'Race!'} <small>Enter</small></button>
        ${resume ? '<button class="menu-resume">Resume <small>Esc</small></button>' : ''}

        <div class="menu-foot">
          <div class="menu-freecode">
            <a href="${FREECODE_URL}" target="_blank" rel="noopener"><b>Built with freecode</b></a>, the free coding agent.
            Remix SF Kart: a track in your city, a new vehicle, other weather.
            <span class="menu-install"><code>${INSTALL_COMMAND}</code><button class="pill" data-copy-install>Copy</button></span>
            <a href="${REMIX_GUIDE_URL}" target="_blank" rel="noopener">Remix guide</a> · <a href="${SOURCE_URL}" target="_blank" rel="noopener">Source</a>
          </div>
          <details class="menu-credits">
            <summary>Credits</summary>
            <ul>${[ENGINE_CREDIT, ...SF_CREDITS].map((c) => `<li>${c}</li>`).join('')}</ul>
          </details>
        </div>
      </div>`;

        if (this.cb.leaderboard) this.el.querySelector('[data-leaderboard]')?.replaceWith(this.cb.leaderboard.panel);
        this.el.querySelectorAll<HTMLElement>('[data-vehicle]').forEach((b) =>
            b.addEventListener('click', () => this.set('vehicle', b.dataset.vehicle as VehicleId)),
        );
        this.el.querySelectorAll<HTMLInputElement>('input[data-tune]').forEach((inp) => {
            const key = inp.dataset.tune as TuneKey;
            inp.addEventListener('input', () => {
                const t = { ...(this.state.tunes[this.state.vehicle] ?? {}) };
                t[key] = Number(inp.value);
                this.state.tunes = { ...this.state.tunes, [this.state.vehicle]: t };
                saveMenuState(this.state);
                const out = inp.parentElement?.querySelector('output');
                if (out) out.innerHTML = this.knobText(key);
            });
            inp.addEventListener('change', () => this.render());
        });
        this.el.querySelector('[data-tune-reset]')?.addEventListener('click', () => {
            const tunes = { ...this.state.tunes };
            delete tunes[this.state.vehicle];
            this.set('tunes', tunes);
        });
        this.el.querySelector('[data-tune-copy]')?.addEventListener('click', () => {
            void navigator.clipboard?.writeText(this.tuneJson());
            const b = this.el.querySelector('[data-tune-copy]');
            if (b) b.textContent = 'Copied';
        });
        this.el.querySelectorAll<HTMLElement>('[data-scheme]').forEach((b) =>
            b.addEventListener('click', () => this.set('scheme', b.dataset.scheme as SchemeId)),
        );
        this.el.querySelectorAll<HTMLElement>('[data-detail]').forEach((b) =>
            b.addEventListener('click', () => this.set('streetDetail', b.dataset.detail === 'on')),
        );
        this.el.querySelectorAll<HTMLInputElement>('input[data-opt]').forEach((inp) => {
            const key = inp.dataset.opt as keyof MenuState;
            inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
                const v = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
                (this.state as unknown as Record<string, unknown>)[key] = v;
                saveMenuState(this.state);
                this.cb.onChange(this.state);
                if (inp.type !== 'range') this.render();
                else {
                    const span = inp.parentElement?.querySelector('span');
                    if (span) span.textContent = String(v);
                }
            });
        });
        this.el.querySelector('[data-copy-install]')?.addEventListener('click', (e) => {
            void navigator.clipboard?.writeText(INSTALL_COMMAND);
            (e.currentTarget as HTMLElement).textContent = 'Copied';
        });
        this.el.querySelector('.menu-go')!.addEventListener('click', () => this.start());
        this.el.querySelector('.menu-resume')?.addEventListener('click', () => this.resume());
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

    /** Vehicle cards with stat bars (relative to the three vehicles; the numbers are the engine's). */
    private vehicleCards(): string {
        const s = this.state;
        const stats = VEHICLES.map((v) => this.cb.statsFor(v.id, effectiveTune(s, v.id)));
        const rows: { key: keyof StatSummary; label: string; fmt: (x: number) => string; invert?: boolean; kartOnly?: boolean }[] = [
            { key: 'speed', label: 'Speed', fmt: (x) => x.toFixed(2) },
            { key: 'accel', label: 'Accel', fmt: (x) => x.toFixed(3) },
            { key: 'handling', label: 'Handling', fmt: (x) => x.toFixed(4) },
            { key: 'drift', label: 'Drift', fmt: (x) => x.toFixed(4) },
            { key: 'driftAngle', label: 'Drift angle', fmt: (x) => `${x.toFixed(1)}°`, kartOnly: true },
            { key: 'turnDrag', label: 'Cornering', fmt: (x) => `-${x.toFixed(2)}%`, invert: true },
            { key: 'offroad', label: 'Offroad', fmt: (x) => x.toFixed(3) },
            { key: 'miniTurbo', label: 'Mini-turbo', fmt: (x) => `${x}f` },
        ];
        const bar = (key: keyof StatSummary, v: number, invert?: boolean) => {
            const vals = stats.map((x) => x[key]);
            const lo = Math.min(...vals);
            const hi = Math.max(...vals);
            let f = hi > lo ? (v - lo) / (hi - lo) : 0.5;
            if (invert) f = 1 - f;
            return `<span class="stat-bar"><span style="width:${(30 + 70 * f).toFixed(0)}%"></span></span>`;
        };
        return `<div class="menu-cards vehicles">${VEHICLES.map((v, i) => {
            const st = stats[i]!;
            const best = this.cb.bestFor(v.id);
            const tuned = JSON.stringify(effectiveTune(s, v.id)) !== JSON.stringify(STOCK_TUNE);
            const table = `<table class="stats">${rows
                .map((r) => `<tr><td>${r.label}</td><td>${r.kartOnly && v.kind === 'bike' ? '' : bar(r.key, st[r.key], r.invert)}</td><td>${r.kartOnly && v.kind === 'bike' ? '—' : r.fmt(st[r.key])}</td></tr>`)
                .join('')}</table>`;
            return `<button class="card ${v.id === s.vehicle ? 'sel' : ''}" data-vehicle="${v.id}">
                <b><i class="swatch" style="background:${v.color}"></i>${v.name}</b><small>${v.tagline}</small>
                <i>${v.kind === 'bike' ? 'inside drift' : 'outside drift'}${tuned ? ' · tuned' : ''}${best ? ` · best ${best}` : ''}</i>${table}
              </button>`;
        }).join('')}</div>`;
    }

    /** Label of a tuning knob: the multiplier and what it does to the stat. */
    private knobText(key: TuneKey): string {
        const t = effectiveTune(this.state, this.state.vehicle);
        const v = t[key];
        if (key === 'miniTurbo') return `${v >= 0 ? '+' : ''}${v} f`;
        const pct = (v - 1) * 100;
        return `×${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} <small>(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</small>`;
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
    private tuningPanel(): string {
        const s = this.state;
        const def = vehicleDef(s.vehicle);
        const t = effectiveTune(s, s.vehicle);
        const stock = this.cb.statsFor(s.vehicle, STOCK_TUNE);
        const now = this.cb.statsFor(s.vehicle, t);
        const knobs = TUNE_KNOBS.filter((k) => !(k.kartOnly && def.kind === 'bike'));
        const json = this.tuneJson();
        return `<details class="tuning" ${s.tunes[s.vehicle] ? 'open' : ''}>
          <summary>Tuning: ${def.name} <small>(small nudges on the stock numbers; applies when the race restarts)</small></summary>
          <table>${knobs
              .map((k) => {
                  const a = stock[k.key];
                  const b = now[k.key];
                  const fmt = (x: number) => (k.key === 'miniTurbo' ? `${x}f` : x.toPrecision(4));
                  return `<tr title="${k.help}"><td>${k.label}</td>
                    <td><input type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${t[k.key]}" data-tune="${k.key}"/> <output>${this.knobText(k.key)}</output></td>
                    <td><small>${a === b ? fmt(a) : `${fmt(a)} → <b>${fmt(b)}</b>`}</small></td></tr>`;
              })
              .join('')}</table>
          <div class="menu-row"><button class="pill" data-tune-reset>Reset ${def.name} to stock</button><button class="pill" data-tune-copy>Copy tuning</button>
          <small>Multipliers on the vehicle's numbers: bake them into public/data/vehicles/vehicles.json to make them the default.</small></div>
          ${json !== '{}' ? `<pre class="tune-json">${json}</pre>` : ''}
        </details>`;
    }
}
