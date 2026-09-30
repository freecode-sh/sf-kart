/**
 * The course chart: the real lap in International Orange over the land, coast and streets around it
 * (baked by tools/sf/bakeChart.ts into courses/<id>/chart.json). The title card is this chart, and
 * while the city downloads the lap draws itself as the progress bar.
 *
 * Chart units are metres, x east, y south (world x, z over 60), so the lap fits anywhere with a
 * viewBox. Strokes are set in screen pixels, so every size of the chart reads the same.
 */

import { loadDataJson } from '../data';

export interface ChartData {
    frame: [number, number, number, number];
    route: string;
    start: [number, number];
    /** The lap simplified hard, in a 100 x 100 box: the logo's symbol. */
    mark: string;
    land: string;
    coast: string;
    streets: { major: string; minor: string };
}

const NS = 'http://www.w3.org/2000/svg';
let data: Promise<ChartData | null> | null = null;

/** The chart data (loaded once; null if it's missing). */
export function chartData(course = 'golden_gate'): Promise<ChartData | null> {
    return (data ??= loadDataJson<ChartData>(`courses/${course}/chart.json`).catch(() => null));
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
}

/** The lap's extent in chart units (the frame, less the bake's padding). */
function lapBox(d: ChartData): [number, number, number, number] {
    const PAD = 700;
    return [d.frame[0] + PAD, d.frame[1] + PAD, d.frame[2] - PAD, d.frame[3] - PAD];
}

/**
 * A chart filling its element. `fit` places the lap within the element, as fractions of its box
 * [left, top, width, height] (the rest of the map fills the margin). `progress` draws that much of
 * the lap (0..1).
 */
export class Chart {
    readonly el: HTMLDivElement;
    private route: SVGPathElement | null = null;
    private length = 0;
    private shown = -1;

    constructor(private readonly fit: [number, number, number, number] = [0.06, 0.06, 0.88, 0.88]) {
        this.el = document.createElement('div');
        this.el.className = 'chart';
        void chartData().then((d) => {
            if (d) requestAnimationFrame(() => this.draw(d));
        });
    }

    private draw(d: ChartData): void {
        const W = this.el.clientWidth || 424;
        const H = this.el.clientHeight || 624;
        const [x0, y0, x1, y1] = lapBox(d);
        const [fl, ft, fw, fh] = this.fit;
        const s = Math.min((fw * W) / (x1 - x0), (fh * H) / (y1 - y0));
        const ox = x0 - (fl * W + (fw * W - (x1 - x0) * s) / 2) / s;
        const oy = y0 - (ft * H + (fh * H - (y1 - y0) * s) / 2) / s;
        const px = (n: number) => n / s;
        const svg = svgEl('svg', { viewBox: `${ox} ${oy} ${W / s} ${H / s}`, 'aria-hidden': 'true' });
        const path = (dd: string, attrs: Record<string, string | number>) => svg.appendChild(svgEl('path', { d: dd, ...attrs }));
        const line = { fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
        path(d.land, { class: 'chart-land' });
        path(d.streets.minor, { ...line, class: 'chart-street', 'stroke-width': px(0.8) });
        path(d.streets.major, { ...line, class: 'chart-street major', 'stroke-width': px(1.2) });
        path(d.coast, { ...line, class: 'chart-coast', 'stroke-width': px(1) });
        path(d.route, { ...line, class: 'chart-casing', 'stroke-width': px(6.6) });
        this.route = path(d.route, { ...line, class: 'chart-route', 'stroke-width': px(3.6) });
        svg.appendChild(svgEl('circle', { class: 'chart-start', cx: d.start[0], cy: d.start[1], r: px(6), 'stroke-width': px(2) }));
        this.length = this.route.getTotalLength();
        this.route.setAttribute('stroke-dasharray', `${this.length} ${this.length}`);
        this.el.replaceChildren(svg);
        const p = this.shown;
        this.shown = -1;
        this.progress(p < 0 ? 1 : p);
    }

    /** Draws `f` (0..1) of the lap. */
    progress(f: number): void {
        const v = Math.max(0, Math.min(1, f));
        if (Math.abs(v - this.shown) < 0.002) return;
        this.shown = v;
        this.route?.setAttribute('stroke-dashoffset', String(this.length * (1 - v)));
    }
}

/** The logo's symbol: the lap, as a small inline SVG. */
export function lapMark(size: number): SVGSVGElement {
    const svg = svgEl('svg', { class: 'lap-mark', viewBox: '-8 -8 116 116', width: size, height: size, 'aria-hidden': 'true' });
    const p = svgEl('path', { fill: 'none', 'stroke-width': size > 48 ? 7 : 9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    svg.appendChild(p);
    void chartData().then((d) => d && p.setAttribute('d', d.mark));
    return svg;
}
