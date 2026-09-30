/**
 * Port of Kinoko source/game/system/KPadController.{hh,cc}.
 *
 * TS additions (marked below) on KPadHostController allow live play to feed raw, ghost-format
 * inputs that are decoded exactly like the ghost path (see `setRawInputs`).
 */

import { fr } from '../../egg/math/Math';
import { Vector2f } from '../../egg/math/Vector';
import { RamStream } from '../../egg/util/Stream';
import { RKG_UNCOMPRESSED_INPUT_DATA_SECTION_SIZE } from './GhostFile';

/**
 * Converts a raw stick input into an input usable by the state.
 * @param rawStick The raw stick input to convert.
 */
export function RawStickToState(rawStick: number): number {
    return fr(fr(fr(rawStick & 0xff) - 7.0) / 7.0);
}

export enum ControlSource {
    Unknown = -1,
    Core = 0, // WiiMote
    Freestyle = 1, // WiiMote + Nunchuk
    Classic = 2,
    Gamecube = 3,
    Ghost = 4,
    AI = 5,
    Host = 6, // Added in Kinoko, represents an external program
}

export enum Trick {
    None = 0,
    Up = 1,
    Down = 2,
    Left = 3,
    Right = 4,
}

/** Represents a set of controller inputs. */
export class RaceInputState {
    buttons = 0; // u16
    buttonsRaw = 0; // u16
    stick = new Vector2f();
    stickXRaw = 7; // u8
    stickYRaw = 7; // u8
    trick: Trick = Trick.None;
    trickRaw = 0; // u8

    constructor() {
        this.reset();
    }

    /** C++ copy assignment. */
    copy(rhs: Readonly<RaceInputState>): this {
        this.buttons = rhs.buttons;
        this.buttonsRaw = rhs.buttonsRaw;
        this.stick.copy(rhs.stick);
        this.stickXRaw = rhs.stickXRaw;
        this.stickYRaw = rhs.stickYRaw;
        this.trick = rhs.trick;
        this.trickRaw = rhs.trickRaw;
        return this;
    }

    clone(): RaceInputState {
        return new RaceInputState().copy(this);
    }

    /** @addr{0x8051E85C} */
    reset(): void {
        this.buttons = 0;
        this.buttonsRaw = 0;
        this.stick.copy(Vector2f.zero);
        this.stickXRaw = 7;
        this.stickYRaw = 7;
        this.trick = Trick.None;
        this.trickRaw = 0;
    }

    /** Checks if the input state is valid. */
    isValid(): boolean {
        if (!this.isButtonsValid()) {
            return false;
        }

        if (!this.isStickValid(this.stick.x) || !this.isStickValid(this.stick.y)) {
            return false;
        }

        if (!this.isTrickValid()) {
            return false;
        }

        return true;
    }

    /** Checks if there are any invalid buttons. */
    isButtonsValid(): boolean {
        return !(this.buttons & ~0xf);
    }

    /** Checks if the stick values are within the domain of the physics engine. */
    isStickValid(stick: number): boolean {
        if (stick > 1.0 || stick < -1.0) {
            return false;
        }

        for (let i = 0; i <= 14; ++i) {
            const s = RawStickToState(i);
            if (Number.isNaN(stick)) {
                throw new Error('RaceInputState: NaN stick');
            }

            if (stick === s) {
                return true;
            } else if (stick < s) {
                return false;
            }
        }

        // This is unreachable
        return false;
    }

    /** Checks if the trick input is valid. */
    isTrickValid(): boolean {
        switch (this.trick) {
            case Trick.None:
            case Trick.Up:
            case Trick.Down:
            case Trick.Left:
            case Trick.Right:
                return true;
            default:
                return false;
        }
    }

    accelerate(): boolean {
        return !!(this.buttons & 0x1);
    }

    brake(): boolean {
        return !!(this.buttons & 0x2);
    }

    item(): boolean {
        return !!(this.buttons & 0x4);
    }

    drift(): boolean {
        return !!(this.buttons & 0x8);
    }

    trickUp(): boolean {
        return this.trick === Trick.Up;
    }

    trickDown(): boolean {
        return this.trick === Trick.Down;
    }
}

