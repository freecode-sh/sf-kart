/**
 * The online leaderboard in the game: its top times go to the welcome screen's board
 * (ui/leaderboard.ts, via `onRows`), and a line on the results board posts the run just finished.
 * A run is posted when it beats your time on the board; signed out (or without a board name yet),
 * the best such run is kept (localStorage) and posted once you're signed in and named. Player
 * names only ever go in as text.
 */

import { RULES_HASH as RULES } from 'virtual:sfkart-rules-hash';
import { signInUrl } from '../brand';
import { vehicleDef, type VehicleId } from '../vehicles';
import { API, ApiError, formatMs, getBoard, getMe, postRun, setName, type BoardRow, type Me } from './api';

const PENDING_KEY = 'sfkart.pendingRun';

interface Pending {
    rules: string;
    vehicle: VehicleId;
    timeMs: number;
    /** The run file, base64. */
    file: string;
}

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

export class OnlineBoard {
    /** The results board's line. */
    readonly status = el('div', 'lb-status');
    /** The top times (all vehicles), whenever they're fetched. */
    onRows: (rows: BoardRow[], me: Me | null) => void = () => {};
    /** undefined: not asked yet; null: signed out. */
    private me: Me | null | undefined;
    private state: Status = { kind: 'idle' };
    private editing = false;

    static enabled(): boolean {
        return API !== '';
    }

    constructor() {
        void this.refresh().then(() => this.postPending());
    }

    /** Fresh board and account (the welcome screen shows). */
    open(): void {
        void this.refresh();
    }

    /** A run finished (stock vehicle, not tuned mid-race): post it if it beats your board time. */
    async finished(vehicle: VehicleId, timeMs: number, file: Promise<Uint8Array>): Promise<void> {
        const mine = this.me?.bests[vehicle]?.timeMs;
        if (mine !== undefined && timeMs >= mine) {
            this.set({ kind: 'done', text: `Your board time on the ${vehicleDef(vehicle).name}: ${formatMs(mine)} (#${this.me!.bests[vehicle]!.rank})` });
            return;
        }
        const pending = loadPending();
        if (!pending || pending.rules !== RULES || pending.vehicle !== vehicle || timeMs < pending.timeMs) {
            savePending({ rules: RULES, vehicle, timeMs, file: toBase64(await file) });
        }
        await this.postPending();
    }

    /** Posts the kept run, if any, when signed in and named. */
    private async postPending(): Promise<void> {
        const p = loadPending();
        if (!p) return this.render();
        if (p.rules !== RULES) {
            localStorage.removeItem(PENDING_KEY);
            return this.render();
        }
        if (this.me === undefined) await this.loadMe();
        if (!this.me || !this.me.name) return this.render();
        this.set({ kind: 'busy', text: `Checking your ${formatMs(p.timeMs)}…` });
        try {
            const r = await postRun(fromBase64(p.file));
            localStorage.removeItem(PENDING_KEY);
            const v = vehicleDef(r.vehicle).name;
            this.set({
                kind: 'done',
                text: r.best ? `On the board: #${r.rank.all} overall · #${r.rank.vehicle} on the ${v}` : `Your board time on the ${v}: ${formatMs(r.bestMs.vehicle)} (#${r.rank.vehicle})`,
            });
            await this.refresh();
        } catch (e) {
            const err = e instanceof ApiError ? e : new ApiError('error', String(e));
            // Kept for later: signed out, no name yet, offline. Dropped: refused or out of date.
            if (['rejected', 'stale', 'bad_run', 'banned'].includes(err.code)) localStorage.removeItem(PENDING_KEY);
            if (err.code === 'sign_in') this.me = null;
            if (err.code === 'sign_in' || err.code === 'need_name') this.set({ kind: 'idle' });
            else this.set({ kind: 'error', text: err.message });
        }
    }

    private async loadMe(): Promise<void> {
        try {
            this.me = await getMe();
        } catch (e) {
            if (e instanceof ApiError && e.code === 'sign_in') this.me = null;
        }
    }

    private async refresh(): Promise<void> {
        const [rows] = await Promise.all([getBoard('all').catch(() => null), this.loadMe()]);
        if (rows) this.onRows(rows, this.me ?? null);
        this.render();
    }

    private set(s: Status): void {
        this.state = s;
        this.render();
    }

    private render(): void {
        this.renderStatus();
    }

    private renderStatus(): void {
        this.status.replaceChildren(this.youLine());
    }

    /** Your part: sign in, pick a name, the post in progress / its result, your bests. */
    private youLine(): HTMLElement {
        const line = el('div', 'lb-you');
        const pending = loadPending();
        const pendingText = pending && pending.rules === RULES ? `${formatMs(pending.timeMs)} on the ${vehicleDef(pending.vehicle).name}` : null;
        if (this.me === null) {
            const a = el('a', 'pill sel', 'Sign in with freecode');
            (a as HTMLAnchorElement).href = signInUrl(location.pathname);
            line.append(a, el('span', '', pendingText ? ` to post your ${pendingText}` : ' to post your times'));
            return line;
        }
        if (this.me && (!this.me.name || this.editing)) {
            const form = el('form', 'lb-name');
            const input = el('input') as HTMLInputElement;
            input.maxLength = 20;
            input.placeholder = 'Board name';
            input.value = this.me.name ?? this.me.suggested;
            const save = el('button', 'pill sel', 'Save');
            form.append(el('span', '', this.me.name ? 'Board name ' : `Pick a board name${pendingText ? ` to post your ${pendingText}` : ''} `), input, save);
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                void (async () => {
                    try {
                        await setName(input.value);
                        this.editing = false;
                        await this.refresh();
                        await this.postPending();
                    } catch (err) {
                        this.set({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
                    }
                })();
            });
            line.append(form);
            if (this.state.kind === 'error') line.append(el('div', 'lb-msg error', this.state.text));
            return line;
        }
        if (this.state.kind !== 'idle') line.append(el('div', `lb-msg ${this.state.kind}`, this.state.text));
        if (this.me?.name && this.state.kind !== 'busy') {
            const edit = el('button', 'pill', 'Change name');
            edit.addEventListener('click', () => {
                this.editing = true;
                this.render();
            });
            line.append(el('span', '', `Posting as ${this.me.name} `), edit);
        }
        return line;
    }
}

function el(tag: string, cls = '', ...kids: (string | Node)[]): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.append(...kids);
    return e;
}

function loadPending(): Pending | null {
    try {
        return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as Pending | null;
    } catch {
        return null;
    }
}

function savePending(p: Pending): void {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
}

function toBase64(b: Uint8Array): string {
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
}

function fromBase64(s: string): Uint8Array {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
