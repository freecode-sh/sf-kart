/**
 * Port of Kinoko source/game/system/ResourceManager.{hh,cc}.
 *
 * TS deviation: DVD/U8 archives are replaced by a simple in-memory file registry. Files are
 * registered per archive with `registerFile(archiveId, path, data)`; lookups mirror
 * DvdArchive::getFile naming (a leading '/' is added if missing).
 *
 *   - Core archive (ArchiveId.Core, "/Race/Common"): kartParam.bin, driverParam.bin,
 *     /bsp/<vehicle>.bsp, etc.
 *   - Course archive (ArchiveId.Course): course.kcl, course.kmp.
 */

import { COURSE_NAMES, Course, Vehicle, VEHICLE_NAMES } from '../../Common';
import type { Box } from '../../egg/core/Box';

export enum ArchiveId {
    Core = 0,
    Course = 1,
}

const ARCHIVE_COUNT = 2;

const RESOURCE_PATHS: readonly (string | null)[] = ['/Race/Common', null];

/** In-memory replacement for MultiDvdArchive: a path -> bytes map. */
export class MultiDvdArchive {
    private m_files = new Map<string, Uint8Array>();
    private m_loaded = false;
    private m_name: string | null = null;

    isLoaded(): boolean {
        return this.m_loaded;
    }

    name(): string | null {
        return this.m_name;
    }

    /** "Mounts" the archive. Files may be registered before or after. */
    load(path: string): void {
        this.m_name = path;
        this.m_loaded = true;
    }

    unmount(): void {
        this.m_loaded = false;
    }

    registerFile(path: string, data: Uint8Array): void {
        this.m_files.set(MultiDvdArchive.NormalizePath(path), data);
        this.m_loaded = true;
    }

    /** Mirrors DvdArchive::getFile. */
    getFile(filename: string, size: Box<number> | null): Uint8Array | null {
        if (!this.m_loaded) {
            return null;
        }

        const file = this.m_files.get(MultiDvdArchive.NormalizePath(filename));
        if (!file) {
            return null;
        }

        if (size) {
            size.value = file.byteLength;
        }

        return file;
    }

    static NormalizePath(filename: string): string {
        return filename.startsWith('/') ? filename : `/${filename}`;
    }
}

let s_instance: ResourceManager | null = null; ///< @addr{0x809BD738}

/**
 * @addr{0x809BD738}
 * Highest level abstraction for archive management and subsequent file retrieval.
 */
export class ResourceManager {
    /** 0: Core archive, 1: Course archive */
    private m_archives: MultiDvdArchive[];

    /** TS addition: registers a file in the given archive (replaces DVD loading). */
    registerFile(archiveId: ArchiveId, path: string, data: Uint8Array): void {
        this.m_archives[archiveId]!.registerFile(path, data);
    }

    /** @addr{0x805411FC} */
    getFile(filename: string, size: Box<number> | null, id: ArchiveId): Uint8Array | null {
        const archive = this.m_archives[id]!;
        return archive.isLoaded() ? archive.getFile(filename, size) : null;
    }

    /** @addr{0x805414A8} */
    getBsp(vehicle: Vehicle, size: Box<number> | null): Uint8Array | null {
        const name = ResourceManager.GetVehicleName(vehicle);
        const buffer = `/bsp/${name}.bsp`;

        const archive = this.m_archives[0]!;
        return archive.isLoaded() ? archive.getFile(buffer, size) : null;
    }

    /**
     * C++ overloads `load(Course courseId)` (@addr{0x80540760}) and
     * `load(s32 idx, const char *filename)` (@addr{0x80540450}).
     */
    load(courseId: Course): MultiDvdArchive;
    load(idx: number, filename: string | null): MultiDvdArchive;
    load(a: number, filename?: string | null): MultiDvdArchive {
        if (filename === undefined) {
            const courseId = a as Course;
            const buffer = `Race/Course/${COURSE_NAMES[courseId] ?? ''}`;
            this.m_archives[1]!.load(buffer);
            return this.m_archives[1]!;
        }

        const idx = a;
        // Course has a dedicated load function, so we do not want it here
        if (idx === 1) {
            throw new Error('ResourceManager::load: use load(Course) for the course archive');
        }

        if (!filename) {
            filename = RESOURCE_PATHS[idx] ?? null;
        }

        if (!this.m_archives[idx]!.isLoaded() && filename) {
            this.m_archives[idx]!.load(filename);
        }

        return this.m_archives[idx]!;
    }

    /** @addr{0x805411E4} */
    unmount(archive: MultiDvdArchive): void {
        archive.unmount();
    }

    /** @addr{0x805419EC} */
    static GetVehicleName(vehicle: Vehicle): string | null {
        return vehicle < Vehicle.Max ? VEHICLE_NAMES[vehicle]! : null;
    }

    /** @addr{0x8053FC4C} */
    static CreateInstance(): ResourceManager {
        if (s_instance) throw new Error('ResourceManager already exists');
        s_instance = new ResourceManager();
        return s_instance;
    }

    /** @addr{0x8053FC9C} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): ResourceManager {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x8053FCEC} */
    private constructor() {
        this.m_archives = [];
        for (let i = 0; i < ARCHIVE_COUNT; i++) {
            this.m_archives.push(ResourceManager.Create(i));
        }
    }

    /** @addr{Inlined in 0x8053FCEC} */
    private static Create(_i: number): MultiDvdArchive {
        return new MultiDvdArchive();
    }
}
