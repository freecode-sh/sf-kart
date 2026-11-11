import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CustomSlot = 'character' | 'kart' | 'tires';
export type TransformValues = { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
export type AssetFile = { name: string; type: string; buffer: ArrayBuffer };
export type StoredAsset = { slot: CustomSlot; mainFile: string; files: AssetFile[]; updatedAt: number };
export type CustomTransforms = Record<CustomSlot, TransformValues>;

export const DEFAULT_TRANSFORMS: CustomTransforms = {
    character: { position: [0, 45, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    kart: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tires: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
};

const DB_NAME = 'sf-kart-custom-assets';
const STORE = 'assets';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Could not open the custom asset library.'));
    });
    return dbPromise;
}

export async function saveCustomAsset(asset: StoredAsset): Promise<void> {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(asset);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Could not save the model.'));
        tx.onabort = () => reject(tx.error ?? new Error('Saving the model was cancelled.'));
    });
}

export async function getCustomAsset(slot: CustomSlot): Promise<StoredAsset | null> {
    const d = await db();
    return new Promise((resolve, reject) => {
        const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(slot);
        req.onsuccess = () => resolve((req.result as StoredAsset | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error('Could not read the model library.'));
    });
}

export async function deleteCustomAsset(slot: CustomSlot): Promise<void> {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(slot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Could not remove the model.'));
    });
}

export function getCustomTransforms(): CustomTransforms {
    try {
        const saved = JSON.parse(localStorage.getItem('sf-kart-custom-transforms-v1') ?? 'null') as Partial<CustomTransforms> | null;
        return {
            character: { ...DEFAULT_TRANSFORMS.character, ...saved?.character },
            kart: { ...DEFAULT_TRANSFORMS.kart, ...saved?.kart },
            tires: { ...DEFAULT_TRANSFORMS.tires, ...saved?.tires },
        };
    } catch {
        return structuredClone(DEFAULT_TRANSFORMS);
    }
}

export function saveCustomTransforms(value: CustomTransforms): void {
    localStorage.setItem('sf-kart-custom-transforms-v1', JSON.stringify(value));
}

export async function loadCustomModel(asset: StoredAsset): Promise<{ root: THREE.Group; animations: THREE.AnimationClip[] }> {
    const manager = new THREE.LoadingManager();
    const urls = new Map<string, string>();
    for (const file of asset.files) {
        const url = URL.createObjectURL(new Blob([file.buffer], { type: file.type || 'application/octet-stream' }));
        urls.set(file.name, url);
        urls.set(file.name.split('/').pop() ?? file.name, url);
    }
    manager.setURLModifier((url) => {
        const decoded = decodeURIComponent(url.split(/[?#]/)[0] ?? url);
        const name = decoded.split('/').pop() ?? decoded;
        return urls.get(decoded) ?? urls.get(name) ?? url;
    });
    try {
        const file = asset.files.find((f) => f.name === asset.mainFile);
        if (!file) throw new Error('The main model file ' + asset.mainFile + ' is missing.');
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'fbx') {
            const root = new FBXLoader(manager).parse(file.buffer.slice(0), '');
            return { root: root as THREE.Group, animations: root.animations ?? [] };
        }
        if (ext === 'glb' || ext === 'gltf') {
            const gltf = await new GLTFLoader(manager).parseAsync(file.buffer.slice(0), '');
            return { root: gltf.scene, animations: gltf.animations ?? [] };
        }
        throw new Error('Use a .glb, .gltf, or .fbx model file.');
    } finally {
        for (const url of new Set(urls.values())) URL.revokeObjectURL(url);
    }
}

export function applyTransform(object: THREE.Object3D, transform: TransformValues): void {
    object.position.set(...transform.position);
    object.rotation.set(...transform.rotation.map((v) => THREE.MathUtils.degToRad(v)) as [number, number, number]);
    object.scale.set(...transform.scale);
}
