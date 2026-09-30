/**
 * Gap-jump landing audit: for every boost ramp that ends at a gap, bot runs (tools/course/botlap.ts)
 * in every vehicle across the lanes (from along each wall to the centre), with and without a trick,
 * at the bot's pace, coasting in, braking in, after a wall scrape, grinding the barrier up the ramp
 * and veering out toward a barrier off the lip. Reports how far past the gap's far edge each kart
 * comes down (the margin, in S: where it touches down, or where its centre drops through its riding
 * height over the missing deck; negative = short, into the gap), per vehicle × lane and per
 * vehicle × approach.
 *
 * Usage: npx tsx tools/course/jumpcheck.ts [id] [--jump N] [--lanes -1000,0,1000] [--only ebike,buggy]
 *            [--approaches full,lap,coast,brake,scrape,grind,veer700,veer1000] [--trick | --no-trick]
 *            [--min M] [--dir courseDir] [-v]
 * Exit code 1 if any run that reaches the ramp lands short of --min (default 0) or respawns.
 */

import { vehicleSlot } from '../../src/app/vehicleData';
import { VEHICLES } from '../../src/app/vehicles';
import { eStatus } from '../../src/game/kart/Status';
import { loadCourseFiles, loadMeta, runBot, type BotAction, type CourseMeta } from './botlap';

type Jump = { ramp: [number, number]; gap: [number, number]; width: number };
/**
 * `entrySpeed` onto the ramp; `wallFrames`: wall contact over the last 1000 before the ramp and in
 * the air; `takeoffYaw`: the heading off the lip in degrees from the centerline (+ = left).
 */
export type JumpRun = { jump: number; vehicle: string; lane: number; approach: string; trick: boolean; entrySpeed: number; wallFrames: number; takeoffSpeed: number; takeoffLat: number; takeoffYaw: number; margin: number; respawned: boolean };

export function jumpsOf(meta: CourseMeta): Jump[] {
    const out: Jump[] = [];
    for (const r of meta.features.filter((f) => f.type === 'boostRamp')) {
        const g = meta.features.find((f) => f.type === 'gap' && Math.abs(f.s[0] - r.s[1]) < 1);
        if (g) out.push({ ramp: r.s, gap: g.s, width: (g as unknown as { width: number }).width });
    }
    return out;
}

/** Centerline height at S (linear between stations). */
function roadY(meta: CourseMeta, S: number) {
    const cl = meta.centerline;
    let i = 0;
    while (i + 1 < cl.length && cl[i + 1]!.s <= S) ++i;
    const a = cl[i]!;
    const b = cl[Math.min(i + 1, cl.length - 1)]!;
    const w = b.s > a.s ? (S - a.s) / (b.s - a.s) : 0;
    return a.pos[1] + (b.pos[1] - a.pos[1]) * w;
}

