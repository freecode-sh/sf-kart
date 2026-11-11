import * as THREE from 'three';
import { loadModelFile } from './modelLoader';

export type WorkshopFile = { name: string; type: string; buffer: ArrayBuffer };
export type WorkshopModel = {
    id: string; name: string; mainFile: string; files: WorkshopFile[];
    position: [number, number, number]; rotationY: number; scale: number;
};
export type WorkshopProject = {
    models: WorkshopModel[];
    skybox?: WorkshopFile;
    music?: WorkshopFile;
    countdownLabels?: string[];
    countdownSound?: WorkshopFile;
    fanfare?: WorkshopFile;
    updatedAt: number;
};

const DB = 'sf-kart-course-workshop';
const STORE = 'projects';
const KEY = 'active';

/** Read the course editor's saved project without coupling the race to its UI. */
export async function getWorkshopProject(): Promise<WorkshopProject | null> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(request.error ?? new Error('Could not open the course workshop library.'));
        request.onsuccess = () => {
            const database = request.result;
            const read = database.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
            read.onsuccess = () => { database.close(); resolve((read.result as WorkshopProject | undefined) ?? null); };
            read.onerror = () => { database.close(); reject(read.error ?? new Error('Could not read the saved course.')); };
        };
    });
}

function objectUrls(files: WorkshopFile[]): { urls: Map<string, string>; revoke(): void } {
    const urls = new Map<string, string>();
    for (const file of files) {
        const url = URL.createObjectURL(new Blob([file.buffer], { type: file.type || 'application/octet-stream' }));
        urls.set(file.name, url);
        urls.set(file.name.split('/').pop() ?? file.name, url);
    }
    return { urls, revoke: () => { for (const url of new Set(urls.values())) URL.revokeObjectURL(url); } };
}

/** Adds saved decorative course models and an optional 360-degree skybox to the active Three.js scene. */
export async function mountWorkshopVisuals(project: WorkshopProject, target: THREE.Group): Promise<THREE.Texture | null> {
    for (const entry of project.models ?? []) {
        const main = entry.files.find((file) => file.name === entry.mainFile);
        if (!main) continue;
        const bundle = objectUrls(entry.files);
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
            const key = decodeURIComponent(url.split(/[?#]/)[0] ?? url);
            return bundle.urls.get(key) ?? bundle.urls.get(key.split('/').pop() ?? key) ?? url;
        });
        try {
            const loaded = await loadModelFile(main, entry.files, manager);
            const root = loaded.root;
            root.position.set(...entry.position);
            root.rotation.y = THREE.MathUtils.degToRad(entry.rotationY);
            root.scale.setScalar(Math.max(0.001, entry.scale));
            root.traverse((node) => {
                const mesh = node as THREE.Mesh;
                if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
            });
            target.add(root);
        } finally {
            bundle.revoke();
        }
    }
    if (!project.skybox?.buffer?.byteLength) return null;
    const url = URL.createObjectURL(new Blob([project.skybox.buffer], { type: project.skybox.type || 'image/jpeg' }));
    try {
        const texture = await new THREE.TextureLoader().loadAsync(url);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Optional user-provided course soundtrack. Playback is started only from the game's start gesture. */
export class WorkshopMusic {
    private audio: HTMLAudioElement | null = null;
    private url = '';

    async load(): Promise<boolean> {
        const project = await getWorkshopProject();
        const file = project?.music;
        if (!file?.buffer?.byteLength) return false;
        this.dispose();
        this.url = URL.createObjectURL(new Blob([file.buffer], { type: file.type || 'audio/mpeg' }));
        this.audio = new Audio(this.url);
        this.audio.loop = true;
        this.audio.preload = 'auto';
        this.audio.volume = 0.65;
        return true;
    }

    play(): void { if (this.audio) { this.audio.currentTime = 0; void this.audio.play().catch((error) => console.warn('Course music could not play:', error)); } }
    pause(): void { this.audio?.pause(); }
    resume(): void { if (this.audio?.paused) void this.audio.play().catch(() => undefined); }
    stop(): void { if (this.audio) { this.audio.pause(); this.audio.currentTime = 0; } }
    setVolume(value: number): void { if (this.audio) this.audio.volume = Math.max(0, Math.min(1, value)); }
    dispose(): void { this.audio?.pause(); this.audio = null; if (this.url) URL.revokeObjectURL(this.url); this.url = ''; }
}

/** Optional race-start audio supplied by the Course Workshop. */
export class WorkshopStartAudio {
    private countdown: HTMLAudioElement | null = null;
    private fanfare: HTMLAudioElement | null = null;
    private urls: string[] = [];
    labels: string[] = ['3', '2', '1'];

    async load(): Promise<boolean> {
        this.dispose();
        const project = await getWorkshopProject();
        if (!project) return false;
        if (project.countdownLabels?.length) this.labels = project.countdownLabels.slice(0, 3);
        const make = (file?: WorkshopFile) => {
            if (!file?.buffer?.byteLength) return null;
            const url = URL.createObjectURL(new Blob([file.buffer], { type: file.type || 'audio/mpeg' }));
            this.urls.push(url);
            const audio = new Audio(url);
            audio.preload = 'auto';
            return audio;
        };
        this.countdown = make(project.countdownSound);
        this.fanfare = make(project.fanfare);
        return !!(this.countdown || this.fanfare);
    }

    playFanfare(): void {
        if (!this.fanfare) return;
        this.fanfare.currentTime = 0;
        void this.fanfare.play().catch(error => console.warn('Race fanfare could not play:', error));
    }
    playCountdown(): void {
        if (!this.countdown) return;
        this.countdown.currentTime = 0;
        void this.countdown.play().catch(error => console.warn('Countdown sound could not play:', error));
    }
    label(original: string | null): string | null {
        if (original === '3') return this.labels[0] ?? original;
        if (original === '2') return this.labels[1] ?? original;
        if (original === '1') return this.labels[2] ?? original;
        return original;
    }
    get hasCountdownSound(): boolean { return !!this.countdown; }
    dispose(): void {
        this.countdown?.pause(); this.fanfare?.pause();
        this.countdown = null; this.fanfare = null;
        for (const url of this.urls) URL.revokeObjectURL(url);
        this.urls = [];
        this.labels = ['3', '2', '1'];
    }
}
