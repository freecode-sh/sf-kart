/**
 * Who's asking: a freecode account, from the short-lived token the game gets from freecode's auth
 * server (GET <AUTH_ORIGIN>/api/auth/token, with the freecode.sh session cookie) and sends as
 * `Authorization: Bearer <token>`. Checked against the auth server's public keys (JWKS). Only the
 * user id (`sub`) is kept; the name is only a suggestion for the player's board name.
 */

import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AuthEnv {
    AUTH_ORIGIN: string;
    /** Staging only: a JWKS (JSON) of test keys to accept instead of the auth server's. Never set in production. */
    TEST_JWKS?: string;
}

export interface User {
    id: string;
    name: string;
}

let keys: { origin: string; get: JWTVerifyGetKey } | null = null;

export async function authenticate(req: Request, env: AuthEnv): Promise<User | null> {
    const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '');
    if (!m) return null;
    if (keys?.origin !== env.AUTH_ORIGIN) {
        keys = {
            origin: env.AUTH_ORIGIN,
            get: env.TEST_JWKS ? createLocalJWKSet(JSON.parse(env.TEST_JWKS)) : createRemoteJWKSet(new URL(`${env.AUTH_ORIGIN}/api/auth/jwks`)),
        };
    }
    try {
        // The auth server's session tokens (its CLI access tokens carry another audience).
        const { payload } = await jwtVerify(m[1]!, keys.get, { issuer: env.AUTH_ORIGIN, audience: env.AUTH_ORIGIN });
        if (typeof payload.sub !== 'string' || !payload.sub) return null;
        return { id: payload.sub, name: typeof payload.name === 'string' ? payload.name : '' };
    } catch {
        return null;
    }
}
