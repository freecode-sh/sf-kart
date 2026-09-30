/**
 * Boundary / shortcut audit of a built course (KCL + meta), for the things a player could use to
 * cheat the lap:
 *
 *  1. barriers: every ~third of a station interval, on both sides, horizontal rays from just inside
 *     the wall line outward (straight out and ±40° along the road) at rising heights. Reports holes
 *     (nothing blocks the ray right above the road) and the barrier top (the lowest height a ray gets
 *     out) wherever it is under `--min-top` (default 1500).
 *  2. neighbours: pairs of road points close in plan (edge to edge within `--gap`, default 8000 like
 *     the builder's `shortcutGap`), the second below or at most 3000 above the first (no jump
 *     climbs higher), where going straight across saves at
 *     least `--min-gain` (3000) of road. A skip from one to the other only moves the engine's lap
 *     progress if no key checkpoint lies between them (the checkpoint search stops at key
 *     checkpoints, RaceManager.ts / CourseMap.ts), so pairs without one are listed as OPEN with the
 *     barrier tops in the way; pairs with one are only counted.
 *  3. respawns: every checkpoint's respawn point lies at or behind it along the lap.
 *
 *  4. with --drive: bot laps that push the boundaries (driveProbe).
 *
 * Usage: npx tsx tools/course/boundscheck.ts [id] [--gap 8000] [--min-gain 3000] [--min-top 1500] [--drive] [--dir courseDir]
 * Exit code 1 if there are holes, OPEN pairs, respawns ahead of their checkpoints or (--drive) a bot
 * lap that gets out, skips checkpoints or comes within 300 of a barrier top.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readKclTriangles } from '../../src/app/kclMesh';
import { vehicleSlot } from '../../src/app/vehicleData';
import { VEHICLES } from '../../src/app/vehicles';
import { eStatus } from '../../src/game/kart/Status';
import { RaceManager } from '../../src/game/system/RaceManager';
import { loadCourseFiles, loadMeta, runBot, type BotAction, type CourseMeta } from './botlap';

type V3 = [number, number, number];
type Station = CourseMeta['centerline'][number] & { edges: NonNullable<CourseMeta['centerline'][number]['edges']>; walls: [boolean, boolean]; fwd: V3 };

const FALL = 0x10;

/** `top`: barrier top over the floor just inside the wall line; `topY`: its height. */
export type Barrier = { s: number; side: 1 | -1; top: number; topY: number; hole: boolean };
export type Pair = { sA: number; sB: number; skip: number; gain: number; gap: number; dy: number; topA: number; topB: number };