const U32_MAX = 0xffffffff;

/** Represents a stream of button inputs from a ghost file. */
export class KPadGhostButtonsStream {
    buffer: RamStream = new RamStream(new Uint8Array(0));
    currentSequence: number; // u32
    readSequenceFrames = 0; // u16
    state: number; // u32
    /**
     * TS addition: the whole ghost input buffer and this stream's start offset within it. C++'s
     * RamStream reads are unchecked, so reading past a stream's end (e.g. a stream with zero
     * tuples) reads the following bytes of the ghost buffer. We replicate that.
     */
    m_parentBuffer: Uint8Array | null = null;
    m_parentOffset = 0;

    constructor() {
        this.currentSequence = U32_MAX;
        this.state = 2;
    }

    private readSequence(): number {
        if (this.buffer.safe(2) || !this.m_parentBuffer) {
            return this.buffer.read_u16();
        }

        const at = this.m_parentOffset + this.buffer.index();
        const p = this.m_parentBuffer;
        this.buffer.skip(2);
        return (((p[at] ?? 0) << 8) | (p[at + 1] ?? 0)) & 0xffff;
    }

    /**
     * Reads the data from the corresponding tuple in the buffer.
     * @addr{0x80520D4C} @addr{0x80522C5C} @addr{0x80522F40}
     */
    readFrame(): number {
        if (this.state !== 1) {
            return 0;
        }

        if (this.currentSequence === U32_MAX) {
            this.readSequenceFrames = 0;
            this.currentSequence = this.readSequence();
        } else {
            if (this.readIsNewSequence()) {
                this.readSequenceFrames = 0;
                this.currentSequence = this.readSequence();
            }
        }

        this.readSequenceFrames = (this.readSequenceFrames + 1) & 0xffff;

        // In the base game, this check normally occurs before a new sequence is read. As a result,
        // the base game does not know that it has run out of inputs until the frame that it tries
        // to access past the last valid input. We stray from this behavior so that we can know when
        // we are on the last frame of input.
        if (this.buffer.eof() && this.readIsNewSequence()) {
            this.state = 2;
        }

        return this.readVal();
    }

    /** @addr{0x8052502C} @addr{0x80524FC4} */
    readIsNewSequence(): boolean {
        return this.readSequenceFrames >= (this.currentSequence & 0xff);
    }

    /** @addr{0x80525024} @addr{0x80524FBC} */
    readVal(): number {
        return (this.currentSequence >>> 8) & 0xff;
    }
}

/** A specialized stream for button presses (not tricks). */
export class KPadGhostFaceButtonsStream extends KPadGhostButtonsStream {}

/** A specialized stream for the analog stick. */
export class KPadGhostDirectionButtonsStream extends KPadGhostButtonsStream {}

/** A specialized stream for D-Pad inputs for tricking and wheeling. */
export class KPadGhostTrickButtonsStream extends KPadGhostButtonsStream {
    /** @addr{0x805250A8} */
    override readIsNewSequence(): boolean {
        let duration = this.currentSequence & 0xff;
        duration = (duration + 256 * ((this.currentSequence >>> 8) & 0xf)) & 0xffff;
        return duration <= this.readSequenceFrames;
    }

    /** @addr{0x8052509C} */
    override readVal(): number {
        return ((this.currentSequence >>> 0x8) & ~0x80) & 0xff;
    }
}

/** An abstraction for a controller object. It is associated with an input state. */
export class KPadController {
    /** The current inputs from this controller. */
    protected m_raceInputState = new RaceInputState();
    /** Whether the controller is active. */
    protected m_connected: boolean;
    /** True for auto transmission, false for manual. */
    protected m_driftIsAuto = false;

    /** @addr{0x8051EBA8} */
    constructor() {
        this.m_connected = false;
    }

    /** @addr{0x8051CE7C} */
    controlSource(): ControlSource {
        return ControlSource.Unknown;
    }

    reset(_driftIsAuto: boolean): void {}
    calcImpl(): void {}

    /** @addr{0x8051ED14} */
    calc(): void {
        this.calcImpl();
    }

    raceInputState(): Readonly<RaceInputState> {
        return this.m_raceInputState;
    }

