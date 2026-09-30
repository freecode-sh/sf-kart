/** SF Kart's links: freecode (the coding agent it's built and remixed with) and the source. */

export const FREECODE_URL = 'https://freecode.sh';
export const INSTALL_COMMAND = 'npm install -g freecode-sh && freecode';
export const SOURCE_URL = 'https://github.com/freecode-sh/sf-kart';
export const REMIX_GUIDE_URL = `${SOURCE_URL}/blob/main/docs/REMIX.md`;
/** freecode accounts (the leaderboard's sign-in): the auth server, and the sign-in page back to the game. */
export const FREECODE_AUTH = 'https://auth.freecode.sh';
export const signInUrl = (returnTo: string) => `${FREECODE_URL}/sign-in?returnTo=${encodeURIComponent(returnTo)}`;

/** The engine's lineage, as the About panel, CREDITS.md and the README state it. */
export const ENGINE_CREDIT =
    'Driving physics: a TypeScript port of Kinoko (MIT), an independent open-source reimplementation of a classic console kart racer’s physics.';
