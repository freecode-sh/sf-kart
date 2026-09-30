/**
 * The way into a race: one fog card on the left, over the live city. The title (the chart of the lap
 * and the name; the lap draws itself as the city downloads), your ride (the scene shows it; main.ts
 * turns the camera around it), the controls, then the times to beat and Race!, which waits for San
 * Francisco to finish loading.
 *
 * Title → Vehicle → Controls → Welcome → race. Enter goes on, Esc goes back. Only choices leave
 * here (`onVehicle`, `onScheme`, `onRace`); main.ts starts the race.
 */

import { SCHEMES, type SchemeId } from '../input';
import { Showroom } from '../sf/showroom';
import type { StatSummary } from '../tuning';
import { PICKER_ORDER, vehicleDef, type VehicleId } from '../vehicles';
import { Chart } from './chart';
import { button, el, kbd, setChildren, type Child } from './dom';
import { freecodeLockup, wordmark } from './identity';
import { launchPost } from './launchPost';
import { Leaderboard, type BoardEntry } from './leaderboard';

export type Screen = 'title' | 'vehicle' | 'controls' | 'welcome';

const ORDER: Screen[] = ['title', 'vehicle', 'controls', 'welcome'];

/** How the loading goes: 0..1, a line to show, and whether the race can start. */
export interface LoadState {
    fraction: number;
    status: string;
    ready: boolean;
}

export interface OnboardingCallbacks {
    /** The picked vehicle changed (the scene shows it). */
    onVehicle(id: VehicleId): void;
    onScheme(id: SchemeId): void;
    /** The screen changed (main.ts moves the camera). */
    onScreen(screen: Screen | null): void;
    /** Start the race with these. */
    onRace(choice: { vehicle: VehicleId; scheme: SchemeId }): void;
    loadState(): LoadState;
}

/** What the vehicle screen needs once the game's data is in: the stats. */
export interface VehicleFacts {
    statsFor(id: VehicleId): StatSummary;
}

/** The ride's stat bars, each relative to the three vehicles. */
const STAT_BARS: { key: keyof StatSummary; label: string }[] = [
    { key: 'speed', label: 'Top speed' },
    { key: 'accel', label: 'Acceleration' },
    { key: 'handling', label: 'Handling' },
];

export class Onboarding {
    private readonly root: HTMLElement;
    private readonly card: HTMLElement;
    private screen: Screen | null = null;
    private facts: VehicleFacts | null = null;
    private readonly board: Leaderboard;
    private boardEntries: BoardEntry[] = [];
    /** The ride picker's stage (sf/showroom.ts): made the first time it shows, kept across picks. */
    private stage: { el: HTMLElement; showroom: Showroom } | null = null;
    /** The launch post (X), on the title only; made once. */
    private readonly post = launchPost();
    /** The title's chart: the lap draws itself as the city downloads. */
    private readonly chart = new Chart([0.05, 0.055, 0.9, 0.77]);
    /** The button that waits for the load (the title's, then Race!). */
    private goBtn: HTMLButtonElement | null = null;
    private goLabel = '';
    private raf = 0;

    constructor(
        private vehicle: VehicleId,
        private scheme: SchemeId,
        private readonly cb: OnboardingCallbacks,
    ) {
        this.board = new Leaderboard([]);
        this.card = el('section', { class: 'card' });
        this.root = el('div', { class: 'onboard' }, el('div', { class: 'fog-bank' }), el('div', { class: 'veil' }), this.card, this.post, freecodeLockup());
        document.body.appendChild(this.root);
        document.body.classList.add('onboarding');
        window.addEventListener('keydown', this.onKey);
        this.show('title');
        this.tick();
    }

    isOpen(): boolean {
        return this.screen !== null;
    }

    current(): Screen | null {
        return this.screen;
    }

    /** The game's data is in: the title can go on, the vehicle screen gets its stats. */
    setFacts(facts: VehicleFacts): void {
        this.facts = facts;
        if (this.screen === 'title' || this.screen === 'vehicle') this.show(this.screen);
    }

    setBoard(entries: BoardEntry[]): void {
        this.boardEntries = entries;
        this.board.update(entries, this.vehicle);
    }