export function auditCourse(courseDir: string, opts: { gap?: number; minGain?: number; minTop?: number } = {}) {
    const meta = loadMeta(courseDir);
    const kcl = readKclTriangles(new Uint8Array(readFileSync(join(courseDir, 'course.kcl'))));
    const cl = meta.centerline as Station[];
    const L = meta.length;
    const P = kcl.positions;
    const NT = kcl.attributes.length;

    // ---- triangle grid (plan) ------------------------------------------------------------------
    const CELL = 1000;
    const grid = new Map<number, number[]>();
    const key = (cx: number, cz: number) => cx * 100003 + cz;
    for (let t = 0; t < NT; ++t) {
        if ((kcl.attributes[t]! & 0x1f) === FALL) continue;
        const xs = [P[t * 9]!, P[t * 9 + 3]!, P[t * 9 + 6]!];
        const zs = [P[t * 9 + 2]!, P[t * 9 + 5]!, P[t * 9 + 8]!];
        for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); ++cx)
            for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); ++cz) {
                const k = key(cx, cz);
                let l = grid.get(k);
                if (!l) grid.set(k, (l = []));
                l.push(t);
            }
    }
    /** Nearest front-facing hit along o + d * t (0 < t <= len), Möller–Trumbore. */
    const cast = (o: V3, d: V3, len: number, want: (attr: number) => boolean, frontOnly: boolean): number => {
        const seen = new Set<number>();
        let best = Infinity;
        const steps = Math.ceil(len / (CELL / 10));
        for (let k = 0; k <= steps; ++k) {
            const x = o[0] + (d[0] * len * k) / steps;
            const z = o[2] + (d[2] * len * k) / steps;
            for (const t of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
                if (seen.has(t)) continue;
                seen.add(t);
                if (!want(kcl.attributes[t]!)) continue;
                const n: V3 = [kcl.normals[t * 3]!, kcl.normals[t * 3 + 1]!, kcl.normals[t * 3 + 2]!];
                if (frontOnly && n[0] * d[0] + n[1] * d[1] + n[2] * d[2] >= 0) continue;
                const a: V3 = [P[t * 9]!, P[t * 9 + 1]!, P[t * 9 + 2]!];
                const e1: V3 = [P[t * 9 + 3]! - a[0], P[t * 9 + 4]! - a[1], P[t * 9 + 5]! - a[2]];
                const e2: V3 = [P[t * 9 + 6]! - a[0], P[t * 9 + 7]! - a[1], P[t * 9 + 8]! - a[2]];
                const p: V3 = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
                const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
                if (Math.abs(det) < 1e-9) continue;
                const s: V3 = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
                const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
                if (u < -1e-4 || u > 1 + 1e-4) continue;
                const q: V3 = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
                const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
                if (v < -1e-4 || u + v > 1 + 1e-4) continue;
                const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
                if (tt > 0 && tt <= len && tt < best) best = tt;
            }
        }
        return best;
    };
    const isFloor = (attr: number) => {
        const ty = attr & 0x1f;
        return ty !== 0x0c && ty !== 0x0d && ty !== 0x0f && ty !== 0x1c && ty !== FALL;
    };

    /** Station interpolation at S (stations are sorted by s). */
    const at = (S: number) => {
        S = ((S % L) + L) % L;
        let lo = 0;
        let hi = cl.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (cl[mid]!.s <= S) lo = mid;
            else hi = mid - 1;
        }
        const a = cl[lo]!;
        const b = cl[(lo + 1) % cl.length]!;
        const sb = lo + 1 < cl.length ? b.s : L;
        const w = (S - a.s) / Math.max(1e-6, sb - a.s);
        const lerp = (x: number, y: number) => x + (y - x) * w;
        return {
            i: lo,
            S,
            pos: [lerp(a.pos[0], b.pos[0]), lerp(a.pos[1], b.pos[1]), lerp(a.pos[2], b.pos[2])] as V3,
            left: [-lerp(a.right[0], b.right[0]), 0, -lerp(a.right[2], b.right[2])] as V3,
            fwd: [lerp(a.fwd[0], b.fwd[0]), 0, lerp(a.fwd[2], b.fwd[2])] as V3,
            wallL: lerp(a.edges.wallL, b.edges.wallL),
            wallR: lerp(a.edges.wallR, b.edges.wallR),
        };
    };

    /** How far an air room moves the invisible wall out on a side at S (course.ts `airRoomAt`). */
    const rooms = (meta.features as { type: string; s: [number, number]; side?: string; out?: number; easeIn?: number; easeOut?: number }[]).filter((f) => f.type === 'airRoom');
    const roomOut = (S: number, side: 1 | -1) => {
        let out = 0;
        for (const a of rooms) {
            if ((a.side === 'left' ? 1 : -1) !== side || S < a.s[0] || S > a.s[1]) continue;
            const t = Math.min(1, (S - a.s[0]) / (a.easeIn || 1), (a.s[1] - S) / (a.easeOut || 1));
            out = Math.max(out, a.out! * Math.max(0, t));
        }
        return out;
    };

    // ---- 1. barriers ---------------------------------------------------------------------------
    const minTop = opts.minTop ?? 1500;
    const H_STEP = 100;
    const H_MAX = 6000;
    const barrierAt = (S: number, side: 1 | -1): Barrier => {
        const f = at(S);
        const w = side === 1 ? f.wallL : f.wallR;
        const inset = w - side * 250;
        const base: V3 = [f.pos[0] + f.left[0] * inset, f.pos[1], f.pos[2] + f.left[2] * inset];
        // Floor under the start point (the ramp / pipe / banked surface), or the centerline height over a gap.
        const down = cast([base[0], base[1] + 1500, base[2]], [0, -1, 0], 2500, isFloor, false);
        const y0 = down < Infinity ? base[1] + 1500 - down : base[1];
        const out: V3 = [f.left[0] * side, 0, f.left[2] * side];
        const dirs: V3[] = [-40, 0, 40].map((deg) => {
            const r = (deg * Math.PI) / 180;
            return [out[0] * Math.cos(r) + f.fwd[0] * Math.sin(r), 0, out[2] * Math.cos(r) + f.fwd[2] * Math.sin(r)];
        });
        // Rays reach past an air room's wall (the ±40° ones cross into it from up to ~1500 away).
        const reach = 900 + Math.max(...[-1500, 0, 1500].map((d) => roomOut(S + d, side))) * 1.8;
        const blocked = (h: number, d: V3) => cast([base[0], y0 + h, base[2]], d, reach, () => true, true) < Infinity;
        // Holes: any direction open right above the road. Top: straight out.
        const hole = !dirs.every((d) => blocked(40, d));
        let top = 0;
        if (!hole) for (top = 40; top < H_MAX && blocked(top + H_STEP, dirs[1]!); top += H_STEP);
        top = hole ? 0 : top + H_STEP;
        return { s: S, side, top, topY: y0 + top, hole };
    };
    const barriers: Barrier[] = [];
    for (let i = 0; i < cl.length; ++i) {
        const s0 = cl[i]!.s;
        const s1 = i + 1 < cl.length ? cl[i + 1]!.s : L;
        for (const t of [0.15, 0.5, 0.85]) for (const side of [1, -1] as const) barriers.push(barrierAt(s0 + (s1 - s0) * t, side));
    }
    const bySide = { [1]: barriers.filter((b) => b.side === 1), [-1]: barriers.filter((b) => b.side === -1) };
    /** The barrier probe nearest to S on a side. */
    const topAt = (S: number, side: 1 | -1): Barrier => {
        const xs = bySide[side];
        let lo = 0;
        let hi = xs.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (xs[mid]!.s <= S) lo = mid;
            else hi = mid - 1;
        }
        const nx = xs[Math.min(lo + 1, xs.length - 1)]!;
        return Math.abs(nx.s - S) < Math.abs(xs[lo]!.s - S) ? nx : xs[lo]!;
    };

    // ---- 2. neighbours -------------------------------------------------------------------------
    const cps = meta.checkpoints;
    const NC = cps.length;
    const keys = cps.filter((c) => c.key >= 0).map((c) => c.id);
    // Checkpoint quad a point is in: the last checkpoint line at or behind it (lines past S = L wrap).
    const byS = [...cps].sort((a, b) => a.s - b.s);
    const ckAt = (S: number) => {
        let c = byS[byS.length - 1]!.id;
        for (const x of byS) if (x.s <= S) c = x.id;
        return c;
    };
    /** Can the checkpoint search move a kart from checkpoint a straight to checkpoint b (no key between)? */
    const reachable = (a: number, b: number) => {
        const nextKey = keys.find((k) => k > a) ?? NC; // NC = the finish line, next lap
        const b1 = b > a ? b : b + NC;
        return b1 <= nextKey;
    };
    const gapMax = opts.gap ?? 8000;
    const minGain = opts.minGain ?? 3000;
    type Pt = { S: number; p: V3; half: number; left: V3 };
    const pts: Pt[] = [];
    for (let S = 0; S < L; S += 250) {
        const f = at(S);
        pts.push({ S, p: f.pos, half: Math.max(f.wallL, -f.wallR), left: f.left });
    }
    const PCELL = gapMax + 8000;
    const pgrid = new Map<number, number[]>();
    pts.forEach((q, i) => {
        const k = key(Math.floor(q.p[0] / PCELL), Math.floor(q.p[2] / PCELL));
        let l = pgrid.get(k);
        if (!l) pgrid.set(k, (l = []));
        l.push(i);
    });
    const pairs: Pair[] = [];
    let guarded = 0;
    for (const A of pts) {
        const cx = Math.floor(A.p[0] / PCELL);
        const cz = Math.floor(A.p[2] / PCELL);
        for (let dx = -1; dx <= 1; ++dx)
            for (let dz = -1; dz <= 1; ++dz)
                for (const j of pgrid.get(key(cx + dx, cz + dz)) ?? []) {
                    const B = pts[j]!;
                    const skip = (((B.S - A.S) % L) + L) % L;
                    if (skip < 6000 || skip > L - 6000) continue;
                    const dy = B.p[1] - A.p[1];
                    if (dy > 3000) continue;
                    const d = Math.hypot(B.p[0] - A.p[0], B.p[2] - A.p[2]);
                    const gap = d - A.half - B.half;
                    // Straight across instead of along the road: only worth it if it saves distance.
                    const gain = skip - d;
                    if (gap > gapMax || gain < minGain) continue;
                    if (!reachable(ckAt(A.S), ckAt(B.S))) {
                        ++guarded;
                        continue;
                    }
                    // Sides facing each other.
                    const sa = (B.p[0] - A.p[0]) * A.left[0] + (B.p[2] - A.p[2]) * A.left[2] > 0 ? 1 : -1;
                    const sb = (A.p[0] - B.p[0]) * B.left[0] + (A.p[2] - B.p[2]) * B.left[2] > 0 ? 1 : -1;
                    pairs.push({ sA: A.S, sB: B.S, skip, gain, gap, dy, topA: topAt(A.S, sa).top, topB: topAt(B.S, sb).top });
                }
    }

    // ---- 3. respawns ---------------------------------------------------------------------------
    const respawnAhead: string[] = [];
    for (const c of cps) {
        const j = meta.respawns[c.jugem];
        if (!j) {
            respawnAhead.push(`checkpoint ${c.id}: no respawn ${c.jugem}`);
            continue;
        }
        // Behind along the lap: 0 <= (c.s - j.s) mod L, and not most of a lap (that would be ahead).
        const back = (((c.s - j.s) % L) + L) % L;
        if (back > L / 2) respawnAhead.push(`checkpoint ${c.id} (S ${c.s}) respawns ${(L - back).toFixed(0)} ahead at S ${j.s}`);
    }
    return { meta, barriers, topAt, roomOut, holes: barriers.filter((b) => b.hole), low: barriers.filter((b) => !b.hole && b.top < minTop), pairs, guarded, respawnAhead, segOf: segOf(meta) };
}