    /** @addr{0x8051F37C} */
    setDriftIsAuto(driftIsAuto: boolean): void {
        this.m_driftIsAuto = driftIsAuto;
    }

    driftIsAuto(): boolean {
        return this.m_driftIsAuto;
    }
}

/** Decodes a ghost trick byte (as read from the trick stream) into the Trick enum. */
function DecodeTrick(trickRaw: number): Trick {
    switch (trickRaw >> 4) {
        case 1:
            return Trick.Up;
        case 2:
            return Trick.Down;
        case 3:
            return Trick.Left;
        case 4:
            return Trick.Right;
        default:
            return Trick.None;
    }
}

/** The abstraction of a controller object but for ghost playback. */
export class KPadGhostController extends KPadController {
    private m_ghostBuffer: Uint8Array | null = null;
    private m_buttonsStreams: KPadGhostButtonsStream[];
    private m_acceptingInputs: boolean;

    /** @addr{0x80520730} */
    constructor() {
        super();
        this.m_acceptingInputs = false;
        this.m_buttonsStreams = [
            new KPadGhostFaceButtonsStream(),
            new KPadGhostDirectionButtonsStream(),
            new KPadGhostTrickButtonsStream(),
        ];
    }

    /** @addr{0x8052282C} */
    override controlSource(): ControlSource {
        return ControlSource.Ghost;
    }

    /** @addr{0x80520998} */
    override reset(driftIsAuto: boolean): void {
        this.m_driftIsAuto = driftIsAuto;
        this.m_raceInputState.reset();

        for (const stream of this.m_buttonsStreams) {
            stream.currentSequence = 0;
            stream.readSequenceFrames = 0;
            stream.state = 1;
        }

        this.m_acceptingInputs = false;
        this.m_connected = true;
    }

    /**
     * Reads in the raw input data section from the ghost RKG file.
     * @addr{Inlined in 0x80521844}
     */
    readGhostBuffer(buffer: Uint8Array, driftIsAuto: boolean): void {
        const SEQUENCE_SIZE = 0x2;

        this.m_ghostBuffer = buffer;
        this.m_driftIsAuto = driftIsAuto;

        const stream = RamStream.from(buffer, 0, RKG_UNCOMPRESSED_INPUT_DATA_SECTION_SIZE);

        const faceCount = stream.read_u16();
        const directionCount = stream.read_u16();
        const trickCount = stream.read_u16();

        stream.skip(2);

        const counts = [faceCount, directionCount, trickCount];
        for (let i = 0; i < 3; ++i) {
            const s = this.m_buttonsStreams[i]!;
            s.m_parentBuffer = buffer;
            s.m_parentOffset = stream.index();
            s.buffer = stream.split(counts[i]! * SEQUENCE_SIZE);
        }
    }

    /** @addr{0x80520B9C} */
    override calcImpl(): void {
        if (!this.m_ghostBuffer || !this.m_acceptingInputs) {
            return;
        }

        const state = this.m_raceInputState;
        state.buttons = this.m_buttonsStreams[0]!.readFrame();
        const sticks = this.m_buttonsStreams[1]!.readFrame();
        state.stickXRaw = (sticks >> 4) & 0xf;
        state.stickYRaw = sticks & 0xf;
        state.stick.set(RawStickToState(state.stickXRaw), RawStickToState(state.stickYRaw));
        state.trickRaw = this.m_buttonsStreams[2]!.readFrame();
        state.trick = DecodeTrick(state.trickRaw);
    }

    setAcceptingInputs(set: boolean): void {
        this.m_acceptingInputs = set;
    }
}

/**
 * The abstraction of a controller object but for external usage.
 * The input state is managed externally by programs interfacing with Kinoko.
 */
export class KPadHostController extends KPadController {
    // ---- TS additions for live play (raw, ghost-format input path) ----
    /** Whether a raw state was provided via setRawInputs (enables the ghost-style decode). */
    private m_hasRawState = false;
    /** Mirrors KPadGhostController::m_acceptingInputs (set by KPadPlayer::startGhostProxy). */
    private m_acceptingInputs = false;
    private m_rawButtons = 0;
    private m_rawStickX = 7;
    private m_rawStickY = 7;
    private m_rawTrick = 0;

