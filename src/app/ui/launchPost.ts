/**
 * The launch post on the title: an X post, embedded with X's own widget (platform.x.com/widgets.js,
 * loaded only when there is a post to show; do-not-track on). Until the widget draws it, and if it
 * never does, the post shows as a plain link.
 */

import { LAUNCH_POST_URL } from '../brand';
import { DEV_TOOLS } from '../devMode';
import { el } from './dom';

const WIDGETS = 'https://platform.x.com/widgets.js';

/** The post to show: brand.ts's, or (dev server) `?post=<url>`. */
function postUrl(): string | null {
    const dev = DEV_TOOLS ? new URLSearchParams(location.search).get('post') : null;
    const url = dev ?? LAUNCH_POST_URL;
    return url && /^https:\/\/(x|twitter)\.com\/\w+\/status\/\d+/.test(url) ? url : null;
}

let widgets: Promise<void> | null = null;
function loadWidgets(): Promise<void> {
    return (widgets ??= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = WIDGETS;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('widgets.js'));
        document.head.appendChild(s);
    }));
}

/** The embed, or null when there's no post. */
export function launchPost(): HTMLElement | null {
    const url = postUrl();
    if (!url) return null;
    const quote = el(
        'blockquote',
        { class: 'twitter-tweet', 'data-theme': 'light', 'data-dnt': 'true', 'data-conversation': 'none', 'data-width': '320' },
        el('a', { href: url }, 'The SF Kart launch post'),
    );
    const box = el('aside', { class: 'launch-post', 'aria-label': 'Launch post' }, quote);
    void loadWidgets()
        .then(() => (window as unknown as { twttr?: { widgets?: { load(el: Element): void } } }).twttr?.widgets?.load(box))
        .catch(() => {});
    return box;
}