    /** Leaves (the race starts, or a dev hook takes over). */
    close(): void {
        if (!this.screen) return;
        this.screen = null;
        this.root.remove();
        document.body.classList.remove('onboarding');
        window.removeEventListener('keydown', this.onKey);
        cancelAnimationFrame(this.raf);
        this.stage?.showroom.dispose();
        this.stage = null;
        this.cb.onScreen(null);
    }

    private show(screen: Screen): void {
        const changed = screen !== this.screen;
        this.screen = screen;
        this.goBtn = null;
        const body = screen === 'title' ? this.title() : screen === 'vehicle' ? this.vehiclePicker() : screen === 'controls' ? this.controls() : this.welcome();
        setChildren(this.card, ...body);
        this.card.className = `card ${screen}`;
        this.post?.toggleAttribute('hidden', screen !== 'title');
        if (screen === 'vehicle') this.stage?.showroom.start();
        else this.stage?.showroom.stop();
        this.root.dataset.screen = screen;
        if (changed) this.cb.onScreen(screen);
        this.tick();
    }

    private next(): void {
        if (this.screen === 'title' && !this.facts) return;
        if (this.screen === 'welcome') {
            if (!this.cb.loadState().ready) return;
            const choice = { vehicle: this.vehicle, scheme: this.scheme };
            this.close();
            this.cb.onRace(choice);
            return;
        }
        this.show(ORDER[ORDER.indexOf(this.screen!) + 1]!);
    }

    private back(): void {
        const i = ORDER.indexOf(this.screen!);
        if (i > 0) this.show(ORDER[i - 1]!);
    }

