/**
 * Developer tools (the Tuning panel, the K live-tuning panel, the physics debug overlay, frame
 * stepping and the window.__kart hook) exist only on the dev server or when served from this
 * machine. Everywhere else the game races the stock vehicles from their data (vehicles.json).
 */
export const DEV_TOOLS = import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(location.hostname);
