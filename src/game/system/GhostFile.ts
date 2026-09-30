/**
 * Port of Kinoko source/game/system/GhostFile.{hh,cc} (plus EGG::Decomp's Yaz decoder, inlined
 * here as a module-private helper).
 */

import {
    Character,
    CharacterToWeight,
    Course,
    Vehicle,
    VehicleToWeight,
    WeightClass,
} from '../../Common';
import { RamStream } from '../../egg/util/Stream';
import { Timer } from './TimerManager';

export const RKG_HEADER_SIZE = 0x88;
export const RKG_UNCOMPRESSED_INPUT_DATA_SECTION_SIZE = 0x2774;
const RAW_GHOST_FILE_SIZE = 0x2800;

/** @addr{0x8021997C} EGG::Decomp::GetExpandSize */
function GetExpandSize(src: Uint8Array, offset: number): number {
    if (src[offset] === 0x59 && src[offset + 1] === 0x61 && src[offset + 2] === 0x7a) {
        // 'Yaz'
        const view = new DataView(src.buffer, src.byteOffset + offset + 4, 4);
        return view.getInt32(0, false);
    }

    return -1;
}

/** @addr{0x80218C2C} EGG::Decomp::DecodeSZS: Yaz0/Yaz1 decompression. */
function DecodeSZS(src: Uint8Array, srcOffset: number, dst: Uint8Array, dstOffset: number): number {
    const expandSize = GetExpandSize(src, srcOffset);
    let srcIdx = srcOffset + 0x10;
    let code = 0;
    let byte = 0;

    for (let destIdx = 0; destIdx < expandSize; code >>>= 1) {
        if (!code) {
            code = 0x80;
            byte = src[srcIdx++]!;
        }

        // Direct copy (code bit = 1)
        if (byte & code) {
            dst[dstOffset + destIdx++] = src[srcIdx++]!;
        }
        // RLE compressed data (code bit = 0)
        else {
            // Lower nibble of byte1 + byte2
            const distToDest = (src[srcIdx]! << 8) | src[srcIdx + 1]!;
            srcIdx += 2;
            let runSrcIdx = destIdx - (distToDest & 0xfff);

            // Upper nibble of byte 1
            let runLen = distToDest >> 12 === 0 ? src[srcIdx++]! + 0x12 : (distToDest >> 12) + 2;

            for (; runLen > 0; runLen--, destIdx++, runSrcIdx++) {
                if (destIdx >= expandSize) {
                    throw new Error('Malformed compressed SZS data.');
                }

                dst[dstOffset + destIdx] = dst[dstOffset + runSrcIdx - 1]!;
            }
        }
    }
    return expandSize;
}

/**
 * The binary data of a ghost saved to a file (always stored decompressed, 0x2800 bytes).
 * Source: https://wiki.tockdom.com/wiki/RKG_(File_Format)
 */
export class RawGhostFile {
    private m_buffer = new Uint8Array(RAW_GHOST_FILE_SIZE);

    constructor(rkg?: Uint8Array) {
        if (rkg) {
            this.init(rkg);
        }
    }

    init(rkg: Uint8Array): void {
        if (!this.isValid(rkg)) {
            throw new Error('Invalid RKG header');
        }

        if (this.compressed(rkg)) {
            if (!this.decompress(rkg)) {
                throw new Error('Failed to decompress RKG!');
            }
        } else {
            this.m_buffer.fill(0);
            this.m_buffer.set(rkg.subarray(0, Math.min(rkg.byteLength, RAW_GHOST_FILE_SIZE)));
        }
    }

    /** @addr{0x8051D1B4} */
    decompress(rkg: Uint8Array): boolean {
        this.m_buffer.fill(0);
        this.m_buffer.set(rkg.subarray(0, RKG_HEADER_SIZE));

        // Unset compressed flag
        this.m_buffer[0xc] = this.m_buffer[0xc]! & 0xf7;

        // Get uncompressed size. Skip past 0x4 bytes which represents the size of the compressed
        // data
        const uncompressedSize = GetExpandSize(rkg, RKG_HEADER_SIZE + 0x4);

        if (uncompressedSize <= 0 || uncompressedSize > RKG_UNCOMPRESSED_INPUT_DATA_SECTION_SIZE) {
            return false;
        }

        DecodeSZS(rkg, RKG_HEADER_SIZE + 0x4, this.m_buffer, RKG_HEADER_SIZE);

        // Set input data section length. C++ writes the u16 in host endianness (little-endian on
        // Kinoko's hosts), so we do the same. The value is unused by the physics.
        this.m_buffer[0xe] = uncompressedSize & 0xff;
        this.m_buffer[0xf] = (uncompressedSize >>> 8) & 0xff;

        return true;
    }

