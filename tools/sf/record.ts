/**
 * Records a playthrough of the running app (npm run dev): replays an RKG ghost (default the bot lap
 * from tools/sf/pickupBot.ts) through the game's own chase camera in headless Chrome, one JPEG
 * every `--every` sim frames (2 = 30 fps), plus frames.json (per frame: race frame, kart position,
 * course S and section) for reviewing, and an MP4 via ffmpeg (needs ffmpeg on the PATH). Chrome:
 * $CHROME, else the default macOS install; renders on the GPU through Metal (macOS).
 *
 * Usage: npx tsx tools/sf/record.ts [out-dir=.context/playthrough] [--url http://localhost:5173/]
 *                                   [--ghost /data/...rkg] [--every 2] [--frames N] [--size 1280x720]
 */

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const out = resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : '.context/playthrough');
const opt = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
};
const url = opt('url') ?? 'http://localhost:5173/';
const ghost = opt('ghost') ?? '/data/courses/golden_gate/bot.rkg';
const every = Number(opt('every') ?? 2);
const maxFrames = Number(opt('frames') ?? 12000);
const [W, H] = (opt('size') ?? '1280x720').split('x').map(Number) as [number, number];

type Station = { s: number; pos: [number, number, number] };
// Course S / section by the nearest station in 3D (the bridge deck passes over the Fort Point loop).
const meta = JSON.parse(readFileSync('public/data/courses/golden_gate/course_meta.json', 'utf8')) as { centerline: Station[]; segments: Record<string, [number, number]> };
/** Course S and section of the nearest centerline station. */
const locate = (x: number, y: number, z: number): { s: number; section: string } => {
    let best = meta.centerline[0]!;
    let bd = Infinity;
    for (const c of meta.centerline) {
        const d = (c.pos[0] - x) ** 2 + (c.pos[1] - y) ** 2 + (c.pos[2] - z) ** 2;
        if (d < bd) {
            bd = d;
            best = c;
        }
    }
    const section = Object.entries(meta.segments).find(([, [a, b]]) => best.s >= a && best.s < b)?.[0] ?? '';
    return { s: Math.round(best.s), section };
};

mkdirSync(join(out, 'frames'), { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(CHROME, [
    '--headless=new',
    '--mute-audio',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'kart-rec-'))}`,
    `--window-size=${W},${H}`,
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ws: WebSocket | null = null;
for (let i = 0; i < 50 && !ws; ++i) {
    await sleep(200);
    try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        const page = list.find((t) => t.type === 'page');
        if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {
        /* not up yet */
    }
}
if (!ws) throw new Error('chrome did not start');
await new Promise((r) => ws!.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.addEventListener('message', (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg);
});
const cdp = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((res) => {
        const i = ++id;
        pending.set(i, res);
        ws!.send(JSON.stringify({ id: i, method, params }));
    });
const evaluate = async (expression: string) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
};

await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url });
for (let i = 0; i < 200; ++i) {
    await sleep(300);
    if (await evaluate('!!(window.__kart && window.__kart.sim && window.__kart.renderer.sf && window.__kart.renderer.sf.world)').catch(() => false)) break;
}
await sleep(4000);
await evaluate(`__kart.replay(${JSON.stringify(ghost)})`);
// Stepping pauses the game; hide the pause banner in the recording.
await evaluate(`(() => { const st = document.createElement('style'); st.textContent = '.hud-paused { visibility: hidden !important; }'; document.head.appendChild(st); })()`);

const frames: { i: number; frame: number; x: number; y: number; z: number; s: number; section: string; speed: number }[] = [];
let finishedAt = -1;
try {
    for (let i = 0, f = 0; f < maxFrames; ++i, f += every) {
        const v = (await evaluate(
            `(() => { __kart.step(${every}); const k = __kart.sim.view(1).kart; return { x: k.pos.x, y: k.pos.y, z: k.pos.z, speed: k.speed ?? 0 }; })()`,
        )) as { x: number; y: number; z: number; speed: number };
        const shot = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
        writeFileSync(join(out, 'frames', `${String(i).padStart(5, '0')}.jpg`), Buffer.from(shot.result.data, 'base64'));
        frames.push({ i, frame: f, x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z), speed: Math.round(v.speed * 10) / 10, ...locate(v.x, v.y, v.z) });
        if (i % 150 === 0) console.log(`frame ${f}: ${frames.at(-1)!.section} S=${frames.at(-1)!.s}`);
        // Stop a couple of seconds after the lap wraps round to the start again.
        const last = frames.at(-1)!;
        if (finishedAt < 0 && frames.length > 600 && last.s < 20000 && frames.some((q) => q.section === 'marina')) finishedAt = i;
        if (finishedAt >= 0 && i - finishedAt > 90) break;
    }
} finally {
    writeFileSync(join(out, 'frames.json'), JSON.stringify(frames));
    ws.close();
    chrome.kill();
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(60 / every), '-i', join(out, 'frames', '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', join(out, 'playthrough.mp4')]);
console.log(`${frames.length} frames → ${join(out, 'playthrough.mp4')}`);