    override controlSource(): ControlSource {
        return ControlSource.Host;
    }

    override reset(driftIsAuto: boolean): void {
        this.m_driftIsAuto = driftIsAuto;
        this.m_raceInputState.reset();
        this.m_connected = true;
        this.m_acceptingInputs = false;
    }

    /**
     * Sets the inputs of the controller (C++ overloads):
     *   setInputs(state: RaceInputState)
     *   setInputs(buttons, stick: Vector2f, trick)
     *   setInputs(buttons, stickX: f32, stickY: f32, trick)
     * @return Input state validity.
     */
    setInputs(state: Readonly<RaceInputState>): boolean;
    setInputs(buttons: number, stick: Readonly<Vector2f>, trick: Trick): boolean;
    setInputs(buttons: number, stickX: number, stickY: number, trick: Trick): boolean;
    setInputs(
        a: number | Readonly<RaceInputState>,
        b?: number | Readonly<Vector2f>,
        c?: number,
        d?: Trick,
    ): boolean {
        if (typeof a !== 'number') {
            return this.setInputs(a.buttons, a.stick, a.trick);
        }

        const state = this.m_raceInputState;
        state.buttons = a & 0xffff;
        if (typeof b === 'number') {
            state.stick.x = b;
            state.stick.y = c!;
            state.trick = d!;
        } else {
            state.stick.copy(b!);
            state.trick = c as Trick;
        }

        return state.isValid();
    }

    /** @param stickXRaw The 7-centered raw stick input on the X axis. */
    setInputsRawStick(buttons: number, stickXRaw: number, stickYRaw: number, trick: Trick): boolean {
        return this.setInputs(
            buttons,
            RawStickToState(stickXRaw),
            RawStickToState(stickYRaw),
            trick,
        );
    }

    /** @param stickXRaw The 0-centered raw stick input on the X axis. */
    setInputsRawStickZeroCenter(
        buttons: number,
        stickXRaw: number,
        stickYRaw: number,
        trick: Trick,
    ): boolean {
        return this.setInputsRawStick(buttons, stickXRaw + 7, stickYRaw + 7, trick);
    }

    /**
     * TS addition: stages this frame's raw inputs in RKG ghost format. They are decoded in
     * calcImpl() exactly like KPadGhostController::calcImpl, and only once the race has started
     * accepting ghost inputs (countdown start, via KPadDirector::startGhostProxies). Before that
     * the input state stays reset, just like a ghost replay.
     *
     * @param buttons Ghost face-button byte: 0x1 accelerate, 0x2 brake/drift, 0x4 item,
     *                0x8 drift (brake pressed after accelerate; see MakeGhostButtons).
     * @param stickXRaw Quantized stick X, 0..14 (7 = neutral, 14 = right).
     * @param stickYRaw Quantized stick Y, 0..14 (7 = neutral, 14 = up).
     * @param trick D-pad trick direction.
     */
    setRawInputs(buttons: number, stickXRaw: number, stickYRaw: number, trick: Trick): void {
        this.m_hasRawState = true;
        this.m_rawButtons = buttons & 0xff;
        this.m_rawStickX = stickXRaw & 0xf;
        this.m_rawStickY = stickYRaw & 0xf;
        this.m_rawTrick = (trick & 0x7) << 4;
    }

    /**
     * TS addition: builds the ghost face-button byte from raw button states. The 0x8 "drift" bit
     * is set when brake is pressed while accelerate is held, and stays set while brake is held.
     */
    static MakeGhostButtons(
        accelerate: boolean,
        brake: boolean,
        item: boolean,
        prevButtons: number,
    ): number {
        let buttons = 0;
        if (accelerate) buttons |= 0x1;
        if (brake) buttons |= 0x2;
        if (item) buttons |= 0x4;

        if (brake) {
            const wasBraking = (prevButtons & 0x2) !== 0;
            const wasDrifting = (prevButtons & 0x8) !== 0;
            if (wasDrifting || (!wasBraking && accelerate)) {
                buttons |= 0x8;
            }
        }

        return buttons;
    }

