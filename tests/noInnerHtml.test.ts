/**
 * The UI puts text on the page as text only. Player names from the leaderboard will render on the
 * freecode.sh origin, so markup built at run time is a security boundary: every HTML sink in src/app
 * must be on the allowlist below, and allowlisted `innerHTML` writes may only take string literals
 * with no `${...}` in them. Build DOM with src/app/ui/dom.ts (`el`, `setChildren`) instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const APP = join(ROOT, 'src/app');

/** Sinks that parse a string as markup. */
const SINK = /\.innerHTML\s*[+]?=|\.outerHTML\s*[+]?=|insertAdjacentHTML|createContextualFragment|document\.write|DOMParser|\.srcdoc\s*=/g;

/** Allowed sinks: file → how many, and why. Keep this short. */
const ALLOW: Record<string, { count: number; why: string }> = {
    'src/app/ui/dom.ts': { count: 1, why: 'staticHtml(): parses compile-time constant markup (the HUD icons) into a template' },
};

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : /\.(ts|js)$/.test(f) ? [p] : [];
    });
}

/** Source with comments blanked (so documentation can name the sinks). */
function code(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('no markup from strings in src/app', () => {
    const found = new Map<string, { line: number; text: string }[]>();
    for (const f of files(APP)) {
        const rel = relative(ROOT, f);
        const src = code(readFileSync(f, 'utf8'));
        for (const m of src.matchAll(SINK)) {
            const line = src.slice(0, m.index).split('\n').length;
            const list = found.get(rel) ?? [];
            list.push({ line, text: src.split('\n')[line - 1]!.trim() });
            found.set(rel, list);
        }
    }

    it('uses HTML sinks only where allowlisted', () => {
        const bad = [...found].flatMap(([f, hits]) => (ALLOW[f] && hits.length <= ALLOW[f].count ? [] : hits.map((h) => `${f}:${h.line}  ${h.text}`)));
        expect(bad, 'build DOM with src/app/ui/dom.ts instead of parsing markup').toEqual([]);
    });

    it('writes only literal, uninterpolated strings to innerHTML (outside dom.ts)', () => {
        const bad: string[] = [];
        for (const f of files(APP)) {
            const rel = relative(ROOT, f);
            if (rel === 'src/app/ui/dom.ts') continue;
            const src = code(readFileSync(f, 'utf8'));
            for (const m of src.matchAll(/\.innerHTML\s*=\s*/g)) {
                const rest = src.slice(m.index + m[0].length);
                const literal = /^('[^'\\\n]*'|"[^"\\\n]*"|`[^`$\\]*`)\s*[;\n]/.exec(rest);
                if (!literal) bad.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('keeps the allowlist honest (no stale entries)', () => {
        for (const [f, { count }] of Object.entries(ALLOW)) expect(found.get(f)?.length ?? 0, f).toBe(count);
    });
});
