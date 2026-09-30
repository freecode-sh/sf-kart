/**
 * The SF Kart leaderboard API (a Cloudflare Worker at sfkart-api.freecode.sh; D1 for the boards, R2
 * for run files). Posting a time means posting the run itself: the Worker races its inputs again
 * through the game's own live path (src/app/rules/resim.ts checkRun) and records the time only if it
 * finishes on the frame, with the splits, it claims.
 *
 *   GET    /board?vehicle=all|ebike|robotaxi|buggy   the top 50 (cached 30 s)
 *   GET    /me                                        your board name and bests      (signed in)
 *   PUT    /me       { name }                         pick your board name           (signed in)
 *   DELETE /me                                        forget you: name, runs, bests  (signed in)
 *   POST   /runs     <run file>                       post a run                     (signed in)
 *   GET    /runs/:id                                  a run file (for replays)
 *   POST   /admin/ban?name=… | /admin/unban?name=…    (Bearer ADMIN_KEY)
 *
 * Signed in = a freecode token (auth.ts). One board per rules hash (a season, RULES_ID).
 */

import type { D1Database, R2Bucket, RateLimit } from '@cloudflare/workers-types';
import { checkRun } from '../../src/app/rules/resim';
import { decodeRun, RUN_TUNED } from '../../src/app/rules/runfile';
import { VEHICLES } from '../../src/app/vehicles';
import { authenticate, type AuthEnv, type User } from './auth';
import { cleanName, suggestName } from './names';
import { loadRules, type RulesEnv } from './rules';

interface Env extends AuthEnv, RulesEnv {
    DB: D1Database;
    RUNS: R2Bucket;
    SUBMIT_LIMIT: RateLimit;
    ALLOWED_ORIGINS: string;
    RUNS_PREFIX: string;
    SUBMIT_ENABLED: string;
    WRITES_ENABLED: string;
    ADMIN_KEY?: string;
}

const BOARDS = ['all', ...VEHICLES.map((v) => v.id)] as const;
type Board = (typeof BOARDS)[number];
/** The overall board's rows in `bests`. */
const ANY = '*';
const BOARD_SIZE = 50;
const MAX_BODY = 64 * 1024;

class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message = code,
    ) {
        super(message);
    }
}

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        const origin = req.headers.get('Origin');
        const allowed = origin && env.ALLOWED_ORIGINS.split(',').includes(origin) ? origin : null;
        if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), allowed, true);
        let res: Response;
        try {
            res = await route(req, env);
        } catch (e) {
            if (e instanceof HttpError) res = json({ error: e.code, message: e.message }, e.status);
            else {
                console.error(e);
                res = json({ error: 'internal', message: 'Something went wrong' }, 500);
            }
        }
        return cors(res, allowed, false);
    },
};

async function route(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/board' && req.method === 'GET') return board(url, env);
    const run = /^\/runs\/([0-9a-f]{16})$/.exec(path);
    if (run && req.method === 'GET') return runFile(run[1]!, env);
    if (path.startsWith('/admin/') && req.method === 'POST') return admin(req, url, env);
    if (path === '/me' || path === '/runs') {
        const user = await authenticate(req, env);
        if (!user) throw new HttpError(401, 'sign_in', 'Sign in with freecode first');
        if (req.method !== 'GET') writable(env);
        if (path === '/me' && req.method === 'GET') return me(user, env);
        if (path === '/me' && req.method === 'PUT') return setName(req, user, env);
        if (path === '/me' && req.method === 'DELETE') return forget(req, user, env);
        if (path === '/runs' && req.method === 'POST') return postRun(req, user, env);
    }
    throw new HttpError(404, 'not_found');
}

function writable(env: Env): void {
    if (env.WRITES_ENABLED !== 'true') throw new HttpError(503, 'read_only', 'The leaderboard is read-only right now');
}

// ---- boards ------------------------------------------------------------------------------------

async function board(url: URL, env: Env): Promise<Response> {
    const which = (url.searchParams.get('vehicle') ?? 'all') as Board;
    if (!BOARDS.includes(which)) throw new HttpError(400, 'bad_vehicle');
    const cache = (caches as unknown as { default: Cache }).default;
    const key = boardKey(url.origin, env.RULES_ID, which);
    const hit = await cache.match(key);
    if (hit) return hit;
    const { results } = await env.DB.prepare(
        `SELECT p.name, b.run_vehicle AS vehicle, b.time_ms AS timeMs, b.run_id AS run, b.created_at AS at
         FROM bests b JOIN players p ON p.id = b.player_id
         WHERE b.season = ?1 AND b.vehicle = ?2 AND p.banned = 0
         ORDER BY b.time_ms, b.created_at LIMIT ?3`,
    )
        .bind(env.RULES_ID, which === 'all' ? ANY : which, BOARD_SIZE)
        .all<{ name: string; vehicle: string; timeMs: number; run: string; at: number }>();
    const res = json({ season: env.RULES_ID, vehicle: which, rows: results.map((r, i) => ({ rank: i + 1, ...r })) }, 200, 'public, max-age=30');
    await cache.put(key, res.clone());
    return res;
}