    private readonly onKey = (e: KeyboardEvent): void => {
        if (!this.screen || e.repeat) return;
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            this.next();
        } else if (e.code === 'Escape') {
            e.preventDefault();
            this.back();
        } else if (this.screen === 'title' && e.code === 'Space') {
            e.preventDefault();
            this.next();
        } else if (this.screen === 'vehicle' || this.screen === 'controls') {
            const list: readonly string[] = this.screen === 'vehicle' ? PICKER_ORDER : Object.keys(SCHEMES);
            const i = list.indexOf(this.screen === 'vehicle' ? this.vehicle : this.scheme);
            const up = e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'KeyW' || e.code === 'KeyA';
            const down = e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS' || e.code === 'KeyD';
            const digit = /^Digit([1-3])$/.exec(e.code);
            const to = up ? list[(i + list.length - 1) % list.length] : down ? list[(i + 1) % list.length] : digit ? list[Number(digit[1]) - 1] : undefined;
            if (!to) return;
            e.preventDefault();
            if (this.screen === 'vehicle') this.pickVehicle(to as VehicleId);
            else this.pickScheme(to as SchemeId);
        }
    };

    private pickVehicle(id: VehicleId): void {
        if (id === this.vehicle) return;
        this.vehicle = id;
        this.stage?.showroom.select(id);
        this.cb.onVehicle(id);
        this.show('vehicle');
    }

    private pickScheme(id: SchemeId): void {
        if (id === this.scheme) return;
        this.scheme = id;
        this.cb.onScheme(id);
        this.show('controls');
    }

    /** The lap and the waiting button follow the load (every frame while open). */
    private tick = (): void => {
        cancelAnimationFrame(this.raf);
        if (!this.screen) return;
        const st = this.cb.loadState();
        this.chart.progress(st.ready ? 1 : st.fraction);
        if (this.goBtn) {
            const waiting = this.screen === 'title' ? !this.facts : !st.ready;
            this.goBtn.disabled = waiting;
            const label = waiting ? `Loading ${Math.floor(st.fraction * 100)}%` : this.goLabel;
            const text = this.goBtn.firstChild;
            if (text && text.textContent !== label) text.textContent = label;
            this.goBtn.lastElementChild?.toggleAttribute('hidden', waiting);
        }
        this.root.classList.toggle('ready', st.ready);
        this.raf = requestAnimationFrame(this.tick);
    };

    // ---- Screens ----

    /** The one button that goes on (Enter), waiting for the load where it must. */
    private go(label: string, waits: boolean): HTMLButtonElement {
        const b = button({ class: 'go', on: { click: () => this.next() } }, label, kbd('Enter'));
        if (waits) {
            this.goBtn = b;
            this.goLabel = label;
        }
        return b;
    }

    /** Back (Esc) and the button that goes on. */
    private foot(label: string, waits = false): HTMLElement {
        return el('div', { class: 'card-foot' }, button({ class: 'back', on: { click: () => this.back() } }, 'Back', kbd('Esc')), this.go(label, waits));
    }

    private title(): Child[] {
        return [this.chart.el, el('div', { class: 'bay', role: 'heading', 'aria-level': 1 }, wordmark('big', true)), el('div', { class: 'card-foot' }, this.go('Race', true))];
    }

    /** The 16:9 stage: the three rides, the chosen one in the middle; arrows (or a click on a side one) go round. */
    private stageEl(): HTMLElement {
        if (this.stage) return this.stage.el;
        const canvas = el('canvas', { class: 'stage-view', 'aria-hidden': 'true' });
        const step = (d: number) => {
            const i = PICKER_ORDER.indexOf(this.vehicle);
            this.pickVehicle(PICKER_ORDER[(i + d + PICKER_ORDER.length) % PICKER_ORDER.length]!);
        };
        const stage = el(
            'div',
            { class: 'stage' },
            canvas,
            button({ class: 'stage-arrow prev', 'aria-label': 'Previous ride', on: { click: () => step(-1) } }),
            button({ class: 'stage-arrow next', 'aria-label': 'Next ride', on: { click: () => step(1) } }),
        );
        const showroom = new Showroom(canvas, this.vehicle);
        canvas.addEventListener('click', (e) => {
            const side = showroom.sideAt(e.clientX);
            if (side) step(side);
            else this.next();
        });
        this.stage = { el: stage, showroom };
        return stage;
    }

    private vehiclePicker(): Child[] {
        const f = this.facts;
        const stats = f ? PICKER_ORDER.map((id) => f.statsFor(id)) : null;
        const at = PICKER_ORDER.indexOf(this.vehicle);
        const bar = (key: keyof StatSummary) => {
            if (!stats) return el('span', { class: 'bar' });
            const vals = stats.map((s) => s[key]);
            const lo = Math.min(...vals);
            const hi = Math.max(...vals);
            const x = hi > lo ? (stats[at]![key] - lo) / (hi - lo) : 0.5;
            return el('span', { class: 'bar' }, el('i', { style: { width: `${(30 + 70 * x).toFixed(0)}%` } }));
        };
        return [
            el('div', { class: 'ride-head' }, wordmark('small'), el('div', { class: 'label' }, 'Choose your ride')),
            this.stageEl(),
            el(
                'div',
                { class: 'ride-info' },
                el('h2', { 'aria-live': 'polite' }, vehicleDef(this.vehicle).name),
                el('div', { class: 'stats' }, ...STAT_BARS.flatMap((s) => [el('span', null, s.label), bar(s.key)])),
                this.foot('Continue'),
            ),
        ];
    }

    private controls(): Child[] {
        const sc = SCHEMES[this.scheme];
        return [
            wordmark('small'),
            el('div', { class: 'label' }, 'Controls'),
            el('h2', null, sc.name),
            el(
                'div',
                { class: 'segments', role: 'radiogroup' },
                ...Object.values(SCHEMES).map((s) =>
                    button({ class: s.id === this.scheme ? 'sel' : '', role: 'radio', 'aria-checked': s.id === this.scheme, on: { click: () => this.pickScheme(s.id) } }, s.short),
                ),
            ),
            el('dl', { class: 'keys' }, ...sc.quick.flatMap(([keys, what]) => [el('dt', null, ...keys.split(' ').map((k) => kbd(k))), el('dd', null, what)])),
            this.foot('Continue'),
        ];
    }

    private welcome(): Child[] {
        this.board.update(this.boardEntries, this.vehicle);
        return [wordmark('small'), el('h2', null, 'Golden Gate'), this.board.el, this.foot('Race!', true)];
    }
}
