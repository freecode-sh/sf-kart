/**
 * Extra HUD for the San Francisco course: a minimap of the lap (north up) with the kart and rivals,
 * a banner naming each stretch as you enter it ("GOLDEN GATE BRIDGE"), a lap progress bar, a
 * speedometer in mph (1 m = 60 units, 59.94 frames/s), the race position and the results board.
 */

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
        this.root = document.createElement('div');
        this.root.className = 'sf-hud';
        this.root.innerHTML = `
          <canvas class="sf-map" width="440" height="440"></canvas>
          <div class="sf-banner"></div>
          <div class="sf-progress"><div></div></div>
          <div class="sf-mph">0<small> mph</small></div>
          <div class="sf-pos"></div>
          <div class="sf-results"></div>`;
        parent.appendChild(this.root);
        this.map = this.root.querySelector('.sf-map') as HTMLCanvasElement;
        this.banner = this.root.querySelector('.sf-banner') as HTMLElement;
        this.mph = this.root.querySelector('.sf-mph') as HTMLElement;
        this.bar = this.root.querySelector('.sf-progress > div') as HTMLElement;
        this.pos = this.root.querySelector('.sf-pos') as HTMLElement;
        this.results = this.root.querySelector('.sf-results') as HTMLElement;
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
        const g = this.bg.getContext('2d')!;
        const path = () => {
            g.beginPath();
            meta.centerline.forEach((c, i) => {
                const [px, py] = this.toProj(c.pos[0], c.pos[2]);
                if (i) g.lineTo(px, py);
                else g.moveTo(px, py);
            });
            g.closePath();
        };
        g.lineJoin = g.lineCap = 'round';
        path();
        g.strokeStyle = 'rgba(0,0,0,0.55)';
        g.lineWidth = 16;
        g.stroke();
        path();
        g.strokeStyle = '#f4f1ea';
        g.lineWidth = 9;
        g.stroke();
        // The bridge in International Orange.
        for (const name of ['bridge_nb', 'bridge_sb']) {
            const r = meta.segments[name];
            if (!r) continue;
            g.beginPath();
            let first = true;
            for (const c of meta.centerline) {
                if (c.s < r[0] || c.s > r[1]) continue;
                const [px, py] = this.toProj(c.pos[0], c.pos[2]);
                if (first) g.moveTo(px, py);
                else g.lineTo(px, py);
                first = false;
            }
            g.strokeStyle = '#e8492e';
            g.lineWidth = 9;
            g.stroke();
        }
        // Start line.
        const st = meta.centerline.reduce((a, c) => (Math.abs(c.s - (meta.start?.s ?? 0)) < Math.abs(a.s - (meta.start?.s ?? 0)) ? c : a));
        const [sx, sy] = this.toProj(st.pos[0], st.pos[2]);
        g.fillStyle = '#111';
        g.fillRect(sx - 9, sy - 9, 18, 18);
        g.fillStyle = '#fff';
        g.fillRect(sx - 9, sy - 9, 9, 9);
        g.fillRect(sx, sy, 9, 9);
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
                this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 2600);
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
            g.strokeStyle = '#fff';
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
        g.fillStyle = '#ffcc00';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = '#1b1b1b';
        g.stroke();
        g.restore();
        // (Only when they change: unchanged writes still cost the page a layout pass every frame.)
        const bar = `${(Math.max(0, Math.min(1, st.progress)) * 100).toFixed(1)}%`;
        if (bar !== this.shownBar) this.bar.style.width = this.shownBar = bar;
        const mph = Math.round(Math.abs(st.speed) * MPH_PER_UF);
        if (mph !== this.shownMph) {
            this.shownMph = mph;
            this.mph.innerHTML = `${mph}<small> mph</small>`;
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
            const suf = p === 1 ? 'st' : p === 2 ? 'nd' : p === 3 ? 'rd' : 'th';
            this.pos.innerHTML = `${p}<sup>${suf}</sup><small>/${of}</small>`;
            this.pos.className = `sf-pos p${Math.min(p, 4)}`;
            this.pos.classList.remove('bump');
            void this.pos.offsetWidth;
            this.pos.classList.add('bump');
            this.lastPos = p;
        }
    }

    /** Results board at the finish: rows sorted by time (frames), the player's highlighted. */
    /** `extra`: shown under the places (the leaderboard's line). */
    showResults(rows: { name: string; color: string; frames: number; you?: boolean }[], fmt: (f: number) => string, compare: SplitColumn[] = [], extra?: HTMLElement): void {
        const sorted = [...rows].sort((a, b) => a.frames - b.frames);
        const table = this.splitTable(compare);
        this.results.classList.toggle('wide', !!table);
        this.results.innerHTML =
            `<div class="sf-res-main"><div class="sf-res-title">RESULTS</div>` +
            sorted
                .map(
                    (r, i) =>
                        `<div class="sf-res-row${r.you ? ' you' : ''}" style="animation-delay:${0.15 + i * 0.12}s"><b>${i + 1}</b><i style="background:${r.color}"></i><span>${r.name}</span><em>${fmt(r.frames)}</em></div>`,
                )
                .join('') +
            `</div>` +
            (table ? `<div class="sf-res-cmp"><div class="sf-res-sub">VEHICLES · SECTION SPLITS (s)</div>${table}</div>` : '') +
            `<div class="sf-res-hint"><kbd>Enter</kbd> race again · <kbd>C</kbd> next vehicle · <kbd>Esc</kbd> menu</div>`;
        if (extra) this.results.querySelector('.sf-res-main')!.append(extra);
        this.results.classList.add('show');
    }

    /** Seconds per section for each run; the fastest in each row is marked. */
    private splitTable(cols: SplitColumn[]): string {
        if (cols.length < 2) return '';
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
            return `<tr><td>${label}</td>${vals.map((v) => `<td class="${v === best && known.length > 1 ? 'best' : ''}">${sec(v)}</td>`).join('')}</tr>`;
        };
        return (
            `<table class="sf-splits"><tr><th></th>${cols.map((c) => `<th class="${c.current ? 'cur' : ''}"><i style="background:${c.color}"></i>${c.name}${c.note ? `<small>${c.note}</small>` : ''}</th>`).join('')}</tr>` +
            secs.map((k, i) => row(titles[i]!, cols.map((c) => c.splits[k]))).join('') +
            row('Total', cols.map((c) => c.total)) +
            `</table>`
        );
    }

    resetSection(): void {
        this.currentTitle = '';
        this.lastPos = 0;
        this.results.classList.remove('show');
        this.results.innerHTML = '';
    }

    dispose(): void {
        this.root.remove();
    }
}
