/**
 * Small DOM builders for the UI. Text always goes in as text (text nodes, `textContent`), never as
 * markup: player names and anything else from outside reach the page only this way. The one way to
 * insert markup is `staticHtml`, for compile-time constant strings (the HUD's SVG icons).
 * tests/noInnerHtml.test.ts holds src/app to this.
 */

/** A child: a node, or text (numbers too). null / undefined / false are skipped. */
export type Child = Node | string | number | null | undefined | false;

export interface Props {
    class?: string;
    /** Inline styles; custom properties (`--w`) work too. */
    style?: Record<string, string>;
    /** data-* attributes. */
    data?: Record<string, string>;
    on?: { [E in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[E]) => void };
    /** Any other attribute: true sets it empty, false / null / undefined leaves it off (aria-*: "true" / "false"). */
    [attr: string]: unknown;
}

const SPECIAL = new Set(['class', 'style', 'data', 'on']);

/** `<tag props>children</tag>`. Attributes go through setAttribute; event handlers only via `on`. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (props) {
        if (props.class) node.className = props.class;
        if (props.style) for (const [k, v] of Object.entries(props.style)) node.style.setProperty(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v);
        if (props.data) for (const [k, v] of Object.entries(props.data)) node.dataset[k] = v;
        if (props.on) for (const [k, f] of Object.entries(props.on)) node.addEventListener(k, f as EventListener);
        for (const [k, v] of Object.entries(props)) {
            if (SPECIAL.has(k) || v === null || v === undefined) continue;
            // (ARIA states are the strings "true" / "false".)
            if (typeof v === 'boolean' && k.startsWith('aria-')) {
                node.setAttribute(k, String(v));
                continue;
            }
            if (v === false) continue;
            // (Markup and inline script never go in through attributes.)
            if (/^on|^(innerhtml|outerhtml|srcdoc)$/i.test(k) || (/^(href|src|action)$/i.test(k) && /^\s*javascript:/i.test(String(v)))) {
                throw new Error(`el(): refusing attribute ${k}`);
            }
            node.setAttribute(k, v === true ? '' : String(v));
        }
    }
    node.append(...kids(children));
    return node;
}

function kids(children: Child[]): (Node | string)[] {
    const out: (Node | string)[] = [];
    for (const c of children) if (c !== null && c !== undefined && c !== false) out.push(typeof c === 'number' ? String(c) : c);
    return out;
}

/** Replaces an element's children (text stays text). */
export function setChildren(node: Element, ...children: Child[]): void {
    node.replaceChildren(...kids(children));
}

/** A `<button type="button">`. */
export function button(props: Props | null, ...children: Child[]): HTMLButtonElement {
    return el('button', { type: 'button', ...props }, ...children);
}

/** A key cap. */
export function kbd(key: string): HTMLElement {
    return el('kbd', null, key);
}

/** A link that opens in a new tab. */
export function extLink(href: string, ...children: Child[]): HTMLAnchorElement {
    return el('a', { href, target: '_blank', rel: 'noopener' }, ...children);
}

const parsed = new Map<string, DocumentFragment>();

/**
 * A copy of a fragment parsed from compile-time constant markup (static SVG icons). Never pass
 * anything built at run time: that is what `el` is for.
 */
export function staticHtml(markup: string): DocumentFragment {
    let frag = parsed.get(markup);
    if (!frag) {
        const t = document.createElement('template');
        t.innerHTML = markup;
        parsed.set(markup, (frag = t.content));
    }
    return frag.cloneNode(true) as DocumentFragment;
}
