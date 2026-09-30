/**
 * Procedural sound effects (Web Audio, no asset files). Continuous layers (engine, drift screech,
 * offroad rumble, boost roar) are driven every frame from the kart state; one-shots are triggered
 * by SimEvents.
 */

export type SimEvent =
    | { type: 'countdown'; n: number }
    | { type: 'go' }
    | { type: 'hop' }
    | { type: 'mtCharged' }
    | { type: 'mtBoost' }
    | { type: 'speedUp' }
    | { type: 'dashPanel' }
    | { type: 'startBoost' }
    | { type: 'burnout' }
    | { type: 'wall'; strength: number }
    | { type: 'land'; strength: number }
    | { type: 'takeoff' }
    | { type: 'trick' }
    /** A trick landed and gave its boost. */
    | { type: 'trickLand' }
    | { type: 'wheelie' }
    | { type: 'respawn' }
    | { type: 'lap'; lap: number; final: boolean }
    | { type: 'finish' }
    /** A speed-up pickup collected: stored, or the stock was full. */
    | { type: 'itemBox'; stored: boolean };

export interface AudioFrame {
    speed: number;
    throttle: boolean;
    grounded: boolean;
    drifting: boolean;
    mtChargeRatio: number;
    boosting: boolean;
    offroad: boolean;
    racing: boolean;
}

/** Engine sound: the e-bike's hub motor, the robotaxi's electric whine, the buggy's small putt-putt engine. */
export type EngineVoice = 'ebike' | 'ev' | 'putt';

const VOICES: Record<EngineVoice, { types: OscillatorType[]; mults: number[]; base: number; range: number; filter: number; filterRange: number; q: number; gain: number; putt: number }> = {
    ebike: { types: ['triangle', 'sine', 'sawtooth'], mults: [1, 2.01, 0.5], base: 110, range: 520, filter: 900, filterRange: 2200, q: 2, gain: 0.6, putt: 0 },
    ev: { types: ['sine', 'triangle', 'sine'], mults: [1, 2.02, 0.25], base: 170, range: 780, filter: 1800, filterRange: 3000, q: 1.5, gain: 0.8, putt: 0 },
    putt: { types: ['square', 'sawtooth', 'square'], mults: [1, 1.02, 0.5], base: 34, range: 62, filter: 260, filterRange: 900, q: 6, gain: 1.15, putt: 0.75 },
};

export class AudioEngine {
    private ctx: AudioContext | null = null;
    private master!: GainNode;
    private noise!: AudioBuffer;
    private engineOsc: OscillatorNode[] = [];
    private engineGain!: GainNode;
    private engineFilter!: BiquadFilterNode;
    private screechGain!: GainNode;
    private screechFilter!: BiquadFilterNode;
    private rumbleGain!: GainNode;
    private boostGain!: GainNode;
    private boostFilter!: BiquadFilterNode;
    private rev = 0;
    private voice: EngineVoice = 'ebike';
    /** Tremolo on the engine (the putt-putt of a small engine's firing). */
    private puttLfo!: OscillatorNode;
    private puttDepth!: GainNode;
    private volume = 0.6;
    private muted = false;

    /** Must be called from a user gesture (browser autoplay policy). */
    unlock(): void {
        if (this.ctx) {
            void this.ctx.resume();
            return;
        }
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        const comp = ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(ctx.destination);

        const len = ctx.sampleRate * 2;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; ++i) d[i] = Math.random() * 2 - 1;

        // Engine: the voice's three oscillators, through a lowpass that opens with revs.
        this.engineFilter = ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 600;
        this.engineFilter.Q.value = VOICES[this.voice].q;
        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0;
        const putt = ctx.createGain();
        this.engineFilter.connect(putt).connect(this.engineGain).connect(this.master);
        this.puttLfo = ctx.createOscillator();
        this.puttLfo.type = 'square';
        this.puttDepth = ctx.createGain();
        this.puttDepth.gain.value = 0;
        this.puttLfo.connect(this.puttDepth).connect(putt.gain);
        this.puttLfo.start();
        const { types, mults } = VOICES[this.voice];
        types.forEach((t, i) => {
            const o = ctx.createOscillator();
            o.type = t;
            o.frequency.value = 60 * mults[i]!;
            const g = ctx.createGain();
            g.gain.value = i === 2 ? 0.35 : 0.25;
            o.connect(g).connect(this.engineFilter);
            o.start();
            this.engineOsc.push(o);
        });

        // Tire screech: band-passed noise.
        this.screechFilter = ctx.createBiquadFilter();
        this.screechFilter.type = 'bandpass';
        this.screechFilter.frequency.value = 2400;
        this.screechFilter.Q.value = 8;
        this.screechGain = ctx.createGain();
        this.screechGain.gain.value = 0;
        this.loopNoise().connect(this.screechFilter).connect(this.screechGain).connect(this.master);

        // Offroad rumble: low-passed noise.
        const rumbleFilter = ctx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 220;
        this.rumbleGain = ctx.createGain();
        this.rumbleGain.gain.value = 0;
        this.loopNoise().connect(rumbleFilter).connect(this.rumbleGain).connect(this.master);

