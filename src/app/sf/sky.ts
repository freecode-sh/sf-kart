/**
 * Sky, sun, fog and water for the San Francisco course: a physically based sky (three's Preetham
 * Sky) at golden hour (the sun low over the Marin Headlands, behind the bridge from Crissy Field),
 * an environment map from it for reflections, aerial-perspective fog, and a reflective animated sea
 * coloured by the real water depth (standard material, scrolling procedural normal map, sky
 * reflections).
 */

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { SCALE } from './geo';

/**
 * Golden-hour light and sky. Low in the west-northwest over the Headlands: warm light raking across
 * the city, long shadows, the bridge against an orange sky from Crissy Field. The ambient is the cool
 * sky dome (the environment map without the sun's glare), so shade reads blue-grey and sunlit faces
 * gold.
 */
export const LIGHTING: {
    /** Sun elevation / azimuth (degrees; azimuth as three's spherical theta: -90 = west, -180 = north). */
    elevation: number;
    azimuth: number;
    sky: { turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number };
    /**
     * Grade over the Preetham sky (which stays blue-white at a low sun): `horizon` tints a band
     * along the horizon (strongest towards the sun, `glow` adds light there), `zenith` tints the
     * sky overhead; `clouds` is the sky's cloud cover. `envClamp` caps the luminance of the
     * environment map's sky (0 = off): at a low sun the glare around it would otherwise be most
     * of the ambient light and wash everything orange-brown.
     */
    grade: { horizon: number; glow: number; glowAmount: number; zenith: number; clouds: number; envClamp: number };
    sun: number;
    sunIntensity: number;
    hemiSky: number;
    hemiGround: number;
    hemiIntensity: number;
    exposure: number;
    fog: number;
    env: number;
} = {
    elevation: 7,
    azimuth: -112,
    sky: { turbidity: 7, rayleigh: 3.2, mieCoefficient: 0.004, mieDirectionalG: 0.95 },
    grade: { horizon: 0xff8a3c, glow: 0xff8a3a, glowAmount: 2, zenith: 0xb8c0e8, clouds: 0.25, envClamp: 1.2 },
    sun: 0xffae62,
    sunIntensity: 6.5,
    hemiSky: 0xb0b4c8,
    hemiGround: 0x74584a,
    hemiIntensity: 0.5,
    exposure: 0.9,
    fog: 0xd2b19a,
    env: 1.4,
};

/** Sun direction (towards the sun). */
export const SUN_DIR = new THREE.Vector3()
    .setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - LIGHTING.elevation), THREE.MathUtils.degToRad(LIGHTING.azimuth))
    .normalize();

