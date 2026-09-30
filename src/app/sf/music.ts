/**
 * A procedural race soundtrack for the San Francisco course (Web Audio, no samples): an upbeat
 * surf-rock / funk loop in D major at 150 bpm — synth drums, a driving bass, offbeat chord stabs
 * and a lead hook — with an intensity level (the lead joins on the bridge, extra drive for the
 * final stretch). Scheduled ahead of time on the audio clock.
 */

const BPM = 150;
const STEP = 60 / BPM / 4; // sixteenth note

// D major: chord roots (MIDI) and qualities for a 16-bar form (one chord per bar).
const PROG: [number, 'maj' | 'min'][] = [
    [50, 'maj'], [45, 'maj'], [47, 'min'], [43, 'maj'],
    [50, 'maj'], [45, 'maj'], [43, 'maj'], [45, 'maj'],
    [47, 'min'], [43, 'maj'], [50, 'maj'], [45, 'maj'],
    [47, 'min'], [42, 'min'], [43, 'maj'], [45, 'maj'],
];
// Lead hook (scale degrees relative to D, -1 = rest), 16 sixteenths per bar, 4-bar phrase.
const HOOK: number[][] = [
    [12, -1, 12, 14, -1, 16, -1, 14, 12, -1, 9, -1, 7, -1, 9, -1],
    [9, -1, 9, 12, -1, 14, -1, 12, 9, -1, 7, -1, 4, -1, -1, -1],
    [11, -1, 11, 12, -1, 14, -1, 16, 19, -1, 16, -1, 14, -1, 12, -1],
    [14, -1, 12, -1, 9, -1, 12, -1, 14, -1, -1, -1, -1, -1, -1, -1],
];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class SfMusic {
    private ctx: AudioContext | null = null;
    private out: GainNode | null = null;
    private noise: AudioBuffer | null = null;
    private timer = 0;
    private nextTime = 0;
    private step = 0;
    private playing = false;
    private volume = 0.6;
    /** 0: base groove, 1: + lead, 2: + lead and extra drive. */
    intensity = 0;

    /** Call from a user gesture. */
    unlock(): void {
        if (this.ctx) {
            void this.ctx.resume();
            return;
        }
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.out = ctx.createGain();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 3;
        this.out.connect(comp).connect(ctx.destination);
        this.out.gain.value = this.volume * 0.5;
        const len = ctx.sampleRate;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; ++i) d[i] = Math.random() * 2 - 1;
    }

    setVolume(v: number): void {
        this.volume = v;
        if (this.out && this.ctx) this.out.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.05);
    }

    play(): void {
        if (!this.ctx || this.playing) return;
        this.playing = true;
        this.step = 0;
        this.nextTime = this.ctx.currentTime + 0.05;
        this.out!.gain.cancelScheduledValues(this.ctx.currentTime);
        this.out!.gain.setValueAtTime(this.volume * 0.5, this.ctx.currentTime);
        this.timer = window.setInterval(() => this.schedule(), 25);
    }

    stop(fade = 0.3): void {
        if (!this.ctx || !this.playing) return;
        this.playing = false;
        clearInterval(this.timer);
        const t = this.ctx.currentTime;
        this.out!.gain.setTargetAtTime(0, t, fade / 3);
        window.setTimeout(() => {
            if (!this.playing && this.out && this.ctx) this.out.gain.setValueAtTime(this.volume * 0.5, this.ctx.currentTime);
        }, fade * 1000 + 100);
    }

    pause(): void {
        void this.ctx?.suspend();
    }

    resume(): void {
        if (this.playing) void this.ctx?.resume();
    }

    private schedule(): void {
        const ctx = this.ctx!;
        while (this.nextTime < ctx.currentTime + 0.12) {
            this.tick(this.step, this.nextTime);
            this.nextTime += STEP;
            ++this.step;
        }
    }

    private tick(step: number, t: number): void {
        const s16 = step % 16;
        const bar = Math.floor(step / 16) % 16;
        const [root, q] = PROG[bar]!;
        const third = q === 'maj' ? 4 : 3;
        // Drums.
        if (s16 === 0 || s16 === 8 || (s16 === 10 && bar % 2 === 1)) this.kick(t);
        if (s16 === 4 || s16 === 12) this.snare(t);
        if (s16 % 2 === 0 || this.intensity >= 2) this.hat(t, s16 % 4 === 2 ? 0.1 : 0.05);
        if (bar % 4 === 3 && s16 >= 12) this.snare(t, 0.35);
        // Bass: driving eighths, root / octave / fifth.
        if (s16 % 2 === 0) {
            const pat = [0, 0, 12, 0, 7, 0, 12, 7];
            this.bass(t, midiHz(root - 12 + pat[s16 / 2]!), STEP * 1.8);
        }
        // Chord stabs on the offbeats.
        if (s16 % 4 === 2) this.stab(t, [root + 12, root + 12 + third, root + 19], STEP * 1.2);
        // Lead hook.
        if (this.intensity >= 1) {
            const deg = HOOK[bar % 4]![s16]!;
            if (deg >= 0) {
                const scale = [0, 2, 4, 5, 7, 9, 11];
                const oct = Math.floor(deg / 7);
                const note = 62 + oct * 12 + scale[deg % 7]!;
                this.lead(t, midiHz(note), STEP * 1.7);
            }
        }
    }

    private env(t: number, peak: number, dur: number, attack = 0.005): GainNode {
        const g = this.ctx!.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        g.connect(this.out!);
        return g;
    }

    private kick(t: number): void {
        const o = this.ctx!.createOscillator();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        o.connect(this.env(t, 0.9, 0.22));
        o.start(t);
        o.stop(t + 0.25);
    }

    private noiseHit(t: number, peak: number, dur: number, type: BiquadFilterType, freq: number): void {
        const src = this.ctx!.createBufferSource();
        src.buffer = this.noise;
        const f = this.ctx!.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        src.connect(f).connect(this.env(t, peak, dur, 0.002));
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.02);
    }

    private snare(t: number, v = 0.5): void {
        this.noiseHit(t, v, 0.16, 'bandpass', 1800);
        const o = this.ctx!.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(190, t);
        o.connect(this.env(t, v * 0.5, 0.09));
        o.start(t);
        o.stop(t + 0.1);
    }

    private hat(t: number, v: number): void {
        this.noiseHit(t, v, 0.04, 'highpass', 7500);
    }

    private bass(t: number, hz: number, dur: number): void {
        const o = this.ctx!.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz;
        const f = this.ctx!.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(220, t + dur);
        o.connect(f).connect(this.env(t, 0.32, dur));
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    private stab(t: number, notes: number[], dur: number): void {
        for (const n of notes) {
            const o = this.ctx!.createOscillator();
            o.type = 'square';
            o.frequency.value = midiHz(n);
            const f = this.ctx!.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = 2400;
            o.connect(f).connect(this.env(t, 0.05, dur));
            o.start(t);
            o.stop(t + dur + 0.02);
        }
    }

    private lead(t: number, hz: number, dur: number): void {
        const o = this.ctx!.createOscillator();
        o.type = 'triangle';
        o.frequency.value = hz;
        const vib = this.ctx!.createOscillator();
        vib.frequency.value = 6;
        const vg = this.ctx!.createGain();
        vg.gain.value = hz * 0.006;
        vib.connect(vg).connect(o.frequency);
        const o2 = this.ctx!.createOscillator();
        o2.type = 'square';
        o2.frequency.value = hz * 1.003;
        const g2 = this.ctx!.createGain();
        g2.gain.value = 0.25;
        const e = this.env(t, 0.13, dur, 0.01);
        o.connect(e);
        o2.connect(g2).connect(e);
        for (const x of [o, o2, vib]) {
            x.start(t);
            x.stop(t + dur + 0.02);
        }
    }
}
