/**
 * Extra HUD for the San Francisco course: a minimap of the lap (north up) with the kart and rivals,
 * a banner naming each stretch as you enter it ("GOLDEN GATE BRIDGE"), a lap progress bar, a
 * speedometer in mph (1 m = 60 units, 59.94 frames/s), the race position and the results board.
 */

import { DEV_TOOLS } from '../devMode';
import { chartData, type ChartData } from '../ui/chart';
import { el, kbd, setChildren } from '../ui/dom';

export interface SfHudMeta {
    centerline: { s: number; pos: [number, number, number] }[];
    segments: Record<string, [number, number]>;
    sectionTitles?: Record<string, string>;
    length: number;
    start?: { s: number };
}

export interface SfHudState {
    kart: { x: number; z: number; yawRad: number };
    /** Progress along the lap, 0..1, for the progress bar. */
    progress: number;
    speed: number;
    rivals?: { x: number; z: number; color: string }[];
    racing: boolean;
}

const MPH_PER_UF = (59.94 / 60) * 2.23694;

/** Section splits of several runs side by side (the vehicle comparison at the finish). */
export interface SplitColumn {
    name: string;
    color: string;
    /** Race frames per section key. */
    splits: Record<string, number>;
    total: number;
    /** This race's run (highlighted). */
    current?: boolean;
    /** E.g. "other tune". */
    note?: string;
}

export class SfHud {
    private readonly root: HTMLElement;
    private readonly map: HTMLCanvasElement;
    private readonly bg: HTMLCanvasElement;
    private readonly banner: HTMLElement;
    private readonly mph: HTMLElement;
    private readonly bar: HTMLElement;
    private readonly toProj: (x: number, z: number) => [number, number];
    private currentTitle = '';
    private readonly pos: HTMLElement;
    private readonly results: HTMLElement;
    private lastPos = 0;
    private shownBar = '';
    private shownMph = -1;
    private bannerTimer = 0;

    constructor(
        parent: HTMLElement,
        private readonly meta: SfHudMeta,
    ) {
        this.map = el('canvas', { class: 'sf-map', width: 440, height: 440 });
        this.banner = el('div', { class: 'sf-banner' });
        this.bar = el('div');
        this.mph = el('span', null, '0');
        this.pos = el('div', { class: 'sf-pos' });
        this.results = el('div', { class: 'sf-results card', role: 'dialog', 'aria-label': 'Results' });
        this.root = el(
            'div',
            { class: 'sf-hud' },
            this.map,
            this.banner,
            el('div', { class: 'sf-progress' }, this.bar),
            el('div', { class: 'sf-mph' }, this.mph, el('small', null, ' mph')),
            this.pos,
            this.results,
        );
        parent.appendChild(this.root);
        // Projection: fit the centerline into the canvas, north up (-z up).
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        for (const c of meta.centerline) {
            x0 = Math.min(x0, c.pos[0]);
            x1 = Math.max(x1, c.pos[0]);
            z0 = Math.min(z0, c.pos[2]);
            z1 = Math.max(z1, c.pos[2]);
        }
        const W = this.map.width;
        const pad = 30;
        const k = Math.min((W - 2 * pad) / (x1 - x0), (W - 2 * pad) / (z1 - z0));
        const ox = (W - (x1 - x0) * k) / 2;
        const oz = (W - (z1 - z0) * k) / 2;
        this.toProj = (x, z) => [ox + (x - x0) * k, oz + (z - z0) * k];
        this.bg = document.createElement('canvas');
        this.bg.width = this.bg.height = W;
        this.drawMap(null);
        void chartData().then((d) => d && this.drawMap(d));
    }

