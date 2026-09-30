/**
 * The leaderboard API (api/src/index.ts) from the game. On only in builds with `SFK_API` (the
 * freecode.sh deployment; vite.config.ts). Signing in is a freecode account: the game asks
 * freecode's auth server for a short-lived token (the freecode.sh session cookie comes along, as
 * the game is served from freecode.sh) and sends it with each signed-in call.
 */

import { FREECODE_AUTH } from '../brand';
import { DEV_TOOLS } from '../devMode';
import type { VehicleId } from '../vehicles';

declare const __SFK_API__: string;

export const API = typeof __SFK_API__ === 'string' ? __SFK_API__ : '';

export type BoardId = 'all' | VehicleId;

export interface BoardRow {
    rank: number;
    name: string;
    vehicle: VehicleId;
    timeMs: number;
    run: string;
}

export interface Me {
    name: string | null;
    suggested: string;
    bests: Partial<Record<BoardId, { timeMs: number; rank: number; run: string }>>;
}

export interface Posted {
    run: string;
    timeMs: number;
    vehicle: VehicleId;
    best: boolean;
    rank: { vehicle: number; all: number };
    bestMs: { vehicle: number; all: number };
}

/** An API error: `code` is the API's (sign_in, need_name, name_taken, stale, rejected, ...). */
export class ApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

let token: { value: string; until: number } | null = null;

/** A freecode token, or null when not signed in. */
async function auth(): Promise<string | null> {
    // Dev tools: a token of your own (e.g. signed with a staging API's TEST_JWKS key), as localhost can't sign in.
    if (DEV_TOOLS && localStorage.getItem('sfkart.devToken')) return localStorage.getItem('sfkart.devToken');
    if (token && Date.now() < token.until) return token.value;
    const res = await fetch(`${FREECODE_AUTH}/api/auth/token`, { credentials: 'include' }).catch(() => null);
    if (!res?.ok) return null;
    const { token: value } = (await res.json()) as { token: string };
    // Tokens last 15 minutes: renew well before.
    token = { value, until: Date.now() + 10 * 60_000 };
    return value;
}

async function call<T>(method: string, path: string, opts: { signedIn?: boolean; body?: BodyInit; type?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.signedIn) {
        const t = await auth();
        if (!t) throw new ApiError('sign_in', 'Sign in with freecode to post times');
        headers.Authorization = `Bearer ${t}`;
    }
    if (opts.type) headers['Content-Type'] = opts.type;
    const res = await fetch(`${API}${path}`, { method, headers, body: opts.body }).catch(() => null);
    if (!res) throw new ApiError('offline', 'Couldn’t reach the leaderboard');
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) {
        if (res.status === 401) token = null;
        throw new ApiError(body.error ?? 'error', body.message ?? `Leaderboard error ${res.status}`);
    }
    return body as T;
}

export const getBoard = (which: BoardId) => call<{ rows: BoardRow[] }>('GET', `/board?vehicle=${which}`).then((b) => b.rows);
export const getMe = () => call<Me>('GET', '/me', { signedIn: true });
export const setName = (name: string) => call<{ name: string }>('PUT', '/me', { signedIn: true, body: JSON.stringify({ name }), type: 'application/json' });
export const postRun = (file: Uint8Array) => call<Posted>('POST', '/runs', { signedIn: true, body: file as Uint8Array<ArrayBuffer>, type: 'application/octet-stream' });

/** Board times: m:ss.mmm. */
export function formatMs(ms: number): string {
    return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