    /**
     * @addr{0x8051C120}
     * @todo Check for valid controller type?
     */
    isValid(rkg: Uint8Array): boolean {
        if (
            rkg.byteLength < RKG_HEADER_SIZE ||
            String.fromCharCode(rkg[0]!, rkg[1]!, rkg[2]!, rkg[3]!) !== 'RKGD'
        ) {
            throw new Error('RKG header malformed');
        }

        const ids = new DataView(rkg.buffer, rkg.byteOffset + 0x8, 4).getUint32(0, false);
        const vehicle = (ids >>> 0x1a) as Vehicle;
        const character = ((ids >>> 0x14) & 0x3f) as Character;
        const year = (ids >>> 0xd) & 0x7f;
        const day = (ids >>> 0x4) & 0x1f;
        const month = (ids >>> 0x9) & 0xf;

        if (vehicle >= Vehicle.Max || character >= Character.Max) {
            return false;
        }

        if (year >= 100 || day >= 32 || month > 12) {
            return false;
        }

        // Validate weight class match
        const charWeight = CharacterToWeight(character);
        const vehicleWeight = VehicleToWeight(vehicle);

        if (charWeight === WeightClass.Invalid) {
            throw new Error('Invalid character weight class!');
        }
        if (vehicleWeight === WeightClass.Invalid) {
            throw new Error('Invalid vehicle weight class!');
        }
        if (charWeight !== vehicleWeight) {
            throw new Error('Character/Bike weight class mismatch!');
        }

        return true;
    }

    buffer(): Uint8Array {
        return this.m_buffer;
    }

    private compressed(rkg: Uint8Array): boolean {
        return ((rkg[0xc]! >> 3) & 1) === 1;
    }
}

/** Parsed representation of a binary ghost file. */
export class GhostFile {
    private m_userData = '';
    private m_miiData = new Uint8Array(76);
    private m_lapCount = 0;
    private m_lapTimes: Timer[] = [new Timer(), new Timer(), new Timer(), new Timer(), new Timer()];
    private m_raceTime = new Timer();
    private m_character: Character = Character.Mario;
    private m_vehicle: Vehicle = Vehicle.Standard_Kart_S;
    private m_course: Course = Course.Mario_Circuit;
    private m_controllerId = 0;
    /** The year, relative to 2000 */
    private m_year = 0;
    private m_month = 0;
    private m_day = 0;
    /** The type of ghost */
    private m_type = 0;
    /** True for automatic, false for manual */
    private m_driftIsAuto = false;
    /** 0xFFFF if sharing disabled */
    private m_location = 0;
    /** The size of the decompressed input data section */
    private m_inputSize = 0;
    private m_inputs: Uint8Array;

    /** @addr{0x8051C398} */
    constructor(raw: RawGhostFile) {
        const stream = RamStream.from(raw.buffer(), 0, RKG_HEADER_SIZE);
        this.read(stream);
        this.m_inputs = raw.buffer().subarray(RKG_HEADER_SIZE);
    }

    /** @addr{0x8051C530} Organizes binary data into members. See RawGhostFile. */
    read(stream: RamStream): void {
        const RKG_MII_DATA_SIZE = 0x4a;
        const RKG_USER_DATA_SIZE = 0x14;

        stream.skip(0x4); // RKGD

        // 0x04 - 0x07
        let data = stream.read_u32();
        this.m_raceTime = Timer.FromData(data);
        this.m_course = ((data >>> 0x2) & 0x3f) as Course;

        // 0x08 - 0x0B
        data = stream.read_u32();
        this.m_vehicle = (data >>> 0x1a) as Vehicle;
        this.m_character = ((data >>> 0x14) & 0x3f) as Character;
        this.m_year = (data >>> 0xd) & 0x7f;
        this.m_month = (data >>> 0x9) & 0xf;
        this.m_day = (data >>> 0x4) & 0x1f;

        // 0x0C - 0x0F
        data = stream.read_u32();
        this.m_type = (data >>> 0xa) & 0x7f;
        this.m_driftIsAuto = ((data >>> 0x11) & 0x1) !== 0;
        this.m_inputSize = data & 0xffff;

        // 0x10
        this.m_lapCount = stream.read_u8();

        // 0x11 - 0x1F
        for (let i = 0; i < 5; ++i) {
            this.m_lapTimes[i] = Timer.FromData(stream.read_u32());
            stream.jump(stream.index() - 1);
        }

        // User data: 10 UTF-16BE characters
        let userData = '';
        for (let i = 0; i < RKG_USER_DATA_SIZE / 2; ++i) {
            const c = stream.read_u16();
            if (c === 0) {
                stream.skip(RKG_USER_DATA_SIZE - (i + 1) * 2);
                break;
            }
            userData += String.fromCharCode(c);
        }
        this.m_userData = userData;

        // 0x34
        this.m_location = stream.read_u8();
        stream.skip(0x7);
        for (let i = 0; i < RKG_MII_DATA_SIZE; ++i) {
            this.m_miiData[i] = stream.read_u8();
        }
    }

    lapTimer(i: number): Readonly<Timer> {
        return this.m_lapTimes[i]!;
    }

    raceTimer(): Readonly<Timer> {
        return this.m_raceTime;
    }

    character(): Character {
        return this.m_character;
    }

    vehicle(): Vehicle {
        return this.m_vehicle;
    }

    course(): Course {
        return this.m_course;
    }

    inputs(): Uint8Array {
        return this.m_inputs;
    }

    driftIsAuto(): boolean {
        return this.m_driftIsAuto;
    }

    userData(): string {
        return this.m_userData;
    }

    lapCount(): number {
        return this.m_lapCount;
    }
}
