/**
 * Screenshots of the running app (npm run dev) in headless Chrome, driven through window.__kart.
 * Chrome: $CHROME, else the default macOS install. `--gpu` renders on the GPU (macOS Metal), else
 * in software.
 *
 * Usage: npx tsx tools/sf/shot.ts <out-prefix> [--url URL] [--size WxH] [--dpr N] [--gpu] -- <step> ...
 * (--dpr: the device pixel ratio, default 1; 2 draws like a retina screen, the PNG at N× the size.)
 * Steps (evaluated in order, a screenshot after each `shot`):
 *   js:<expression>      evaluate (awaited) in the page
 *   wait:<ms>
 *   shot[:name]          screenshot → <out-prefix>.<name|n>.png
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep >= 0 ? argv.slice(0, sep) : argv;
const steps = sep >= 0 ? argv.slice(sep + 1) : ['wait:3000', 'shot'];
const out = opts[0] ?? '/tmp/kart';
const opt = (k: string) => {
    const i = opts.indexOf(`--${k}`);
    return i >= 0 ? opts[i + 1] : undefined;
};
const url = opt('url') ?? 'http://localhost:5173/';
const [W, H] = (opt('size') ?? '1280x720').split('x').map(Number) as [number, number];
const DPR = Number(opt('dpr') ?? 1);

const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'kart-chrome-'));
const chrome = spawn(CHROME, [
    '--headless=new',
    '--mute-audio',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    ...(opts.includes('--gpu') ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader']),
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
const logs: string[] = [];
ws.addEventListener('message', (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg);
    if (msg.method === 'Runtime.consoleAPICalled') logs.push(`[${msg.params.type}] ${msg.params.args.map((a: any) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${JSON.stringify(msg.params.exceptionDetails).slice(0, 800)}`);
});
const cdp = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve) => {
        const i = ++id;
        pending.set(i, resolve);
        ws!.send(JSON.stringify({ id: i, method, params }));
    });
const evaluate = async (expression: string) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
};

await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await cdp('Page.navigate', { url });
for (let i = 0; i < 200; ++i) {
    await sleep(300);
    if (await evaluate('!!(window.__ready || (window.__kart && window.__kart.sim))').catch(() => false)) break;
}
let n = 0;
try {
    for (const s of steps) {
        if (s.startsWith('js:')) {
            const v = await evaluate(s.slice(3));
            if (v !== undefined && v !== null) console.log(typeof v === 'string' ? v : JSON.stringify(v));
        } else if (s.startsWith('wait:')) await sleep(Number(s.slice(5)));
        else if (s.startsWith('shot')) {
            const name = s.includes(':') ? s.split(':')[1] : String(n++);
            const shot = await cdp('Page.captureScreenshot', { format: 'png' });
            const f = `${out}.${name}.png`;
            writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
            console.log(f);
        }
    }
} finally {
    if (logs.length) console.log(logs.slice(-30).join('\n'));
    ws.close();
    chrome.kill();
}