function boardKey(origin: string, season: string, which: Board): string {
    return `${origin}/board?season=${season}&vehicle=${which}`;
}

/** 1 + the players ahead of this time on a board (ties: who got there first). */
async function rankOf(env: Env, which: string, timeMs: number, at: number): Promise<number> {
    const r = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM bests b JOIN players p ON p.id = b.player_id
         WHERE b.season = ?1 AND b.vehicle = ?2 AND p.banned = 0 AND (b.time_ms < ?3 OR (b.time_ms = ?3 AND b.created_at < ?4))`,
    )
        .bind(env.RULES_ID, which, timeMs, at)
        .first<{ n: number }>();
    return (r?.n ?? 0) + 1;
}

// ---- you ---------------------------------------------------------------------------------------

async function me(user: User, env: Env): Promise<Response> {
    const player = await env.DB.prepare('SELECT name FROM players WHERE id = ?1').bind(user.id).first<{ name: string }>();
    const { results } = await env.DB.prepare('SELECT vehicle, time_ms AS timeMs, run_id AS run, created_at AS at FROM bests WHERE season = ?1 AND player_id = ?2')
        .bind(env.RULES_ID, user.id)
        .all<{ vehicle: string; timeMs: number; run: string; at: number }>();
    const bests: Record<string, { timeMs: number; run: string; rank: number }> = {};
    for (const b of results) bests[b.vehicle === ANY ? 'all' : b.vehicle] = { timeMs: b.timeMs, run: b.run, rank: await rankOf(env, b.vehicle, b.timeMs, b.at) };
    return json({ name: player?.name ?? null, suggested: suggestName(user.name), season: env.RULES_ID, bests });
}

async function setName(req: Request, user: User, env: Env): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
    const name = cleanName(body?.name);
    if (!name) throw new HttpError(400, 'bad_name', 'Names are 2 to 20 letters, digits, spaces, dots, dashes or underscores');
    try {
        await env.DB.prepare('INSERT INTO players (id, name, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET name = excluded.name')
            .bind(user.id, name, Date.now())
            .run();
    } catch (e) {
        if (String(e).includes('UNIQUE')) throw new HttpError(409, 'name_taken', 'That name is taken');
        throw e;
    }
    await purgeBoards(req, env, BOARDS);
    return json({ name });
}

async function forget(req: Request, user: User, env: Env): Promise<Response> {
    const { results } = await env.DB.prepare('SELECT id FROM runs WHERE player_id = ?1').bind(user.id).all<{ id: string }>();
    if (results.length) await env.RUNS.delete(results.map((r) => runKey(env, r.id)));
    // Runs and bests go with the player (ON DELETE CASCADE).
    await env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(user.id).run();
    await purgeBoards(req, env, BOARDS);
    return json({ deleted: true });
}

// ---- runs --------------------------------------------------------------------------------------

async function postRun(req: Request, user: User, env: Env): Promise<Response> {
    if (env.SUBMIT_ENABLED !== 'true') throw new HttpError(503, 'closed', 'Posting times is paused right now');
    const player = await env.DB.prepare('SELECT banned FROM players WHERE id = ?1').bind(user.id).first<{ banned: number }>();
    if (!player) throw new HttpError(409, 'need_name', 'Pick a board name first');
    if (player.banned) throw new HttpError(403, 'banned', 'This account can’t post times');
    if (!(await env.SUBMIT_LIMIT.limit({ key: user.id })).success) throw new HttpError(429, 'slow_down', 'Too many runs at once: try again in a minute');

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_BODY) throw new HttpError(413, 'too_big');
    const run = await decodeRun(bytes).catch(() => {
        throw new HttpError(400, 'bad_run', 'That isn’t a run file');
    });
    if (run.rulesHash !== env.RULES_ID) throw new HttpError(409, 'stale', 'A new version of SF Kart is out: reload the page to post times');
    if (run.flags & RUN_TUNED) throw new HttpError(422, 'rejected', 'Runs raced with dev tuning aren’t ranked');
    const check = await checkRun(run, await loadRules(env));
    if (!check.ok || check.raceMs === null) {
        console.warn(`rejected run from ${user.id}: ${check.errors.join('; ')}`);
        throw new HttpError(422, 'rejected', 'That run didn’t check out');
    }
    const v = { timeMs: check.raceMs, frames: check.frames };

    const id = await runId(bytes);
    const now = Date.now();
    const best = (which: string) =>
        env.DB.prepare('SELECT time_ms AS timeMs, created_at AS at FROM bests WHERE season = ?1 AND vehicle = ?2 AND player_id = ?3')
            .bind(env.RULES_ID, which, user.id)
            .first<{ timeMs: number; at: number }>();
    const [prev, prevAll] = await Promise.all([best(run.vehicle), best(ANY)]);
    const isBest = !prev || v.timeMs < prev.timeMs;
    if (isBest) {
        await env.RUNS.put(runKey(env, id), bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
        const upsert = (which: string) =>
            env.DB.prepare(
                `INSERT INTO bests (season, vehicle, player_id, run_id, run_vehicle, time_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(season, vehicle, player_id) DO UPDATE SET run_id = excluded.run_id, run_vehicle = excluded.run_vehicle,
                   time_ms = excluded.time_ms, created_at = excluded.created_at
                 WHERE excluded.time_ms < bests.time_ms`,
            ).bind(env.RULES_ID, which, user.id, id, run.vehicle, v.timeMs, now);
        await env.DB.batch([
            env.DB.prepare('INSERT OR IGNORE INTO runs (id, player_id, season, vehicle, time_ms, frames, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(
                id,
                user.id,
                env.RULES_ID,
                run.vehicle,
                v.timeMs,
                v.frames,
                now,
            ),
            upsert(run.vehicle),
            upsert(ANY),
        ]);
        await purgeBoards(req, env, ['all', run.vehicle]);
    }
    const mine = isBest ? { timeMs: v.timeMs, at: now } : prev!;
    const all = (await best(ANY)) ?? prevAll!;
    return json({
        run: id,
        timeMs: v.timeMs,
        vehicle: run.vehicle,
        best: isBest,
        rank: { vehicle: await rankOf(env, run.vehicle, mine.timeMs, mine.at), all: await rankOf(env, ANY, all.timeMs, all.at) },
        bestMs: { vehicle: mine.timeMs, all: all.timeMs },
    });
}

/** A run file's id: the first 16 hex digits of its SHA-256. */
async function runId(bytes: Uint8Array): Promise<string> {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    return [...h.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function runFile(id: string, env: Env): Promise<Response> {
    const obj = await env.RUNS.get(runKey(env, id));
    if (!obj) throw new HttpError(404, 'not_found');
    return new Response(await obj.arrayBuffer(), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } });
}

function runKey(env: Env, id: string): string {
    return `${env.RUNS_PREFIX}runs/${id}.sfkr`;
}

// ---- admin -------------------------------------------------------------------------------------

async function admin(req: Request, url: URL, env: Env): Promise<Response> {
    if (!env.ADMIN_KEY || req.headers.get('Authorization') !== `Bearer ${env.ADMIN_KEY}`) throw new HttpError(401, 'unauthorized');
    const name = url.searchParams.get('name') ?? '';
    const banned = url.pathname === '/admin/ban' ? 1 : url.pathname === '/admin/unban' ? 0 : -1;
    if (banned < 0) throw new HttpError(404, 'not_found');
    const r = await env.DB.prepare('UPDATE players SET banned = ?1 WHERE name = ?2').bind(banned, name).run();
    if (!r.meta.changes) throw new HttpError(404, 'no_player');
    await purgeBoards(req, env, BOARDS);
    return json({ name, banned: !!banned });
}

// ---- helpers -----------------------------------------------------------------------------------

async function purgeBoards(req: Request, env: Env, which: readonly Board[]): Promise<void> {
    const cache = (caches as unknown as { default: Cache }).default;
    const origin = new URL(req.url).origin;
    await Promise.all(which.map((w) => cache.delete(boardKey(origin, env.RULES_ID, w))));
}

function json(body: unknown, status = 200, cacheControl = 'no-store'): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl } });
}

function cors(res: Response, origin: string | null, preflight: boolean): Response {
    const out = new Response(res.body, res);
    out.headers.set('Vary', 'Origin');
    if (!origin) return out;
    out.headers.set('Access-Control-Allow-Origin', origin);
    if (preflight) {
        out.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        out.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        out.headers.set('Access-Control-Max-Age', '86400');
    }
    return out;
}