export type DriveRun = { name: string; lap: boolean; frames: number; last: string; escapes: string[]; skips: string[]; minMargin: number; minMarginAt: string };

/**
 * Bot laps that push the boundaries, per vehicle: the racing line, down each lane, up the half-pipes,
 * full lock left / right off every lip and angled takeoffs (across each ramp toward a wall).
 * Reports frames where the kart gets outside the wall lines or air rooms (not respawning),
 * checkpoint jumps of more than 2 quads in a frame, and the closest the kart gets to the barrier tops (their height
 * minus the kart's, on the side the kart is on).
 */
export function driveProbe(courseDir: string, audit: ReturnType<typeof auditCourse>): DriveRun[] {
    const meta = audit.meta;
    const seg = audit.segOf;
    const files = loadCourseFiles(courseDir);
    // Full lock from each lip over the first part of the flight (then the bot steers back on).
    const lips = meta.features.filter((f) => f.type === 'boostRamp' || f.type === 'ramp').map((f) => f.s[1]);
    const lock = (value: number): BotAction[] => lips.map((s1) => ({ from: s1, to: s1 + 3000, action: 'stick', value }));
    const hug = (off: number): BotAction[] => [{ from: 0, to: meta.length, action: 'offset', value: off }];
    // Up the half-pipes (the rest of the lap on the line).
    const pipes = (off: number): BotAction[] =>
        (meta.features as { type: string; s: [number, number]; side?: string }[])
            .filter((f) => f.type === 'halfpipe')
            .map((f) => ({ from: f.s[0], to: f.s[1], action: 'offset', value: f.side === 'left' ? off : -off }));
    // Angled takeoffs: from one lane across the ramp toward the other wall.
    const angled = (side: 1 | -1): BotAction[] =>
        meta.features
            .filter((f) => f.type === 'boostRamp' || f.type === 'ramp')
            .flatMap((f): BotAction[] => [
                { from: f.s[0] - 2500, to: f.s[0], action: 'offset', value: -side * 1000 },
                { from: f.s[0], to: f.s[1] + 2000, action: 'offset', value: side * 6000 },
            ]);
    const variants: [string, BotAction[]][] = [
        ['line', []],
        ['lane left', hug(1000)],
        ['lane right', hug(-1000)],
        ['half-pipes', pipes(1450)],
        ['half-pipes high', pipes(3000)],
        ['jumps full left', lock(0)],
        ['jumps full right', lock(14)],
        ['jumps angled left', angled(1)],
        ['jumps angled right', angled(-1)],
    ];
    const out: DriveRun[] = [];
    for (const v of VEHICLES)
        for (const [name, actions] of variants) {
            const escapes: string[] = [];
            const skips: string[] = [];
            let minMargin = Infinity;
            let minMarginAt = '';
            let prevCk = -1;
            let outside = false;
            let last = '';
            const cl = meta.centerline;
            const r = runBot(files, meta, {
                vehicle: vehicleSlot(v.id),
                actions,
                maxFrames: 60 * 60 * 5,
                onFrame: (f) => {
                    if (f.status(eStatus.BeforeRespawn) || f.status(eStatus.InRespawn) || f.status(eStatus.AfterRespawn)) {
                        prevCk = -1;
                        outside = false;
                        return;
                    }
                    const side = f.lat >= 0 ? 1 : -1;
                    const b = audit.topAt(f.s, side);
                    const margin = b.topY - f.pos[1];
                    if (margin < minMargin) {
                        minMargin = margin;
                        minMarginAt = seg(f.s);
                    }
                    let st = cl[0]!;
                    for (const c of cl) if (c.s <= f.s) st = c;
                    const wall = side === 1 ? st.edges!.wallL : -st.edges!.wallR;
                    const nowOutside = Math.abs(f.lat) > wall + 300 + audit.roomOut(f.s, side);
                    if (nowOutside && !outside) escapes.push(`${seg(f.s)} lat ${f.lat.toFixed(0)} y ${f.pos[1].toFixed(0)} (frame ${f.frame})`);
                    outside = nowOutside;
                    const ck = RaceManager.Instance()!.player().checkpointId();
                    const NC = meta.checkpoints.length;
                    if (prevCk >= 0 && ck !== prevCk && (ck - prevCk + NC) % NC > 2 && (ck - prevCk + NC) % NC < NC / 2) skips.push(`checkpoint ${prevCk} -> ${ck} at ${seg(f.s)} (frame ${f.frame})`);
                    prevCk = ck;
                    last = seg(f.s);
                },
            });
            out.push({ name: `${v.id} ${name}`, lap: r.lapsCompleted >= 1, frames: r.raceFrames, last, escapes, skips, minMargin, minMarginAt });
        }
    return out;
}

