/**
 * Port of Kinoko's game/kart/KartParamFileManager.{hh,cc}.
 * Abstraction for the process of retrieving kart parameters from files.
 */

import { Character, CharacterToWeight, Vehicle, WeightClass } from '../../Common';
import { box } from '../../egg/core/Box';
import { RamStream } from '../../egg/util/Stream';

import { ArchiveId, ResourceManager } from '../system/ResourceManager';

import { BSP, KartParam } from './KartParam';

class FileInfo {
    file: Uint8Array | null = null;
    size = 0;

    clear(): void {
        this.file = null;
        this.size = 0;
    }

    load(filename: string): void {
        const resourceManager = ResourceManager.Instance();
        const size = box(0);
        this.file = resourceManager.getFile(filename, size, ArchiveId.Core);
        this.size = size.value;
    }
}

/** `ParamFile<T>::count` (big-endian u32 at offset 0). */
function paramFileCount(file: Uint8Array): number {
    return new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(0, false);
}

/** `&ParamFile<T>::params[idx]` as a stream of sizeof(T) bytes. */
function paramStream(file: Uint8Array, idx: number, size: number): RamStream {
    return RamStream.from(file, 4 + idx * size, size);
}

let s_instance: KartParamFileManager | null = null;

export class KartParamFileManager {
    private m_kartParam = new FileInfo(); // kartParam.bin
    private m_driverParam = new FileInfo(); // driverParam.bin
    private m_bikeDispParam = new FileInfo(); // bikePartsDispParam.bin
    private m_kartDispParam = new FileInfo(); // kartPartsDispParam.bin
    private m_kartCameraParam = new FileInfo(); // kartCameraParam.bin

    /** @addr{0x80591C9C} */
    clear(): void {
        this.m_kartParam.clear();
        this.m_driverParam.clear();
        this.m_bikeDispParam.clear();
        this.m_kartDispParam.clear();
        this.m_kartCameraParam.clear();
    }

    /** @addr{0x805919F4} Loads and validates the kart parameter files. */
    init(): void {
        this.m_kartParam.load('kartParam.bin');
        this.m_driverParam.load('driverParam.bin');
        this.m_bikeDispParam.load('bikePartsDispParam.bin');
        this.m_kartDispParam.load('kartPartsDispParam.bin');
        this.m_kartCameraParam.load('kartCameraParam.bin');
        if (!this.validate()) {
            throw new Error('Parameter files could not be validated!');
        }
    }

    getDriverStream(character: Character): RamStream {
        let idx = -1;
        switch (character) {
            case Character.Small_Mii_Outfit_A_Male:
            case Character.Small_Mii_Outfit_A_Female:
            case Character.Small_Mii_Outfit_B_Male:
            case Character.Small_Mii_Outfit_B_Female:
            case Character.Small_Mii_Outfit_C_Male:
            case Character.Small_Mii_Outfit_C_Female:
            case Character.Small_Mii:
                idx = 23;
                break;
            case Character.Medium_Mii_Outfit_A_Male:
            case Character.Medium_Mii_Outfit_A_Female:
            case Character.Medium_Mii_Outfit_B_Male:
            case Character.Medium_Mii_Outfit_B_Female:
            case Character.Medium_Mii_Outfit_C_Male:
            case Character.Medium_Mii_Outfit_C_Female:
            case Character.Medium_Mii:
                idx = 24;
                break;
            case Character.Large_Mii_Outfit_A_Male:
            case Character.Large_Mii_Outfit_A_Female:
            case Character.Large_Mii_Outfit_B_Male:
            case Character.Large_Mii_Outfit_B_Female:
            case Character.Large_Mii_Outfit_C_Male:
            case Character.Large_Mii_Outfit_C_Female:
            case Character.Large_Mii:
                idx = 25;
                break;
            default:
                if (character > Character.Rosalina) {
                    throw new Error('Uh oh.');
                }

                idx = character;
                break;
        }

        const file = this.m_driverParam.file;
        if (!file) throw new Error('driverParam.bin not loaded');
        return paramStream(file, idx, KartParam.Stats.SIZE);
    }

