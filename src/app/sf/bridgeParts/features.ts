/**
 * Course features that change the bridge structure: `gap` (a missing stretch of one carriageway's
 * deck, jumped over) and `boostRamp` (the kicker in front of it). Located in the bridge frame from
 * the feature's pos / length (course_meta.json `features`).
 */

import { LEN, deckY, toAxis } from './frame';

/** A course_meta.json feature (only the fields used here). */
export type CourseFeature = {
    type: string;
    pos?: readonly number[];
    length?: number;
    width?: number;
    height?: number;
    lipPos?: readonly number[];
};

export type Gap = { s0: number; s1: number; side: number };
export type Kicker = { s0: number; lipS: number; side: number; lc: number; width: number; lipH: number };

let gaps: Gap[] = [];
let kickers: Kicker[] = [];

export function useCourseFeatures(features: readonly CourseFeature[] | null | undefined): void {
    gaps = [];
    kickers = [];
    for (const f of features ?? []) {
        if (!f.pos || !f.length) continue;
        const { s, l } = toAxis(f.pos[0]!, f.pos[2]!);
        if (s < 0 || s > LEN || Math.abs(l) > 2410) continue;
        const side = l >= 0 ? 1 : -1;
        if (f.type === 'gap') gaps.push({ s0: s - f.length / 2, s1: s + f.length / 2, side });
        if (f.type === 'boostRamp' && f.lipPos) {
            const lip = toAxis(f.lipPos[0]!, f.lipPos[2]!);
            kickers.push({ s0: s - f.length / 2, lipS: lip.s, side, lc: l, width: f.width ?? 2300, lipH: f.lipPos[1]! - deckY(lip.s, l) });
        }
    }
}

export function deckGaps(): readonly Gap[] {
    return gaps;
}

export function boostKickers(): readonly Kicker[] {
    return kickers;
}

/** Is along s inside a gap on side sg (lateral sign), widened by margin? */
export function inGap(s: number, sg: number, margin = 0): boolean {
    return gaps.some((g) => g.side === Math.sign(sg) && s > g.s0 - margin && s < g.s1 + margin);
}

/** Does the along segment [a, b] overlap a gap on side sg? */
export function overlapsGap(a: number, b: number, sg: number): boolean {
    return gaps.some((g) => g.side === Math.sign(sg) && Math.max(a, b) > g.s0 && Math.min(a, b) < g.s1);
}

/** The ranges minus the gaps on side sg. */
export function cutGaps(ranges: [number, number][], sg: number): [number, number][] {
    let out = ranges;
    for (const g of gaps) {
        if (g.side !== Math.sign(sg)) continue;
        out = out.flatMap(([a, e]): [number, number][] => {
            if (e <= g.s0 || a >= g.s1) return [[a, e]];
            const r: [number, number][] = [];
            if (g.s0 > a) r.push([a, g.s0]);
            if (g.s1 < e) r.push([g.s1, e]);
            return r;
        });
    }
    return out.filter(([a, e]) => e - a > 1);
}
