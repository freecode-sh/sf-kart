/** Board names: 2-20 letters, digits, spaces and . _ -, starting with a letter or digit. */

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,19}$/u;

/** The name cleaned up (trimmed, single spaces), or null if it isn't allowed. */
export function cleanName(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
    return NAME.test(name) ? name : null;
}

/** A default board name from the account's name: its first word (so a full name isn't posted as is). */
export function suggestName(accountName: string): string {
    const first = accountName.trim().split(/\s+/)[0] ?? '';
    return cleanName(first.slice(0, 20)) ?? '';
}
