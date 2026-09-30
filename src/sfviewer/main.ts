/**
 * Standalone viewer for the San Francisco scenery modules (src/app/sf/*.ts exporting
 * `viewerBuild()`), for developing models without the race.
 *
 *   /sfviewer.html?model=bridge[&cam=x,y,z&target=x,y,z&fov=50]
 *
 * Orbit: drag; pan: right-drag; zoom: wheel. window.__view(cam, target) moves the camera;
 * window.__ready is set once the model is built.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ViewerBuild = () => { object: THREE.Object3D; camera?: { pos: [number, number, number]; target: [number, number, number] } } | Promise<{ object: THREE.Object3D; camera?: { pos: [number, number, number]; target: [number, number, number] } }>;

const modules = import.meta.glob('../app/sf/*.ts') as Record<string, () => Promise<{ viewerBuild?: ViewerBuild }>>;
const q = new URLSearchParams(location.search);
const name = q.get('model') ?? 'bridge';
const vec = (s: string | null): [number, number, number] | null => (s ? (s.split(',').map(Number) as [number, number, number]) : null);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc8ee);
const camera = new THREE.PerspectiveCamera(Number(q.get('fov') ?? 50), innerWidth / innerHeight, 20, 2e6);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x6a7a5a, 1.2));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(-40000, 60000, 30000);
scene.add(sun);
const controls = new OrbitControls(camera, canvas);

const key = Object.keys(modules).find((k) => k.endsWith(`/${name}.ts`));
const info = document.getElementById('info')!;
if (!key) info.textContent = `no module src/app/sf/${name}.ts (have ${Object.keys(modules).join(', ')})`;
else {
    const mod = await modules[key]!();
    if (!mod.viewerBuild) info.textContent = `${name}.ts has no viewerBuild()`;
    else {
        const built = await mod.viewerBuild();
        scene.add(built.object);
        const box = new THREE.Box3().setFromObject(built.object);
        const c = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        const pos = vec(q.get('cam')) ?? built.camera?.pos ?? [c.x + size * 0.6, c.y + size * 0.3, c.z + size * 0.6];
        const target = vec(q.get('target')) ?? built.camera?.target ?? [c.x, c.y, c.z];
        camera.position.set(...pos);
        controls.target.set(...target);
        controls.update();
        info.textContent = name;
    }
}
(window as unknown as Record<string, unknown>).__view = (p: [number, number, number], t: [number, number, number]) => {
    camera.position.set(...p);
    controls.target.set(...t);
    controls.update();
};
addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
(window as unknown as Record<string, unknown>).__ready = true;
