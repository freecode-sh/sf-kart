/**
 * Dev tuning panel (dev tools only, see devMode.ts; `K` in race): the current vehicle's stat
 * adjustments as sliders that change the running race immediately (no restart), plus quick vehicle
 * switching. Values persist like the menu's Tuning panel; *Copy* gives them as multipliers on the
 * vehicle's data (public/data/vehicles/vehicles.json), to bake in there.
 */

import { STOCK_TUNE, TUNE_KNOBS, type StatSummary, type TuneKey, type VehicleTune } from './tuning';
import { VEHICLES, vehicleDef, type VehicleId } from './vehicles';
import { button, el, kbd, setChildren, type Child } from './ui/dom';

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

    private knobText(key: TuneKey, v: number): Child[] {
        if (key === 'miniTurbo') return [`${v >= 0 ? '+' : ''}${v}f`];
        const pct = (v - 1) * 100;
        return [`×${v.toFixed(3)} `, el('small', null, `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`)];
    }

    /** Stock → now for a stat (just the value when unchanged). */
    private statText(key: TuneKey, a: number, b: number): Child[] {
        return a === b ? [this.fmtStat(key, b)] : [`${this.fmtStat(key, a)} → `, el('b', null, this.fmtStat(key, b))];
    }

    private render(): void {
        const id = this.host.vehicle();
        const def = vehicleDef(id);
        const t = this.host.tune(id);
        const stock = this.host.statsFor(id, STOCK_TUNE);
        const now = this.host.statsFor(id, t);
        const knobs = TUNE_KNOBS.filter((k) => !(k.kartOnly && def.kind === 'bike'));
        const knobRow = (k: (typeof TUNE_KNOBS)[number]) => {
            const input = el('input', {
                type: 'range',
                min: k.min,
                max: k.max,
                step: k.step,
                value: t[k.key],
                on: {
                    input: () => {
                        const cur = this.host.tune(id);
                        this.host.setTune(id, { ...cur, [k.key]: Number(input.value) });
                        this.update(id);
                    },
                    // Hand the keyboard back to the game (arrow keys would move a focused slider).
                    change: () => input.blur(),
                    pointerup: () => input.blur(),
                },
            });
            return el(
                'tr',
                { title: k.help },
                el('td', null, k.label),
                el('td', null, input),
                el('td', { class: 'dt-val', data: { val: k.key } }, ...this.knobText(k.key, t[k.key])),
                el('td', { class: 'dt-stat', data: { stat: k.key } }, ...this.statText(k.key, stock[k.key], now[k.key])),
            );
        };
        const copy = button(
            {
                on: {
                    click: () => {
                        void navigator.clipboard?.writeText(this.host.tuneJson());
                        copy.textContent = 'Copied';
                    },
                },
            },
            'Copy',
        );
        setChildren(
            this.el,
            el('div', { class: 'dt-head' }, el('b', null, 'Dev tuning'), ' ', el('small', null, 'live · ', kbd('K'), ' closes')),
            el(
                'div',
                { class: 'dt-vehicles' },
                ...VEHICLES.map((v) => {
                    const b = button(
                        {
                            class: v.id === id ? 'sel' : '',
                            on: {
                                click: () => {
                                    this.host.switchVehicle(v.id);
                                    b.blur();
                                },
                            },
                        },
                        v.short,
                    );
                    return b;
                }),
            ),
            el('div', { class: 'dt-note' }, 'Switching vehicle restarts; the sliders apply instantly.'),
            el('table', null, ...knobs.map(knobRow)),
            el(
                'div',
                { class: 'dt-actions' },
                button(
                    {
                        on: {
                            click: () => {
                                this.host.setTune(id, undefined);
                                this.render();
                            },
                        },
                    },
                    `Reset ${def.short} to defaults`,
                ),
                button(
                    {
                        on: {
                            click: () => {
                                this.host.setTune(id, { ...STOCK_TUNE });
                                this.render();
                            },
                        },
                    },
                    'All stock',
                ),
                copy,
            ),
            el('pre', { class: 'dt-json' }, this.host.tuneJson()),
        );
    }

    /** Updates the numbers after a slider moved (without rebuilding the sliders). */
    private update(id: VehicleId): void {
        const t = this.host.tune(id);
        const stock = this.host.statsFor(id, STOCK_TUNE);
        const now = this.host.statsFor(id, t);
        for (const k of TUNE_KNOBS) {
            const v = this.el.querySelector(`[data-val="${k.key}"]`);
            if (v) setChildren(v, ...this.knobText(k.key, t[k.key]));
            const s = this.el.querySelector(`[data-stat="${k.key}"]`);
            if (s) setChildren(s, ...this.statText(k.key, stock[k.key], now[k.key]));
        }
        const json = this.el.querySelector('.dt-json');
        if (json) json.textContent = this.host.tuneJson();
    }
}