export function checkJumps(courseDir: string, o: { lanes?: number[]; only?: string[]; jumps?: number[]; approaches?: string[]; tricks?: boolean[] } = {}): JumpRun[] {
    const meta = loadMeta(courseDir);
    const files = loadCourseFiles(courseDir);
    const jumps = jumpsOf(meta);
    const out: JumpRun[] = [];
    jumps.forEach((J, ji) => {
        if (o.jumps && !o.jumps.includes(ji)) return;
        const r0 = J.ramp[0];
        const land = J.gap[1];
        // Default lanes: along each wall (the kart's side about touching it), just off it, halfway, centre.
        const w = J.width / 2;
        const lanes = o.lanes ?? [-(w - 150), -(w - 300), -w / 2, 0, w / 2, w - 300, w - 150];
        // Approaches: the bot's pace (`full`: in the lane from 8000 before the ramp; `lap`: the whole
        // lap in it), coasting over the last 3000 before the ramp, a short brake 2000 before it, and a
        // wall scrape: 300 past the wall line on the lane's side (the centre lane: the left) for 600
        // units, 5000 before the ramp, then back into the lane; a grind: steering 300 past that wall
        // line from 3000 before the ramp to the lip (held into the barrier all the way up, taking off
        // heading out ~8-15°); and a veer: steering out toward it over the last 700 / 1000 of the
        // ramp (taking off heading out ~3-12°, `takeoffYaw`).
        const approaches: [string, (lane: number) => BotAction[]][] = [
            ['full', () => []],
            ['lap', () => []],
            ['coast', () => [{ from: r0 - 3000, to: r0, action: 'noaccel' }]],
            ['brake', () => [{ from: r0 - 2000, to: r0 - 1900, action: 'brake' }]],
            ['scrape', (lane) => [{ from: r0 - 5000, to: r0 - 4400, action: 'offset', value: (lane >= 0 ? 1 : -1) * (w + 300) }]],
            ['grind', (lane) => [{ from: r0 - 3000, to: J.ramp[1], action: 'offset', value: (lane >= 0 ? 1 : -1) * (w + 300) }]],
            ...[700, 1000].map((d): [string, (lane: number) => BotAction[]] => [`veer${d}`, (lane) => [{ from: J.ramp[1] - d, to: J.ramp[1], action: 'offset', value: (lane >= 0 ? 1 : -1) * (w + 1500) }]]),
        ];
        for (const v of VEHICLES) {
            if (o.only && !o.only.includes(v.id)) continue;
            for (const lane of lanes)
                for (const [name, extra] of approaches.filter(([a]) => !o.approaches || o.approaches.includes(a)))
                    for (const trick of o.tricks ?? [true, false]) {
                        const actions: BotAction[] = [{ from: name === 'lap' ? 0 : r0 - 8000, to: land + 2000, action: 'offset', value: lane }, ...extra(lane)];
                        let restH = 0;
                        let restN = 0;
                        let takeoffSpeed = NaN;
                        let takeoffLat = NaN;
                        let takeoffYaw = NaN;
                        let lastLat = 0;
                        let lastS = 0;
                        let airborne = false;
                        let apex = false;
                        let prevS = 0;
                        let prevRel = 0;
                        let cross = NaN;
                        let respawned = false;
                        let done = false;
                        let entrySpeed = NaN;
                        let wallFrames = 0;
                        runBot(files, meta, {
                            vehicle: vehicleSlot(v.id),
                            autoTrick: trick,
                            actions,
                            onFrame: (f) => {
                                if (done) return true;
                                if (f.s > r0 - 3000 && f.s < r0 && f.ground && !f.status(eStatus.InRespawn)) {
                                    restH += f.pos[1] - roadY(meta, f.s);
                                    ++restN;
                                }
                                if (isNaN(entrySpeed) && f.s >= r0 && f.s < r0 + 1000) entrySpeed = f.speed;
                                if (f.s >= r0 - 1000 && f.s < r0 && (f.status(eStatus.WallCollision) || f.status(eStatus.Wall3Collision))) ++wallFrames;
                                if (f.s >= r0 && f.s < land + 20000 && !airborne && !f.ground && f.airtime >= 1 && f.s > J.ramp[1] - 600) {
                                    airborne = true;
                                    takeoffSpeed = f.speed;
                                    takeoffLat = f.lat;
                                    takeoffYaw = (Math.atan2(f.lat - lastLat, f.s - lastS) * 180) / Math.PI;
                                }
                                lastLat = f.lat;
                                lastS = f.s;
                                if (!airborne) return;
                                // Back on the ramp (a bounce, not the jump; the kart's centre passes the lip first).
                                if (f.ground && f.s < J.gap[0] + 500) {
                                    airborne = apex = false;
                                    return;
                                }
                                if (f.status(eStatus.WallCollision) || f.status(eStatus.Wall3Collision)) ++wallFrames;
                                if (f.status(eStatus.BeforeRespawn)) respawned = true;
                                // Down: touching the landing deck, or the kart's centre dropping through its
                                // riding height over the (missing) deck.
                                const rel = f.pos[1] - roadY(meta, f.s) - restH / Math.max(1, restN);
                                if (rel > 300) apex = true;
                                if (apex && isNaN(cross)) {
                                    if (f.ground) cross = f.s;
                                    else if (rel <= 0 && prevRel > 0) cross = prevS + ((f.s - prevS) * prevRel) / (prevRel - rel);
                                }
                                prevS = f.s;
                                prevRel = rel;
                                if (!isNaN(cross) && (f.ground || respawned)) done = true;
                            },
                        });
                        out.push({ jump: ji, vehicle: v.id, lane, approach: name, trick, entrySpeed, takeoffSpeed, takeoffLat, takeoffYaw, wallFrames, margin: cross - land, respawned });
                    }
        }
    });
    return out;
}