function waterNormalTexture(): THREE.CanvasTexture {
    // Tileable height field from summed sines at integer frequencies, then its normal map.
    const N = 256;
    const h = new Float32Array(N * N);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const waves: [number, number, number, number][] = [];
    for (let k = 0; k < 40; ++k) {
        const fx = Math.round((rnd() - 0.5) * 18);
        const fy = Math.round((rnd() - 0.5) * 18);
        if (fx === 0 && fy === 0) continue;
        waves.push([fx, fy, rnd() * Math.PI * 2, 1 / Math.hypot(fx, fy)]);
    }
    for (let y = 0; y < N; ++y)
        for (let x = 0; x < N; ++x) {
            let v = 0;
            for (const [fx, fy, ph, a] of waves) v += a * Math.sin(((fx * x + fy * y) / N) * Math.PI * 2 + ph);
            h[y * N + x] = v;
        }
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; ++y)
        for (let x = 0; x < N; ++x) {
            const dx = h[y * N + ((x + 1) % N)]! - h[y * N + ((x - 1 + N) % N)]!;
            const dy = h[((y + 1) % N) * N + x]! - h[((y - 1 + N) % N) * N + x]!;
            const n = new THREE.Vector3(-dx * 1.4, -dy * 1.4, 1).normalize();
            const k = (y * N + x) * 4;
            img.data[k] = (n.x * 0.5 + 0.5) * 255;
            img.data[k + 1] = (n.y * 0.5 + 0.5) * 255;
            img.data[k + 2] = (n.z * 0.5 + 0.5) * 255;
            img.data[k + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

/** Soft fog puff texture: radial falloff with some value noise. */
function fogTexture(): THREE.CanvasTexture {
    const N = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(N, N);
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const blobs = Array.from({ length: 14 }, () => [0.3 + rnd() * 0.4, 0.3 + rnd() * 0.4, 0.12 + rnd() * 0.2]);
    for (let y = 0; y < N; ++y)
        for (let x = 0; x < N; ++x) {
            const u = x / N;
            const v = y / N;
            let a = 0;
            for (const [bx, by, br] of blobs) a += Math.max(0, 1 - Math.hypot(u - bx!, v - by!) / br!) ** 2;
            a = Math.min(1, a * 0.8) * Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2);
            const k = (y * N + x) * 4;
            img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
            img.data[k + 3] = Math.round(a * 255);
        }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export interface SkyWater {
    group: THREE.Group;
    /** Lights `scene` with the sky: its environment map (made once with `renderer`), no background, the fog. */
    attach(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void;
    update(timeSec: number, camera: THREE.Camera): void;
    dispose(): void;
}

/** Water depth grid (m below sea level, 255 = land), for the sea's colour. */
export interface DepthGrid {
    e0: number;
    e1: number;
    n0: number;
    n1: number;
    nx: number;
    nz: number;
    data: Uint8Array;
    scale: number;
}

/** Colours the water by depth: sandy shallows off the beaches, green bay, dark channel. */
function depthShading(mat: THREE.Material, grid: DepthGrid, shallow: number, mid: number, deep: number, prev?: THREE.Material['onBeforeCompile']): THREE.DataTexture {
    const tex = new THREE.DataTexture(grid.data, grid.nx, grid.nz, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    const c = (h: number) => {
        const col = new THREE.Color(h);
        return `vec3( ${col.r.toFixed(4)}, ${col.g.toFixed(4)}, ${col.b.toFixed(4)} )`;
    };
    const f = (v: number) => v.toFixed(3);
    mat.onBeforeCompile = (sh, r) => {
        prev?.(sh, r);
        sh.uniforms.depthTex = { value: tex };
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vWaterEN;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nvec4 wwp = modelMatrix * vec4( position, 1.0 );\nvWaterEN = vec2( wwp.x, -wwp.z ) / ${f(grid.scale)};`);
        sh.fragmentShader = sh.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
                uniform sampler2D depthTex;
                varying vec2 vWaterEN;
                // Land samples read as the shallows (the shore line blends in).
                float waterDepth( ivec2 p ) {
                    float v = texelFetch( depthTex, clamp( p, ivec2( 0 ), ivec2( ${grid.nx - 1}, ${grid.nz - 1} ) ), 0 ).r * 255.0;
                    return v > 252.0 ? 0.0 : v;
                }`,
            )
            .replace(
                '#include <color_fragment>',
                `#include <color_fragment>
                {
                    // Filtered by hand, with land as 0 m: the texture's own filtering blended the
                    // 255 of land into the samples offshore, a dark stair-stepped band along the
                    // shore and dark squares round the rocks.
                    vec2 dp = vec2( ( vWaterEN.x - ${f(grid.e0)} ) / ${f((grid.e1 - grid.e0) / (grid.nx - 1))}, ( ${f(grid.n1)} - vWaterEN.y ) / ${f((grid.n1 - grid.n0) / (grid.nz - 1))} );
                    ivec2 d0 = ivec2( floor( dp ) );
                    vec2 df = dp - vec2( d0 );
                    float d = mix( mix( waterDepth( d0 ), waterDepth( d0 + ivec2( 1, 0 ) ), df.x ), mix( waterDepth( d0 + ivec2( 0, 1 ) ), waterDepth( d0 + ivec2( 1, 1 ) ), df.x ), df.y );
                    if ( dp.x < 0.0 || dp.y < 0.0 || dp.x > ${f(grid.nx - 1)} || dp.y > ${f(grid.nz - 1)} ) d = 60.0;
                    vec3 wc = mix( ${c(shallow)}, ${c(mid)}, smoothstep( 0.0, 6.0, d ) );
                    wc = mix( wc, ${c(deep)}, smoothstep( 6.0, 40.0, d ) );
                    diffuseColor.rgb = wc;
                }`,
            );
    };
    return tex;
}

/** A Preetham sky with the golden-hour grade (warm horizon band and glow, zenith tint) on top. */
function gradedSky(): Sky {
    const sky = new Sky();
    const m = sky.material;
    Object.assign(m.uniforms, {
        gradeHorizon: { value: new THREE.Color() },
        gradeGlow: { value: new THREE.Color() },
        gradeGlowAmount: { value: 0 },
        gradeZenith: { value: new THREE.Color() },
        gradeClamp: { value: 0 },
    });
    m.fragmentShader = m.fragmentShader
        .replace('uniform float time;', 'uniform float time;\nuniform vec3 gradeHorizon;\nuniform vec3 gradeGlow;\nuniform float gradeGlowAmount;\nuniform vec3 gradeZenith;\nuniform float gradeClamp;')
        .replace(
            'gl_FragColor = vec4( texColor, 1.0 );',
            `{
                float hz = max( direction.y, 0.0 );
                // 1 looking along the sun's azimuth, 0 away from it.
                float toward = dot( normalize( direction.xz + 1e-5 ), normalize( vSunDirection.xz + 1e-5 ) ) * 0.5 + 0.5;
                float band = exp( -hz * 6.0 ) * ( 0.2 + 0.8 * toward * toward * toward );
                texColor *= mix( vec3( 1.0 ), gradeHorizon, clamp( band, 0.0, 1.0 ) );
                texColor += gradeGlow * gradeGlowAmount * 0.12 * exp( -hz * 9.0 ) * pow( toward, 5.0 );
                texColor *= mix( vec3( 1.0 ), gradeZenith, smoothstep( 0.12, 0.9, hz ) );
                // Below the horizon (only seen by the environment map): dim neutral ground, so
                // surfaces aren't lit orange from underneath.
                texColor = mix( texColor, vec3( dot( texColor, vec3( 0.3, 0.5, 0.2 ) ) * 0.3 ), smoothstep( 0.0, 0.08, -direction.y ) );
                // The environment map's copy caps the sun and its glow (the sun light brings those),
                // so the ambient light is the cool sky dome rather than a wash of glare.
                if ( gradeClamp > 0.0 ) texColor *= gradeClamp / max( dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) ), gradeClamp );
            }
            gl_FragColor = vec4( texColor, 1.0 );`,
        );
    return sky;
}

/** Sky uniforms (the scattering, the sun and the grade). */
function applyGrade(sky: Sky): void {
    const L = LIGHTING;
    const u = sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) u[k]!.value = L.sky[k];
    u.sunPosition!.value.copy(SUN_DIR);
    u.cloudCoverage!.value = L.grade.clouds;
    // Tints are normalised to their brightest channel (they only shift the hue).
    const tint = (hex: number, c: THREE.Color) => {
        c.setHex(hex);
        return c.multiplyScalar(1 / Math.max(c.r, c.g, c.b));
    };
    tint(L.grade.horizon, u.gradeHorizon!.value);
    tint(L.grade.zenith, u.gradeZenith!.value);
    u.gradeGlow!.value.setHex(L.grade.glow);
    u.gradeGlowAmount!.value = L.grade.glowAmount;
}

export function buildSkyWater(seaY: number, depth?: DepthGrid): SkyWater {
    const group = new THREE.Group();
    group.name = 'sky+water';

    // --- sky ---
    const sky = gradedSky();
    sky.scale.setScalar(4_000_000);
    applyGrade(sky);
    group.add(sky);
    // Fog bank colours: lit top, shaded underside.
    const fogColors = { fogTop: { value: new THREE.Color(0xffdcc2) }, fogBottom: { value: new THREE.Color(0xaab4c8) } };

    // --- water ---
    const normal = waterNormalTexture();
    normal.repeat.set(600, 600);
    const waterMat = new THREE.MeshStandardMaterial({
        color: 0x0b2533,
        roughness: 0.32,
        metalness: 0.0,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.14, 0.14),
        envMapIntensity: 0.6,
    });
    // Two octaves of the normal map at different scales/directions, so the tiling doesn't show.
    const waterTime = { value: 0 };
    waterMat.onBeforeCompile = (sh) => {
        sh.uniforms.waterTime = waterTime;
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float waterTime;')
            .replace(
                '#include <normal_fragment_maps>',
                `vec2 wuv = vNormalMapUv;
                vec3 n1 = texture2D( normalMap, wuv + vec2( waterTime * 0.011, waterTime * 0.006 ) ).xyz * 2.0 - 1.0;
                vec3 n2 = texture2D( normalMap, wuv * 0.137 + vec2( -waterTime * 0.0023, waterTime * 0.0031 ) ).xyz * 2.0 - 1.0;
                vec3 n3 = texture2D( normalMap, wuv * 3.1 + vec2( waterTime * 0.03, -waterTime * 0.021 ) ).xyz * 2.0 - 1.0;
                vec3 mapN = normalize( vec3( ( n1.xy + n2.xy * 1.6 + n3.xy * 0.5 ) * normalScale, 1.0 ) );
                normal = normalize( tbn * mapN );`,
            );
    };
    const depthTex = depth && depthShading(waterMat, depth, 0x5b8a7c, 0x24525a, 0x0b2533, waterMat.onBeforeCompile.bind(waterMat));
    const waterGeo = new THREE.PlaneGeometry(4_000_000, 4_000_000, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = seaY;
    water.receiveShadow = true;
    group.add(water);

    // Karl the Fog: a bank rolling in from the Pacific towards the Golden Gate, lowest by the bridge
    // so the deck and towers stand out of it, and wisps drifting in through the strait under the
    // deck (between the tower piers, below the truss). Puffs drift east, shrink away at the end of
    // their run and wrap round (the axis runs from x 3600, z 13800 to x -12000, z -124800).
    // Camera-facing quads, all in one instanced draw call, fading out at the sea surface (no hard
    // line where a billboard cuts the water), lit warm on top and blue-grey underneath.
    const fogTex = fogTexture();
    /** A drifting puff: start x, speed, run [lo, x1], full size w x h, rest height y. */
    type Puff = { s: THREE.Object3D; x0: number; speed: number; lo: number; x1: number; w: number; h: number; y: number; fade: number };
    const puffs: Puff[] = [];
    const axisX = (z: number) => 3600 + (z - 13800) * 0.1126;
    const addPuff = (p: Omit<Puff, 's' | 'x0'> & { x: number; z: number }) => {
        const s = new THREE.Object3D();
        s.position.set(p.x, p.y, p.z);
        puffs.push({ s, x0: p.x, ...p });
    };
    {
        let seed = 11;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let k = 0; k < 140; ++k) {
            const z = -(-400 + rnd() * 3400) * SCALE;
            const x1 = axisX(z) - 7000;
            const x = -220_000 + rnd() * (x1 + 220_000);
            const h = 10 + rnd() * 70;
            const size = (250 + rnd() * 450) * SCALE * 0.5;
            // The bank: a dense band of wide, flat puffs over the last ~1.6 km before the bridge; its
            // visible top (~0.47 of the quad's height) from ~55 m by the bridge to ~150 m out to sea.
            const lo = x1 - 1600 * SCALE;
            const xr = lo + ((x + 220_000) / (x1 + 220_000)) * (x1 - lo);
            const top = (50 + Math.min(1, (x1 - xr) / 60_000) * 80 + h * 0.3) * SCALE;
            const sh = Math.min(size * 0.6, top / 0.47);
            addPuff({ x: xr, z, speed: 30 + rnd() * 50, lo, x1, w: size * 2, h: sh, y: seaY + sh * 0.12, fade: 20_000 });
            // Burn two draws every third puff: the bank's layout was tuned with this random sequence.
            if (k % 3 === 0) {
                rnd();
                rnd();
            }
        }
        // Wisps through the strait (visible top <= ~40 m; the truss bottom is at ~66-71 m).
        seed = 29;
        for (let k = 0; k < 34; ++k) {
            const z = -(560 + rnd() * 940) * SCALE;
            const lo = axisX(z) - 520 * SCALE;
            const x1 = axisX(z) + 420 * SCALE;
            const x = lo + rnd() * (x1 - lo);
            const w = (160 + rnd() * 220) * SCALE;
            const sh = Math.min(w * 0.32, (40 * SCALE) / 0.47);
            addPuff({ x, z, speed: 45 + rnd() * 60, lo, x1, w, h: sh, y: seaY + sh * 0.1, fade: 14_000 });
        }
    }
    const fogMat = new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: fogTex }, opacity: { value: 0.5 }, ...fogColors },
        vertexShader: `
            #include <common>
            #include <fog_pars_vertex>
            varying vec2 vUv;
            varying float vFogH;
            void main() {
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
                mvPosition.xy += position.xy * vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ) );
                gl_Position = projectionMatrix * mvPosition;
                vFogH = ( inverse( viewMatrix ) * mvPosition ).y - ${seaY.toFixed(1)};
                #include <fog_vertex>
            }`,
        fragmentShader: `
            #include <common>
            #include <fog_pars_fragment>
            uniform sampler2D map;
            uniform float opacity;
            uniform vec3 fogTop;
            uniform vec3 fogBottom;
            varying vec2 vUv;
            varying float vFogH;
            void main() {
                vec4 t = texture2D( map, vUv );
                vec3 c = mix( fogBottom, fogTop, smoothstep( 300.0, 3600.0, vFogH ) );
                gl_FragColor = vec4( c * t.rgb, t.a * opacity * smoothstep( 0.0, 900.0, vFogH ) );
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
                #include <fog_fragment>
            }`,
        transparent: true,
        depthWrite: false,
        fog: true,
    });
    const fog = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), fogMat, puffs.length);
    fog.frustumCulled = false;
    fog.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const placePuffs = (timeSec: number) => {
        puffs.forEach((p, i) => {
            const x = p.lo + ((p.x0 - p.lo + timeSec * p.speed) % (p.x1 - p.lo));
            // Grow in after wrapping round, shrink away before the end of the run.
            const f = Math.max(0.001, Math.min(1, (x - p.lo) / p.fade, (p.x1 - x) / p.fade));
            p.s.position.set(x, seaY + (p.y - seaY) * f, p.s.position.z);
            p.s.scale.set(p.w * f, p.h * f, f);
            p.s.updateMatrix();
            fog.setMatrixAt(i, p.s.matrix);
        });
        fog.instanceMatrix.needsUpdate = true;
    };
    placePuffs(0);
    group.add(fog);

    let envRT: THREE.WebGLRenderTarget | null = null;

    return {
        group,
        attach(renderer, scene) {
            if (!envRT) {
                const pm = new THREE.PMREMGenerator(renderer);
                const envScene = new THREE.Scene();
                const s2 = gradedSky();
                s2.scale.setScalar(1000);
                applyGrade(s2);
                // No clouds in the reflections (they'd be baked in one place).
                s2.material.uniforms.cloudCoverage!.value = 0;
                s2.material.uniforms.gradeClamp!.value = LIGHTING.grade.envClamp;
                envScene.add(s2);
                envRT = pm.fromScene(envScene, 0, 0.1, 5000);
                pm.dispose();
                s2.geometry.dispose();
                s2.material.dispose();
            }
            scene.environment = envRT.texture;
            scene.environmentIntensity = LIGHTING.env;
            scene.background = null;
            scene.fog = new THREE.Fog(LIGHTING.fog, 150_000, 1_500_000);
        },
        update(timeSec, camera) {
            // The fog drifts east towards the Golden Gate and wraps around.
            placePuffs(timeSec);
            // Keep the sky centered on the camera.
            sky.position.copy(camera.position);
            waterTime.value = timeSec;
        },
        dispose() {
            envRT?.dispose();
            // Everything in the group.
            const mats = new Set<THREE.Material>();
            group.traverse((o) => {
                const m = o as THREE.Mesh;
                m.geometry?.dispose();
                if (m.material) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
            });
            for (const m of mats) m.dispose();
            normal.dispose();
            depthTex?.dispose();
            fogTex.dispose();
        },
    };
}
