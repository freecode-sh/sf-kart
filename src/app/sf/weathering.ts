/**
 * World-space weathering for big concrete surfaces (the bridge's pylons, anchorages and piers, the
 * US 101 viaduct): the 4 m concrete texture alone tiles into a clean, even, "rendered" wall at the
 * scale of a 60 m pylon. This patches a standard material with large patchy discolouration, rain
 * streaks running down from edges and a darker grime / tide band near the ground and the sea.
 */

import type * as THREE from 'three';
import { SCALE, SEA_Y } from './geo';

export function weatherConcrete(mat: THREE.MeshStandardMaterial, strength = 1): THREE.MeshStandardMaterial {
    mat.onBeforeCompile = (s) => {
        s.uniforms.weatherK = { value: strength };
        s.vertexShader = s.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vWeatherP;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvWeatherP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        s.fragmentShader = s.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
                varying vec3 vWeatherP;
                uniform float weatherK;
                float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float wNoise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
                }`,
            )
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
                {
                    vec3 p = vWeatherP / ${SCALE.toFixed(1)};   // meters
                    float h = (vWeatherP.y - ${SEA_Y.toFixed(1)}) / ${SCALE.toFixed(1)};
                    float across = p.x + p.z;
                    // Patchy discolouration at 5-25 m, finer mottling at 1-2 m.
                    float big = wNoise(vec2(across * 0.06, h * 0.05)) * 0.6 + wNoise(vec2(across * 0.2 + 7.0, h * 0.18)) * 0.4;
                    float fine = wNoise(vec2(across * 0.9, h * 0.9));
                    // Rain streaks: narrow in x, long in y.
                    float streak = wNoise(vec2(across * 2.3, h * 0.06)) * wNoise(vec2(across * 0.7 + 3.0, h * 0.02));
                    float grime = 1.0 - 0.28 * (1.0 - smoothstep(0.0, 9.0, h));
                    float w = (0.8 + 0.28 * big + 0.06 * fine) * (1.0 - 0.3 * smoothstep(0.25, 0.6, streak)) * grime;
                    diffuseColor.rgb *= mix(1.0, w, weatherK);
                }`,
            );
    };
    mat.customProgramCacheKey = () => `weatheredConcrete${strength}`;
    return mat;
}