    /** TS addition: true once inputs are being consumed (countdown has started). */
    isAcceptingInputs(): boolean {
        return this.m_acceptingInputs;
    }

    /** TS addition: mirrors KPadGhostController::setAcceptingInputs. */
    setAcceptingInputs(set: boolean): void {
        this.m_acceptingInputs = set;
    }

    /** TS addition: decodes staged raw inputs exactly like KPadGhostController::calcImpl. */
    override calcImpl(): void {
        if (!this.m_hasRawState || !this.m_acceptingInputs) {
            return;
        }

        const state = this.m_raceInputState;
        state.buttons = this.m_rawButtons;
        const sticks = ((this.m_rawStickX << 4) | this.m_rawStickY) & 0xff;
        state.stickXRaw = (sticks >> 4) & 0xf;
        state.stickYRaw = sticks & 0xf;
        state.stick.set(RawStickToState(state.stickXRaw), RawStickToState(state.stickYRaw));
        state.trickRaw = this.m_rawTrick;
        state.trick = DecodeTrick(state.trickRaw);
    }
}

export class KPad {
    protected m_controller: KPadController | null;
    protected m_currentInputState = new RaceInputState();
    /** Used to determine changes in input state. */
    protected m_lastInputState = new RaceInputState();

    /** @addr{0x80520F64} */
    constructor() {
        this.m_controller = null;
        this.reset();
    }

    /** @addr{0x80521198} */
    calc(): void {
        this.m_lastInputState.copy(this.m_currentInputState);
        this.m_currentInputState.copy(this.m_controller!.raceInputState());
    }

    /** @addr{0x80521110} */
    reset(): void {
        if (this.m_controller) {
            this.m_controller.reset(this.m_controller.driftIsAuto());
        }
    }

    currentState(): Readonly<RaceInputState> {
        return this.m_currentInputState;
    }

    lastState(): Readonly<RaceInputState> {
        return this.m_lastInputState;
    }

    driftIsAuto(): boolean {
        return this.m_controller!.driftIsAuto();
    }
}

/** A specialized KPad for player input, as opposed to CPU players for example. */
export class KPadPlayer extends KPad {
    private m_ghostBuffer = new Uint8Array(RKG_UNCOMPRESSED_INPUT_DATA_SECTION_SIZE);

    /** @addr{0x80521844} */
    setGhostController(
        controller: KPadGhostController,
        inputs: Uint8Array | null,
        driftIsAuto: boolean,
    ): void {
        this.m_controller = controller;

        if (inputs) {
            this.m_ghostBuffer.set(inputs.subarray(0, RKG_UNCOMPRESSED_INPUT_DATA_SECTION_SIZE));
        }

        controller.readGhostBuffer(this.m_ghostBuffer, driftIsAuto);
    }

    setHostController(controller: KPadHostController, driftIsAuto: boolean): void {
        this.m_controller = controller;
        this.m_controller.setDriftIsAuto(driftIsAuto);
    }

    /**
     * Signals to start reading ghost data after fade-in.
     * @addr{0x805215D4}
     * TS addition: also enables a host controller's raw (ghost-format) input path.
     */
    startGhostProxy(): void {
        if (!this.m_controller) {
            return;
        }

        if (this.m_controller.controlSource() === ControlSource.Host) {
            (this.m_controller as KPadHostController).setAcceptingInputs(true);
            return;
        }

        if (this.m_controller.controlSource() !== ControlSource.Ghost) {
            return;
        }

        const ghostController = this.m_controller as KPadGhostController;
        ghostController.setAcceptingInputs(true);
    }

    /**
     * Signals to stop reading ghost data after race completion.
     * @addr{0x80521688}
     */
    endGhostProxy(): void {
        if (!this.m_controller) {
            return;
        }

        if (this.m_controller.controlSource() === ControlSource.Host) {
            (this.m_controller as KPadHostController).setAcceptingInputs(false);
            return;
        }

        if (this.m_controller.controlSource() !== ControlSource.Ghost) {
            return;
        }

        const ghostController = this.m_controller as KPadGhostController;
        ghostController.setAcceptingInputs(false);
    }

    controller(): KPadController | null {
        return this.m_controller;
    }
}