    /** The minimap's still layer: the land (once the chart is in), the lap and the start. */
    private drawMap(chart: ChartData | null): void {
        const meta = this.meta;
        const W = this.bg.width;
        const g = this.bg.getContext('2d')!;
        g.clearRect(0, 0, W, W);
        if (chart) {
            // Chart units are world / 60: the projection of (60 c).
            const o0 = this.toProj(0, 0);
            const o1 = this.toProj(60, 60);
            g.save();
            g.setTransform(o1[0] - o0[0], 0, 0, o1[1] - o0[1], o0[0], o0[1]);
            g.fillStyle = 'rgba(246, 246, 243, 0.72)';
            g.fill(new Path2D(chart.land));
            g.restore();
        }
        const path = () => {
            g.beginPath();
            meta.centerline.forEach((c, i) => {
                const [px, py] = this.toProj(c.pos[0], c.pos[2]);
                if (i) g.lineTo(px, py);
                else g.moveTo(px, py);
            });
            g.closePath();
        };
        // The lap in International Orange (the UI's --signature), as on the title's chart.
        g.lineJoin = g.lineCap = 'round';
        path();
        g.strokeStyle = '#f5f5f2';
        g.lineWidth = 15;
        g.stroke();
        path();
        g.strokeStyle = '#fe6a00';
        g.lineWidth = 8;
        g.stroke();
        // The start.
        const st = meta.centerline.reduce((a, c) => (Math.abs(c.s - (meta.start?.s ?? 0)) < Math.abs(a.s - (meta.start?.s ?? 0)) ? c : a));
        const [sx, sy] = this.toProj(st.pos[0], st.pos[2]);
        g.beginPath();
        g.arc(sx, sy, 9, 0, Math.PI * 2);
        g.fillStyle = '#121417';
        g.fill();
        g.lineWidth = 4;
        g.strokeStyle = '#f5f5f2';
        g.stroke();
    }

    /** Section title at spline S. */
    private titleAt(S: number): string {
        for (const [name, r] of Object.entries(this.meta.segments)) if (S >= r[0] && S < r[1]) return this.meta.sectionTitles?.[name] ?? '';
        return '';
    }

