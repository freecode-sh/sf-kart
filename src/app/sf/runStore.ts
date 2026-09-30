/**
 * Your own runs, as run files (rules/runfile.ts, a few KB each) in IndexedDB `sfkart:runs`: the
 * best run of each vehicle per course, with what the results board compares (time, section splits,
 * the tune it was raced with). Ghosts are simulated from the files (ghostSim.ts). Runs used to be
 * kept as pose samples in localStorage (`kart.ghost.v1:*`, ~200 KB each); those are dropped.
 * Without IndexedDB (some private modes) nothing is kept, and nothing breaks.
 */

import type { VehicleTune } from '../tuning';
import type { VehicleId } from '../vehicles';

const DB = 'sfkart:runs';
const STORE = 'runs';

export interface StoredRun {
    course: string;
    vehicle: VehicleId;
    /** Race time (game frames). */
    frames: number;
    /** Race frames spent in each course section. */
    splits: Record<string, number>;
    /** The tune signature it was raced with (main.ts runSig), to flag other tunes. */
    sig: string;
    /** The tune itself, to simulate the run with. */
    tune: VehicleTune;
    date: number;
    file: Uint8Array;
}

let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
    db ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return db;
}

const key = (course: string, vehicle: VehicleId) => `${course}@${vehicle}`;

function done<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** The stored runs of a course (one per vehicle at most). */
export async function loadRuns(course: string, vehicles: readonly VehicleId[]): Promise<StoredRun[]> {
    try {
        const store = (await open()).transaction(STORE).objectStore(STORE);
        const runs = await Promise.all(vehicles.map((v) => done(store.get(key(course, v)) as IDBRequest<StoredRun | undefined>)));
        return runs.filter((r) => r !== undefined);
    } catch (e) {
        console.warn('runs not loaded', e);
        return [];
    }
}

export async function storeRun(run: StoredRun): Promise<void> {
    try {
        const tx = (await open()).transaction(STORE, 'readwrite');
        await done(tx.objectStore(STORE).put(run, key(run.course, run.vehicle)));
    } catch (e) {
        console.warn('run not kept', e);
    }
}

/** Drops the old pose-sample ghosts from localStorage (runs are run files now). */
export function dropPoseGhosts(): void {
    try {
        for (let i = localStorage.length - 1; i >= 0; --i) {
            const k = localStorage.key(i);
            if (k?.startsWith('kart.ghost.v1:')) localStorage.removeItem(k);
        }
    } catch {
        // No storage: nothing to drop.
    }
}