        // Boost roar: noise through a moving lowpass.
        this.boostFilter = ctx.createBiquadFilter();
        this.boostFilter.type = 'lowpass';
        this.boostFilter.frequency.value = 900;
        this.boostGain = ctx.createGain();
        this.boostGain.gain.value = 0;
        this.loopNoise().connect(this.boostFilter).connect(this.boostGain).connect(this.master);
    }

    setVolume(v: number): void {
        this.volume = v;
        if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.02);
    }

    setMuted(m: boolean): void {
        this.muted = m;
        this.setVolume(this.volume);
    }

    setEngineVoice(v: EngineVoice): void {
        this.voice = v;
        if (!this.ctx) return;
        const def = VOICES[v];
        this.engineOsc.forEach((o, i) => (o.type = def.types[i]!));
        this.engineFilter.Q.value = def.q;
    }

    private loopNoise(): AudioBufferSourceNode {
        const src = this.ctx!.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.start(0, Math.random() * 1.5);
        return src;
    }

    /** Silences continuous layers (menu open, paused). */
    quiet(): void {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        for (const g of [this.engineGain, this.screechGain, this.rumbleGain, this.boostGain]) {
            g.gain.setTargetAtTime(0, t, 0.05);
        }
    }

    update(f: AudioFrame): void {
        const ctx = this.ctx;
        if (!ctx || ctx.state !== 'running') return;
        const t = ctx.currentTime;
        const tc = 0.03;

        // Revs follow throttle before the race (so you can hear the start-boost charge) and speed after.
        const target = f.racing ? Math.min(1.25, Math.abs(f.speed) / 84) : f.throttle ? 0.9 : 0.05;
        this.rev += (target - this.rev) * (f.racing ? 0.25 : f.throttle ? 0.06 : 0.1);
        const airborne = f.racing && !f.grounded ? 1.08 : 1;
        const v = VOICES[this.voice];
        const base = (v.base + this.rev * v.range) * airborne * (f.boosting ? 1.12 : 1);
        this.engineOsc.forEach((o, i) => {
            o.frequency.setTargetAtTime(base * v.mults[i]!, t, tc);
        });
        this.engineFilter.frequency.setTargetAtTime(v.filter + this.rev * v.filterRange + (f.throttle ? 500 : 0), t, tc);
        this.engineGain.gain.setTargetAtTime((0.12 + this.rev * 0.1 + (f.throttle ? 0.05 : 0)) * v.gain, t, tc);
        // Putt-putt: one pulse per firing, fading into a buzz at high revs. The e-bike's freewheel
        // ticks instead when you coast.
        const coast = this.voice === 'ebike' && !f.throttle && f.racing && Math.abs(f.speed) > 5;
        this.puttLfo.frequency.setTargetAtTime(coast ? 8 + Math.abs(f.speed) * 0.25 : base * 0.5, t, tc);
        this.puttDepth.gain.setTargetAtTime(coast ? 0.45 : v.putt * (1 - Math.min(0.7, this.rev * 0.5)) * 0.5, t, tc);

        const screech = f.drifting && f.grounded ? 0.05 + f.mtChargeRatio * 0.07 : 0;
        this.screechGain.gain.setTargetAtTime(screech, t, 0.04);
        this.screechFilter.frequency.setTargetAtTime(f.mtChargeRatio >= 1 ? 3600 : 2200 + f.mtChargeRatio * 900, t, 0.05);

        const rumble = f.offroad && f.grounded ? Math.min(0.5, 0.15 + Math.abs(f.speed) / 150) : 0;
        this.rumbleGain.gain.setTargetAtTime(rumble, t, 0.05);

        this.boostGain.gain.setTargetAtTime(f.boosting ? 0.18 : 0, t, f.boosting ? 0.02 : 0.15);
        this.boostFilter.frequency.setTargetAtTime(f.boosting ? 2600 : 600, t, 0.1);
    }

    event(e: SimEvent): void {
        if (!this.ctx || this.ctx.state !== 'running') return;
        switch (e.type) {
            case 'countdown':
                this.beep(440, 0.16, 0.35);
                break;
            case 'go':
                this.beep(880, 0.55, 0.4);
                break;
            case 'hop':
                if (this.voice === 'ebike') this.bell();
                else this.blip(300, 520, 0.07, 0.12);
                break;
            case 'mtCharged':
                this.sparkle(0.18);
                break;
            case 'mtBoost':
                this.whoosh(0.35, 0.5);
                break;
            case 'startBoost':
                this.whoosh(0.5, 0.6);
                this.chord([523, 784], 0.25, 0.12);
                break;
            case 'dashPanel':
                this.whoosh(0.45, 0.6);
                this.blip(600, 1200, 0.18, 0.15);
                break;
            case 'speedUp':
                this.blip(220, 660, 0.12, 0.3);
                this.whoosh(0.6, 0.7);
                break;
            case 'burnout':
                this.sputter();
                break;
            case 'wall':
                this.thud(0.25 + Math.min(0.6, e.strength / 80), 90);
                break;
            case 'land':
                this.thud(Math.min(0.5, 0.12 + e.strength / 40), 70);
                break;
            case 'takeoff':
                this.whoosh(0.25, 0.25);
                break;
            case 'trick':
                // A quick rising swish and a bright blip as the vehicle starts its trick.
                this.noiseBurst('bandpass', 900, 5200, 0.22, 0.28);
                this.blip(620, 1560, 0.16, 0.16);
                break;
            case 'trickLand':
                // Landed it: a two-note sting on top of the boost whoosh.
                this.whoosh(0.4, 0.55);
                this.beep(988, 0.09, 0.16);
                setTimeout(() => this.beep(1319, 0.16, 0.18), 70);
                break;
            case 'wheelie':
                this.blip(140, 260, 0.2, 0.12);
                break;
            case 'respawn':
                this.blip(900, 300, 0.5, 0.2);
                break;
            case 'lap':
                if (e.final) this.chord([523, 659, 784, 1047], 0.9, 0.18);
                else this.chord([659, 988], 0.35, 0.18);
                break;
            case 'finish':
                this.arpeggio([523, 659, 784, 1047, 1319], 0.09, 0.2);
                break;
            case 'itemBox':
                // Speed-up pickup, in the vehicle's own sound: a charge-up zap (battery), a
                // glug-and-whoosh (gas), a steamy hiss and a lid pop (coffee).
                if (this.voice === 'ev') {
                    this.zap();
                    this.sparkle(0.16);
                } else if (this.voice === 'putt') {
                    this.blip(180, 90, 0.08, 0.3);
                    setTimeout(() => this.blip(160, 80, 0.08, 0.26), 70);
                    this.noiseBurst('lowpass', 300, 2400, 0.4, 0.5);
                } else {
                    this.noiseBurst('highpass', 3000, 6000, 0.45, 0.22);
                    this.blip(700, 1500, 0.05, 0.22);
                }
                break;
        }
    }

    // ---- one-shot synth helpers ----

    private env(g: GainNode, peak: number, attack: number, decay: number): void {
        const t = this.ctx!.currentTime;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    private beep(freq: number, dur: number, vol: number): void {
        const ctx = this.ctx!;
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = freq;
        const g = ctx.createGain();
        o.connect(g).connect(this.master);
        this.env(g, vol * 0.5, 0.005, dur);
        o.start();
        o.stop(ctx.currentTime + dur + 0.05);
    }

    private blip(f0: number, f1: number, dur: number, vol: number): void {
        const ctx = this.ctx!;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const g = ctx.createGain();
        o.connect(g).connect(this.master);
        this.env(g, vol, 0.005, dur);
        o.start();
        o.stop(t + dur + 0.05);
    }

    /** A bicycle bell: two inharmonic partials ringing out. */
    private bell(): void {
        const ctx = this.ctx!;
        for (const [f, v] of [[2350, 0.14], [3140, 0.08], [5200, 0.03]] as const) {
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = f;
            const g = ctx.createGain();
            o.connect(g).connect(this.master);
            this.env(g, v, 0.003, 0.7);
            o.start();
            o.stop(ctx.currentTime + 0.8);
        }
    }

    private chord(freqs: number[], dur: number, vol: number): void {
        for (const f of freqs) this.beep(f, dur, vol);
    }

    private arpeggio(freqs: number[], step: number, vol: number): void {
        freqs.forEach((f, i) => setTimeout(() => this.beep(f, 0.3, vol), i * step * 1000));
    }

    /** Electric charge-up: a buzzing saw sweeping up. */
    private zap(): void {
        const ctx = this.ctx!;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(1760, t + 0.22);
        const filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = 1800;
        filt.Q.value = 1.2;
        const g = ctx.createGain();
        o.connect(filt).connect(g).connect(this.master);
        this.env(g, 0.22, 0.005, 0.25);
        o.start();
        o.stop(t + 0.3);
    }

    private sparkle(vol: number): void {
        [1568, 2093, 2637].forEach((f, i) => setTimeout(() => this.beep(f, 0.08, vol), i * 40));
    }

    private noiseBurst(filterType: BiquadFilterType, f0: number, f1: number, dur: number, vol: number): void {
        const ctx = this.ctx!;
        const t = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const filt = ctx.createBiquadFilter();
        filt.type = filterType;
        filt.frequency.setValueAtTime(f0, t);
        filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const g = ctx.createGain();
        src.connect(filt).connect(g).connect(this.master);
        this.env(g, vol, 0.01, dur);
        src.start(0, Math.random());
        src.stop(t + dur + 0.1);
    }

    private whoosh(dur: number, vol: number): void {
        this.noiseBurst('bandpass', 400, 3500, dur, vol);
    }

    private thud(vol: number, freq: number): void {
        this.noiseBurst('lowpass', 900, 120, 0.18, vol);
        this.blip(freq * 1.6, freq * 0.6, 0.15, vol * 0.8);
    }

    private sputter(): void {
        for (let i = 0; i < 6; ++i) {
            setTimeout(() => this.noiseBurst('lowpass', 500, 150, 0.07, 0.35), i * 90);
        }
    }
}