    /** Redraws the minimap and shows the section banner when the kart enters a new stretch. */
    update(st: SfHudState, S: number | null): void {
        if (S !== null && st.racing) {
            const t = this.titleAt(S);
            if (t && t !== this.currentTitle) {
                this.currentTitle = t;
                this.banner.textContent = t;
                this.banner.classList.remove('show');
                void this.banner.offsetWidth;
                this.banner.classList.add('show');
                clearTimeout(this.bannerTimer);
                this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 2640);
            }
        }
        const g = this.map.getContext('2d')!;
        g.clearRect(0, 0, this.map.width, this.map.height);
        g.drawImage(this.bg, 0, 0);
        for (const r of st.rivals ?? []) {
            const [px, py] = this.toProj(r.x, r.z);
            g.beginPath();
            g.arc(px, py, 9, 0, Math.PI * 2);
            g.fillStyle = r.color;
            g.fill();
            g.lineWidth = 3;
            g.strokeStyle = '#f5f5f2';
            g.stroke();
        }
        const [kx, ky] = this.toProj(st.kart.x, st.kart.z);
        g.save();
        g.translate(kx, ky);
        // yaw = atan2(dx, dz); on the map +x is right, +z is down.
        g.rotate(-st.kart.yawRad + Math.PI);
        g.beginPath();
        g.moveTo(0, -18);
        g.lineTo(12, 12);
        g.lineTo(0, 6);
        g.lineTo(-12, 12);
        g.closePath();
        g.fillStyle = '#121417';
        g.fill();
        g.lineWidth = 4;
        g.strokeStyle = '#f5f5f2';
        g.stroke();
        g.restore();
        // (Only when they change: unchanged writes still cost the page a layout pass every frame.)
        const bar = `${(Math.max(0, Math.min(1, st.progress)) * 100).toFixed(1)}%`;
        if (bar !== this.shownBar) this.bar.style.width = this.shownBar = bar;
        const mph = Math.round(Math.abs(st.speed) * MPH_PER_UF);
        if (mph !== this.shownMph) {
            this.shownMph = mph;
            this.mph.textContent = String(mph);
        }
    }

    /** Race position (1-based) out of `of`, or null to hide. */
    setPosition(p: number | null, of: number): void {
        if (p === null) {
            this.pos.style.display = 'none';
            return;
        }
        this.pos.style.display = '';
        if (p !== this.lastPos) {
            setChildren(this.pos, p, el('sup', null, ordinal(p)), el('small', null, `/${of}`));
            this.pos.className = `sf-pos p${Math.min(p, 4)}`;
            this.pos.classList.remove('bump');
            void this.pos.offsetWidth;
            this.pos.classList.add('bump');
            this.lastPos = p;
        }
    }

    /** The results card at the finish: your place and time, the standings, and what the keys do. */
    /** `extra`: shown under the places (the online leaderboard's line). */
    showResults(rows: { name: string; color: string; frames: number; you?: boolean }[], fmt: (f: number) => string, compare: SplitColumn[] = [], extra?: HTMLElement): void {
        const sorted = [...rows].sort((a, b) => a.frames - b.frames);
        const place = sorted.findIndex((r) => r.you) + 1;
        const you = sorted[place - 1];
        // (The vehicle comparison's section splits: dev tools only.)
        const table = DEV_TOOLS ? this.splitTable(compare) : null;
        setChildren(
            this.results,
            el('div', { class: 'label' }, 'Finish'),
            place ? el('h2', null, place, el('sup', null, ordinal(place)), el('small', null, ` / ${sorted.length}`)) : null,
            you ? el('div', { class: 'sf-res-time' }, fmt(you.frames)) : null,
            el(
                'ol',
                { class: 'board' },
                ...sorted.map((r, i) =>
                    el(
                        'li',
                        { class: `row${r.you ? ' you' : ''}`, style: { animationDelay: `${120 + i * 60}ms` } },
                        el('span', { class: 'place' }, i + 1),
                        el('span', { class: 'name' }, r.name),
                        el('span', { class: 'time' }, fmt(r.frames)),
                    ),
                ),
            ),
            extra ?? null,
            table,
            el(
                'div',
                { class: 'card-foot sf-res-keys' },
                el('span', null, kbd('Enter'), ' Race again'),
                el('span', null, kbd('C'), ' Next ride'),
                el('span', null, kbd('Esc'), ' Menu'),
            ),
        );
        this.results.classList.add('show');
    }

    /**
     * Seconds per section for each run: the fastest in each row is marked (teal), and this run's
     * time where it's slower than that (red).
     */
    private splitTable(cols: SplitColumn[]): HTMLTableElement | null {
        if (cols.length < 2) return null;
        const secs = Object.entries(this.meta.segments).sort((a, b) => a[1][0] - b[1][0]).map(([k]) => k);
        // Stretches driven twice (the bridge both ways) get numbered.
        const seen = new Map<string, number>();
        const titles = secs.map((k) => {
            const t = this.meta.sectionTitles?.[k] ?? k;
            const n = (seen.get(t) ?? 0) + 1;
            seen.set(t, n);
            return n > 1 ? `${t} (${n})` : t;
        });
        const sec = (f: number | undefined) => (f === undefined ? '—' : (f / 59.94).toFixed(2));
        const row = (label: string, vals: (number | undefined)[]) => {
            const known = vals.filter((v): v is number => v !== undefined);
            const best = known.length ? Math.min(...known) : -1;
            return el(
                'tr',
                null,
                el('td', null, label),
                ...vals.map((v, i) => {
                    const mark = known.length < 2 || v === undefined ? '' : v === best ? 'best' : cols[i]!.current ? 'slower' : '';
                    return el('td', { class: mark }, sec(v));
                }),
            );
        };
        return el(
            'table',
            { class: 'sf-splits' },
            el(
                'tr',
                null,
                el('th'),
                ...cols.map((c) => el('th', { class: c.current ? 'cur' : '' }, el('i', { style: { background: c.color } }), c.name, c.note ? el('small', null, c.note) : null)),
            ),
            ...secs.map((k, i) => row(titles[i]!, cols.map((c) => c.splits[k]))),
            row('Total', cols.map((c) => c.total)),
        );
    }

    resetSection(): void {
        this.currentTitle = '';
        this.lastPos = 0;
        this.results.classList.remove('show');
        this.results.replaceChildren();
    }

    dispose(): void {
        this.root.remove();
    }
}

/** "st", "nd", "rd", "th". */
function ordinal(p: number): string {
    return p % 100 >= 11 && p % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][p % 10] ?? 'th');
}
