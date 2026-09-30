/**
 * SF Kart's identity: the "SF KART" name (Archivo black italic, ink) with the lap as its symbol, the
 * "by freecode" lockup (freecode's mark and wordmark as freecode.sh ships them, never redrawn: the
 * wordmark is a mask filled with the text colour, as on freecode.sh) with the source's GitHub link
 * beside it, and the loading card.
 */

import { FREECODE_URL, SOURCE_URL } from '../brand';
import { lapMark } from './chart';
import { el } from './dom';
import markUrl from './brand/freecode-mark.svg';
import wordmarkUrl from './brand/freecode-wordmark.svg';
import githubUrl from './brand/github-mark.svg';

/** "SF KART", with the lap before it unless `bare` (where a chart beside it already is the lap). */
export function wordmark(size: 'big' | 'small' = 'big', bare = false): HTMLElement {
    return el('div', { class: `wordmark ${size}` }, bare ? null : lapMark(size === 'big' ? 56 : 30), el('span', { class: 'wordmark-name' }, 'SF KART'));
}

/** [GitHub] | "by [freecode]": the source on GitHub, then freecode's mark and wordmark, linking to freecode.sh. */
export function freecodeLockup(): HTMLElement {
    return el(
        'div',
        { class: 'fc-lockup' },
        el(
            'a',
            { class: 'gh-link', href: SOURCE_URL, target: '_blank', rel: 'noopener', title: 'Source on GitHub' },
            el('span', { class: 'gh-mark', style: { '--mark': `url("${githubUrl}")` }, role: 'img', 'aria-label': 'GitHub' }),
        ),
        el('span', { class: 'fc-rule', 'aria-hidden': 'true' }),
        el(
            'a',
            { class: 'fc-link', href: FREECODE_URL, target: '_blank', rel: 'noopener' },
            el('span', null, 'by'),
            el('img', { class: 'fc-mark', src: markUrl, alt: '', width: 1024, height: 1024 }),
            el('span', { class: 'fc-wordmark', style: { '--wordmark': `url("${wordmarkUrl}")` }, role: 'img', 'aria-label': 'freecode' }),
        ),
    );
}

/** The loading card: the name and a status line, where the menus' card sits. */
export function loadingScreen(status: string): HTMLElement {
    return el('div', { class: 'loading', role: 'status' }, el('div', { class: 'card' }, wordmark('small'), el('div', { class: 'loading-status' }, status)), freecodeLockup());
}
