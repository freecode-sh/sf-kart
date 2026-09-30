/**
 * Port of Kinoko's egg/core/BitFlag.hh.
 *
 * TBitFlag<T, E> holds up to 32 bits in a number; TBitFlagExt<N, E> holds an arbitrary number of
 * bits. Both take enum values (numbers) as bit indices. Variadic C++ calls map to rest params:
 *   status.onBit(eStatus.A, eStatus.B)   // any on
 *   status.offBit(eStatus.A, eStatus.B)  // all off
 */

export class TBitFlag<E extends number = number> {
    bits = 0;

    constructor(mask = 0) {
        this.bits = mask >>> 0;
    }

    static fromBits<E extends number>(...es: E[]): TBitFlag<E> {
        const f = new TBitFlag<E>();
        f.setBit(...es);
        return f;
    }

    clone(): TBitFlag<E> {
        return new TBitFlag<E>(this.bits);
    }

    copy(rhs: TBitFlag<E>): this {
        this.bits = rhs.bits;
        return this;
    }

    setBit(...es: E[]): this {
        for (const e of es) this.bits = (this.bits | makeMask32(e)) >>> 0;
        return this;
    }

    resetBit(...es: E[]): this {
        for (const e of es) this.bits = (this.bits & ~makeMask32(e)) >>> 0;
        return this;
    }

    changeBit(on: boolean, ...es: E[]): this {
        return on ? this.setBit(...es) : this.resetBit(...es);
    }

    toggleBit(...es: E[]): this {
        for (const e of es) this.changeBit(this.offBit(e), e);
        return this;
    }

    /** True if any of the given bits are on. */
    onBit(...es: E[]): boolean {
        return this.onAnyBit(...es);
    }

    onAnyBit(...es: E[]): boolean {
        for (const e of es) if ((this.bits & makeMask32(e)) !== 0) return true;
        return false;
    }

    onAllBit(...es: E[]): boolean {
        for (const e of es) if ((this.bits & makeMask32(e)) === 0) return false;
        return true;
    }

    /** True if all of the given bits are off. */
    offBit(...es: E[]): boolean {
        return this.offAllBit(...es);
    }

    offAllBit(...es: E[]): boolean {
        for (const e of es) if ((this.bits & makeMask32(e)) !== 0) return false;
        return true;
    }

    offAnyBit(...es: E[]): boolean {
        for (const e of es) if ((this.bits & makeMask32(e)) === 0) return true;
        return false;
    }

    maskBit(...es: E[]): number {
        return (this.bits & this.makeMask(...es)) >>> 0;
    }

    makeMask(...es: E[]): number {
        let m = 0;
        for (const e of es) m = (m | makeMask32(e)) >>> 0;
        return m;
    }

    set(mask: number): this {
        this.bits = (this.bits | mask) >>> 0;
        return this;
    }

    reset(mask: number): this {
        this.bits = (this.bits & ~mask) >>> 0;
        return this;
    }

    change(on: boolean, mask: number): this {
        return on ? this.set(mask) : this.reset(mask);
    }

    on(mask: number): boolean {
        return (this.bits & mask) !== 0;
    }

    onAll(mask: number): boolean {
        return (this.bits | mask) >>> 0 === this.bits;
    }

    off(mask: number): boolean {
        return (this.bits & mask) === 0;
    }

    makeAllZero(): void {
        this.bits = 0;
    }

    getDirect(): number {
        return this.bits;
    }

    setDirect(mask: number): void {
        this.bits = mask >>> 0;
    }
}

function makeMask32(e: number): number {
    if (e < 0 || e >= 32) throw new Error(`TBitFlag: bit ${e} out of range`);
    return (1 << e) >>> 0;
}

export class TBitFlagExt<E extends number = number> {
    private readonly words: Uint32Array;

    constructor(readonly N: number) {
        this.words = new Uint32Array(Math.ceil(N / 32));
    }

    clone(): TBitFlagExt<E> {
        const f = new TBitFlagExt<E>(this.N);
        f.words.set(this.words);
        return f;
    }

    copy(rhs: TBitFlagExt<E>): this {
        this.words.set(rhs.words);
        return this;
    }

    makeAllZero(): this {
        this.words.fill(0);
        return this;
    }

    setBit(...es: E[]): this {
        for (const e of es) this.words[this.idx(e)]! |= 1 << (e % 32);
        return this;
    }

    resetBit(...es: E[]): this {
        for (const e of es) this.words[this.idx(e)]! &= ~(1 << (e % 32));
        return this;
    }

    changeBit(on: boolean, ...es: E[]): this {
        return on ? this.setBit(...es) : this.resetBit(...es);
    }

    /** True if any of the given bits are on. */
    onBit(...es: E[]): boolean {
        return this.onAnyBit(...es);
    }

    onAnyBit(...es: E[]): boolean {
        for (const e of es) if (this.test(e)) return true;
        return false;
    }

    onAllBit(...es: E[]): boolean {
        for (const e of es) if (!this.test(e)) return false;
        return true;
    }

    /** True if all of the given bits are off. */
    offBit(...es: E[]): boolean {
        return this.offAllBit(...es);
    }

    offAllBit(...es: E[]): boolean {
        for (const e of es) if (this.test(e)) return false;
        return true;
    }

    offAnyBit(...es: E[]): boolean {
        for (const e of es) if (!this.test(e)) return true;
        return false;
    }

    private test(e: number): boolean {
        return (this.words[this.idx(e)]! & (1 << (e % 32))) !== 0;
    }

    private idx(e: number): number {
        if (e < 0 || e >= this.N) throw new Error(`TBitFlagExt: bit ${e} out of range`);
        return Math.floor(e / 32);
    }
}
