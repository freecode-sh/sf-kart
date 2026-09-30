/**
 * Dev tuning panel (dev tools only, see devMode.ts; `K` in race): the current vehicle's stat
 * adjustments as sliders that change the running race immediately (no restart), plus quick vehicle
 * switching. Values persist like the menu's Tuning panel; *Copy* gives them as multipliers on the
 * vehicle's data (public/data/vehicles/vehicles.json), to bake in there.
 */

import { STOCK_TUNE, TUNE_KNOBS, type StatSummary, type TuneKey, type VehicleTune } from './tuning';
import { VEHICLES, vehicleDef, type VehicleId } from './vehicles';

export interface DevTuningHost {
    vehicle(): VehicleId;
    /** The vehicle's effective tune (adjustments on top of its data). */
    tune(id: VehicleId): VehicleTune;
    statsFor(id: VehicleId, tune: VehicleTune): StatSummary;
    /** Stores the adjustment for `id` (undefined: back to its data) and applies it live. */
    setTune(id: VehicleId, tune: Partial<VehicleTune> | undefined): void;
    /** Switches vehicle (restarts the race). */
    switchVehicle(id: VehicleId): void;
    /** Every vehicle's adjustments that differ from stock, as JSON. */
    tuneJson(): string;
}

export class DevTuning {
    private readonly el: HTMLElement;
    private open = false;

    constructor(private readonly host: DevTuningHost) {
        this.el = document.createElement('div');
        this.el.className = 'dev-tuning';
        document.body.appendChild(this.el);
    }

    toggle(): void {
        this.open = !this.open;
        this.el.classList.toggle('open', this.open);
        if (this.open) {
            if (document.pointerLockElement) document.exitPointerLock();
            this.render();
        }
    }

    /** Re-render (after a vehicle switch). */
    refresh(): void {
        if (this.open) this.render();
    }

    private fmtStat(key: TuneKey, x: number): string {
        if (key === 'miniTurbo') return `${x}f`;
        if (key === 'driftAngle') return `${x.toFixed(1)}°`;
        if (key === 'turnDrag') return `-${x.toFixed(2)}%`;
        return x.toPrecision(4);
    }

    private knobText(key: TuneKey, v: number): string {
        if (key === 'miniTurbo') return `${v >= 0 ? '+' : ''}${v}f`;
        const pct = (v - 1) * 100;
        return `×${v.toFixed(3)} <small>${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</small>`;
    }

    private render(): void {
        const id = this.host.vehicle();
        const def = vehicleDef(id);
        const t = this.host.tune(id);
        const stock = this.host.statsFor(id, STOCK_TUNE);
        const now = this.host.statsFor(id, t);
        const knobs = TUNE_KNOBS.filter((k) => !(k.kartOnly && def.kind === 'bike'));
        this.el.innerHTML = `
          <div class="dt-head"><b>Dev tuning</b> <small>live · <kbd>K</kbd> closes</small></div>
          <div class="dt-vehicles">${VEHICLES.map((v) => `<button class="${v.id === id ? 'sel' : ''}" data-v="${v.id}">${v.short}</button>`).join('')}</div>
          <div class="dt-note">Switching vehicle restarts; the sliders apply instantly.</div>
          <table>${knobs
              .map((k) => {
                  const a = stock[k.key];
                  const b = now[k.key];
                  return `<tr title="${k.help}">
                    <td>${k.label}</td>
                    <td><input type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${t[k.key]}" data-k="${k.key}"/></td>
                    <td class="dt-val" data-val="${k.key}">${this.knobText(k.key, t[k.key])}</td>
                    <td class="dt-stat" data-stat="${k.key}">${a === b ? this.fmtStat(k.key, b) : `${this.fmtStat(k.key, a)} → <b>${this.fmtStat(k.key, b)}</b>`}</td>
                  </tr>`;
              })
              .join('')}</table>
          <div class="dt-actions"><button data-reset>Reset ${def.short} to defaults</button><button data-stock>All stock</button><button data-copy>Copy</button></div>
          <pre class="dt-json">${this.host.tuneJson()}</pre>`;

        this.el.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
            b.addEventListener('click', () => {
                this.host.switchVehicle(b.dataset.v as VehicleId);
                b.blur();
            }),
        );
        this.el.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) => {
            const key = inp.dataset.k as TuneKey;
            inp.addEventListener('input', () => {
                const cur = this.host.tune(id);
                this.host.setTune(id, { ...cur, [key]: Number(inp.value) });
                this.update(id);
            });
            // Hand the keyboard back to the game (arrow keys would move a focused slider).
            inp.addEventListener('change', () => inp.blur());
            inp.addEventListener('pointerup', () => inp.blur());
        });
        this.el.querySelector('[data-reset]')!.addEventListener('click', () => {
            this.host.setTune(id, undefined);
            this.render();
        });
        this.el.querySelector('[data-stock]')!.addEventListener('click', () => {
            this.host.setTune(id, { ...STOCK_TUNE });
            this.render();
        });
        this.el.querySelector('[data-copy]')!.addEventListener('click', (e) => {
            void navigator.clipboard?.writeText(this.host.tuneJson());
            (e.currentTarget as HTMLButtonElement).textContent = 'Copied';
        });
    }

    /** Updates the numbers after a slider moved (without rebuilding the sliders). */
    private update(id: VehicleId): void {
        const t = this.host.tune(id);
        const stock = this.host.statsFor(id, STOCK_TUNE);
        const now = this.host.statsFor(id, t);
        for (const k of TUNE_KNOBS) {
            const v = this.el.querySelector(`[data-val="${k.key}"]`);
            if (v) v.innerHTML = this.knobText(k.key, t[k.key]);
            const s = this.el.querySelector(`[data-stat="${k.key}"]`);
            const a = stock[k.key];
            const b = now[k.key];
            if (s) s.innerHTML = a === b ? this.fmtStat(k.key, b) : `${this.fmtStat(k.key, a)} → <b>${this.fmtStat(k.key, b)}</b>`;
        }
        const json = this.el.querySelector('.dt-json');
        if (json) json.textContent = this.host.tuneJson();
    }
}