export function segOf(meta: CourseMeta) {
    return (S: number) => {
        for (const [k, [a, b]] of Object.entries(meta.segments)) if (S >= a && S < b) return `${k}@${Math.round(S - a)}`;
        return `S${Math.round(S)}`;
    };
}

/** Collapse sorted S samples into [from, to] runs (samples closer than `join` merge). */
function runs(xs: number[], join: number): [number, number][] {
    const out: [number, number][] = [];
    for (const x of [...xs].sort((a, b) => a - b)) {
        const last = out[out.length - 1];
        if (last && x - last[1] <= join) last[1] = x;
        else out.push([x, x]);
    }
    return out;
}

if (process.argv[1]?.endsWith('boundscheck.ts')) {
    const args = process.argv.slice(2);
    const id = args[0] && !args[0].startsWith('--') ? args[0] : 'golden_gate';
    const opt = (k: string) => {
        const i = args.indexOf(k);
        return i >= 0 ? Number(args[i + 1]) : undefined;
    };
    const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1]! : `public/data/courses/${id}`;
    const r = auditCourse(dir, { gap: opt('--gap'), minGain: opt('--min-gain'), minTop: opt('--min-top') });
    const seg = r.segOf;
    let bad = 0;
    console.log(`${r.meta.name}: ${r.barriers.length} barrier probes`);
    for (const side of [1, -1] as const) {
        const name = side === 1 ? 'left' : 'right';
        for (const [a, b] of runs(r.holes.filter((x) => x.side === side).map((x) => x.s), 1200)) {
            console.log(`  HOLE (${name}) ${seg(a)} .. ${seg(b)}`);
            ++bad;
        }
        for (const [a, b] of runs(r.low.filter((x) => x.side === side).map((x) => x.s), 1200)) {
            const tops = r.low.filter((x) => x.side === side && x.s >= a && x.s <= b).map((x) => x.top);
            console.log(`  low barrier (${name}) ${seg(a)} .. ${seg(b)}: top ${Math.min(...tops)}..${Math.max(...tops)} above the road`);
        }
    }
    const tops = r.barriers.filter((b) => !b.hole).map((b) => b.top);
    console.log(`  barrier tops ${Math.min(...tops)}..${Math.max(...tops)} above the road`);
    console.log(`neighbours within the gap: ${r.guarded} point pairs with a key checkpoint between them, ${r.pairs.length} without`);
    // One line per stretch pair (the biggest saving).
    const groups = new Map<string, Pair>();
    for (const p of r.pairs) {
        const g = `${seg(p.sA).split('@')[0]}->${seg(p.sB).split('@')[0]}`;
        const cur = groups.get(g);
        if (!cur || p.gain > cur.gain) groups.set(g, p);
    }
    for (const [g, p] of groups) {
        console.log(
            `  OPEN ${g}: ${seg(p.sA)} -> ${seg(p.sB)} saves ${p.gain.toFixed(0)} of ${p.skip.toFixed(0)}, ${p.gap.toFixed(0)} apart edge to edge, dy ${p.dy.toFixed(0)}, barriers ${p.topA} / ${p.topB}`,
        );
        ++bad;
    }
    for (const x of r.respawnAhead) {
        console.log(`  RESPAWN AHEAD ${x}`);
        ++bad;
    }
    if (args.includes('--drive')) {
        console.log('bot laps:');
        for (const d of driveProbe(dir, r)) {
            console.log(
                `  ${d.name}: ${d.lap ? 'lap' : `no lap (at ${d.last})`} in ${d.frames} frames; closest to a barrier top ${d.minMargin.toFixed(0)} below it (${d.minMarginAt})`,
            );
            for (const e of d.escapes) console.log(`    ESCAPED ${e}`);
            for (const e of d.skips) console.log(`    SKIPPED ${e}`);
            bad += d.escapes.length + d.skips.length + (d.minMargin < 300 ? 1 : 0);
        }
    }
    console.log(bad ? `${bad} problems` : 'OK');
    process.exit(bad ? 1 : 0);
}