    getVehicleStream(vehicle: Vehicle): RamStream {
        if (vehicle >= Vehicle.Max) {
            throw new Error('Uh oh.');
        }

        const idx = vehicle;
        const file = this.m_kartParam.file;
        if (!file) throw new Error('kartParam.bin not loaded');
        return paramStream(file, idx, KartParam.Stats.SIZE);
    }

    getHitboxStream(vehicle: Vehicle): RamStream {
        if (vehicle >= Vehicle.Max) {
            throw new Error('Uh oh.');
        }

        const resourceManager = ResourceManager.Instance();
        const size = box(0);

        const file = resourceManager.getBsp(vehicle, size);
        if (!file) throw new Error('BSP file not loaded');
        if (size.value !== BSP.SIZE) throw new Error('Invalid BSP size');
        return RamStream.from(file, 0, size.value);
    }

    getBikeDispParamsStream(vehicle: Vehicle): RamStream {
        if (vehicle < Vehicle.Standard_Bike_S || vehicle >= Vehicle.Max) {
            throw new Error('Uh oh.');
        }

        // We need to index at the correct offset
        const KART_MAX = 18;
        const idx = vehicle - KART_MAX;

        const file = this.m_bikeDispParam.file;
        if (!file) throw new Error('bikePartsDispParam.bin not loaded');
        return paramStream(file, idx, KartParam.BikeDisp.SIZE);
    }

    getKartDispParamsStream(vehicle: Vehicle): RamStream {
        if (vehicle < Vehicle.Standard_Kart_S || vehicle > Vehicle.Honeycoupe) {
            throw new Error('Uh oh.');
        }

        const idx = vehicle;

        const file = this.m_kartDispParam.file;
        if (!file) throw new Error('kartPartsDispParam.bin not loaded');
        return paramStream(file, idx, KartParam.KartDisp.SIZE);
    }

    getKartCameraStream(character: Character): RamStream {
        const weightClass = CharacterToWeight(character);
        if (weightClass === WeightClass.Invalid) {
            throw new Error('Invalid weight class when getting KartCamera stream');
        }

        const file = this.m_kartCameraParam.file;
        if (!file) throw new Error('kartCameraParam.bin not loaded');

        // We skip 1 to get 16:9
        const SIZE = KartParam.KartCameraParam.SIZE;
        return RamStream.from(file, (weightClass * 4 + 1) * SIZE, SIZE);
    }

    static CreateInstance(): KartParamFileManager {
        if (s_instance) throw new Error('KartParamFileManager already created');
        s_instance = new KartParamFileManager();
        return s_instance;
    }

    static DestroyInstance(): void {
        if (!s_instance) throw new Error('KartParamFileManager not created');
        s_instance = null;
    }

    static Instance(): KartParamFileManager {
        return s_instance!;
    }

    private constructor() {
        this.init();
    }

    /** Performs a few checks to make sure the files were loaded successfully. */
    private validate(): boolean {
        // Validate kartParam.bin
        const kartFile = this.m_kartParam.file;
        if (!kartFile || this.m_kartParam.size === 0) {
            return false;
        }

        if (this.m_kartParam.size !== paramFileCount(kartFile) * KartParam.Stats.SIZE + 4) {
            return false;
        }

        // Validate driverParam.bin
        const driverFile = this.m_driverParam.file;
        if (!driverFile || this.m_driverParam.size === 0) {
            return false;
        }

        if (this.m_driverParam.size !== paramFileCount(driverFile) * KartParam.Stats.SIZE + 4) {
            return false;
        }

        // Validate bikePartsDispParam.bin
        const bikeDispFile = this.m_bikeDispParam.file;
        if (!bikeDispFile || this.m_bikeDispParam.size === 0) {
            return false;
        }

        if (
            this.m_bikeDispParam.size !==
            paramFileCount(bikeDispFile) * KartParam.BikeDisp.SIZE + 4
        ) {
            return false;
        }

        // Validate kartPartsDispParam.bin
        const kartDispFile = this.m_kartDispParam.file;
        if (!kartDispFile || this.m_kartDispParam.size === 0) {
            return false;
        }

        if (
            this.m_kartDispParam.size !==
            paramFileCount(kartDispFile) * KartParam.KartDisp.SIZE + 4
        ) {
            return false;
        }

        // Validate kartCameraParam.bin
        if (!this.m_kartCameraParam.file || this.m_kartCameraParam.size === 0) {
            return false;
        }

        return true;
    }
}