if (process.argv[1]?.endsWith('jumpcheck.ts')) {
    const args = process.argv.slice(2);
    const id = args[0] && !args[0].startsWith('--') ? args[0] : 'golden_gate';
    const opt = (k: string) => {
        const i = args.indexOf(k);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const dir = opt('--dir') ?? `public/data/courses/${id}`;
    const meta = loadMeta(dir);
    const jumps = jumpsOf(meta);
    const runs = checkJumps(dir, {
        lanes: opt('--lanes')?.split(',').map(Number),
        only: opt('--only')?.split(','),
        jumps: opt('--jump') ? [Number(opt('--jump'))] : undefined,
        approaches: opt('--approaches')?.split(','),
        tricks: args.includes('--trick') ? [true] : args.includes('--no-trick') ? [false] : undefined,
    });
    const min = Number(opt('--min') ?? 0);
    let bad = 0;
    jumps.forEach((J, ji) => {
        const rs = runs.filter((r) => r.jump === ji);
        if (!rs.length) return;
        console.log(`jump ${ji}: ramp S ${J.ramp[0]}..${J.ramp[1]}, gap ..${J.gap[1]} (${(J.gap[1] - J.gap[0]).toFixed(0)} long)`);
        if (args.includes('-v'))
            for (const r of rs)
                console.log(
                    `  ${r.vehicle.padEnd(8)} lane ${String(r.lane).padStart(5)} ${r.approach.padEnd(6)} ${r.trick ? 'trick' : '     '} in ${r.entrySpeed.toFixed(1)} walls ${r.wallFrames} takeoff ${r.takeoffSpeed.toFixed(1)} lat ${r.takeoffLat.toFixed(0)} yaw ${r.takeoffYaw.toFixed(1)} → margin ${r.margin.toFixed(0)}${r.respawned ? ' RESPAWN' : ''}`,
                );
        // Table: minimum margin per vehicle × lane (over approaches and tricks).
        const lanes = [...new Set(rs.map((r) => r.lane))].sort((a, b) => a - b);
        const row: Record<string, Record<string, string>> = {};
        for (const v of [...new Set(rs.map((r) => r.vehicle))]) {
            row[v] = {};
            for (const l of lanes) {
                const xs = rs.filter((r) => r.vehicle === v && r.lane === l && !isNaN(r.takeoffSpeed));
                if (!xs.length) continue;
                const worst = xs.reduce((a, b) => (b.margin < a.margin || isNaN(b.margin) ? b : a));
                row[v][`lane ${l}`] = `${worst.margin.toFixed(0)} (${worst.approach}${worst.trick ? '+t' : ''})`;
            }
        }
        console.table(row);
        // And per vehicle × approach (over lanes and tricks).
        const byApproach: Record<string, Record<string, string>> = {};
        for (const v of Object.keys(row)) {
            byApproach[v] = {};
            for (const a of [...new Set(rs.map((r) => r.approach))]) {
                const xs = rs.filter((r) => r.vehicle === v && r.approach === a && !isNaN(r.takeoffSpeed));
                if (!xs.length) continue;
                const worst = xs.reduce((p, q) => (q.margin < p.margin || isNaN(q.margin) ? q : p));
                byApproach[v][a] = `${worst.margin.toFixed(0)}${worst.respawned ? ' R' : ''}`;
            }
        }
        console.table(byApproach);
        const worst = rs.filter((r) => !isNaN(r.takeoffSpeed)).reduce((a, b) => (b.margin < a.margin || isNaN(b.margin) ? b : a));
        console.log(`  minimum margin ${worst.margin.toFixed(0)}: ${worst.vehicle} lane ${worst.lane} ${worst.approach}${worst.trick ? ' trick' : ''}; respawns ${rs.filter((r) => r.respawned).length}/${rs.length}`);
        // Runs that never reach the ramp (a lane wider than the road somewhere else on a whole-lap
        // offset) say nothing about the jump.
        const unreached = rs.filter((r) => isNaN(r.takeoffSpeed)).length;
        if (unreached) console.log(`  ${unreached} runs never reached the ramp`);
        bad += rs.filter((r) => !isNaN(r.takeoffSpeed) && (isNaN(r.margin) || r.margin < min || r.respawned)).length;
    });
    console.log(bad ? `${bad} short landings` : 'OK');
    process.exit(bad ? 1 : 0);
}
