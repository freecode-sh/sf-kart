import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';

export type ModelFile = { name: string; type: string; buffer: ArrayBuffer };
export type LoadedModel = { root: THREE.Group; animations: THREE.AnimationClip[] };

function text(buffer: ArrayBuffer): string { return new TextDecoder().decode(buffer); }

/** Loads common web and desktop interchange formats from user-selected local files. */
export async function loadModelFile(main: ModelFile, files: ModelFile[], manager: THREE.LoadingManager): Promise<LoadedModel> {
    const ext = main.name.split('.').pop()?.toLowerCase();
    const basePath = main.name.includes('/') ? main.name.slice(0, main.name.lastIndexOf('/') + 1) : '';
    if (ext === 'fbx') {
        const root = new FBXLoader(manager).parse(main.buffer.slice(0), basePath);
        return { root, animations: root.animations ?? [] };
    }
    if (ext === 'glb' || ext === 'gltf') {
        const gltf = await new GLTFLoader(manager).parseAsync(main.buffer.slice(0), basePath);
        return { root: gltf.scene, animations: gltf.animations ?? [] };
    }
    if (ext === 'obj') {
        const mtl = files.find((f) => f.name.toLowerCase().endsWith('.mtl'));
        const loader = new OBJLoader(manager);
        if (mtl) {
            const materials = new MTLLoader(manager).parse(text(mtl.buffer), basePath);
            materials.preload();
            loader.setMaterials(materials);
        }
        return { root: loader.parse(text(main.buffer)), animations: [] };
    }
    if (ext === 'stl' || ext === 'ply') {
        const geometry = ext === 'stl' ? new STLLoader(manager).parse(main.buffer.slice(0)) : new PLYLoader(manager).parse(main.buffer.slice(0));
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({ color: 0xb8c3ca, roughness: 0.78, metalness: 0.05, vertexColors: !!geometry.getAttribute('color') });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        const root = new THREE.Group(); root.add(mesh);
        return { root, animations: [] };
    }
    if (ext === 'dae') {
        const collada = new ColladaLoader(manager).parse(text(main.buffer), basePath);
        if (!collada) throw new Error('The Collada file could not be parsed.');
        const root = new THREE.Group();
        root.add(collada.scene);
        return { root, animations: [] };
    }
    if (ext === '3ds') {
        return { root: new TDSLoader(manager).parse(main.buffer.slice(0), basePath), animations: [] };
    }
    throw new Error('Unsupported model format. Supported: GLB, GLTF, FBX, OBJ, STL, PLY, DAE and 3DS.');
}
