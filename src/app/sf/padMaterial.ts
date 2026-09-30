/**
 * Surface looks for the course's gameplay pieces, drawn procedurally so they stay crisp at any
 * distance, and unlit / not tone-mapped so they read at full strength in any light or shade:
 *
 *   lane    the Boost Lane (dash panels, boost ramps): a Boost Green thermoplastic strip laid in the
 *           asphalt like an SF bike lane, white painted chevrons pointing the way to go, thin white
 *           edge lines along its sides and a soft glow pulse running forward over it. No frame.
 *   kicker  trick kickers: a skate-park kicker in Hazard Yellow with bold black diagonal stripes,
 *           darker toward the foot, and a bright white lip line with reflector studs.
 *
 * Used by dash panels (dashPanels.ts), the boost ramps and trick kickers (kclExtras.ts) and the
 * half-pipes' Boost Lanes (sections/pipeLanes.ts).
 *
 * Geometry supplies `uv` (u across the pad 0..1 from its right edge, v along it 0..1 in the driving
 * direction) and `padSize` (the pad's width and length in world units, per vertex).
 */

import * as THREE from 'three';

export interface PadLook {
    style: 'lane' | 'kicker';
    /** Field, marking and edge-line colours (sRGB hex). */
    base: number;
    chevron: number;
    frame: number;
    /** Marking spacing along the pad and how fast the glow pulse runs forward (world units, units / s). */
    period: number;
    speed: number;
    /** Edge line (lane) / lip line (kicker) width (world units). */
    frameWidth?: number;
}

/** The game-piece palette. */
export const PIECE_COLORS = {
    boostGreen: 0x2bd67b,
    signalOrange: 0xff6a1f,
    paintWhite: 0xf4f4f0,
    hazardYellow: 0xffd23f,
    black: 0x17171a,
};

export const PAD_LOOKS = {
    // Boost Lane on the road (dash panels).
    dash: { style: 'lane', base: PIECE_COLORS.boostGreen, chevron: PIECE_COLORS.paintWhite, frame: PIECE_COLORS.paintWhite, period: 240, speed: 900, frameWidth: 22 },
    // Boost ramps: the same lane, bigger chevrons for the bigger surface.
    boostRamp: { style: 'lane', base: PIECE_COLORS.boostGreen, chevron: PIECE_COLORS.paintWhite, frame: PIECE_COLORS.paintWhite, period: 520, speed: 1400, frameWidth: 40 },
    // Half-pipe faces: lanes up the wall, chevrons pointing at the lip.
    pipeLane: { style: 'lane', base: PIECE_COLORS.boostGreen, chevron: PIECE_COLORS.paintWhite, frame: PIECE_COLORS.paintWhite, period: 200, speed: 700, frameWidth: 22 },
    // Trick kickers.
    trick: { style: 'kicker', base: PIECE_COLORS.hazardYellow, chevron: PIECE_COLORS.black, frame: PIECE_COLORS.paintWhite, period: 260, speed: 0, frameWidth: 70 },
} satisfies Record<string, PadLook>;

/** Shared clock for every pad material (seconds). */
export const padTime = { value: 0 };

const glsl = (c: number) => {
    const col = new THREE.Color(c);
    return `vec3( ${col.r.toFixed(4)}, ${col.g.toFixed(4)}, ${col.b.toFixed(4)} )`;
};

function laneShader(look: PadLook): string {
    const fw = (look.frameWidth ?? 20).toFixed(1);
    return `
        vec2 p = vPadUv * vPadSize;
        float half_w = vPadSize.x * 0.5;
        float side = min( p.x, vPadSize.x - p.x );
        float ends = min( p.y, vPadSize.y - p.y );
        float aaS = fwidth( side ) + 1e-3;
        // Thermoplastic grain.
        float grain = fract( sin( dot( floor( p / 9.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
        vec3 col = ${glsl(look.base)} * ( 0.8 + 0.06 * grain );
        // Chevrons (painted, pointing forward): bands along p.y + k |x|, kept off the edge lines.
        float dx = abs( p.x - half_w );
        float ph = ( p.y + dx * 0.7 ) / ${look.period.toFixed(1)};
        float aa = fwidth( ph ) + 1e-4;
        float c = fract( ph );
        float chev = smoothstep( 0.0, aa, c ) * ( 1.0 - smoothstep( 0.3 - aa, 0.3 + aa, c ) );
        chev *= smoothstep( ${fw} * 2.2, ${fw} * 3.2, side ) * smoothstep( 20.0, 60.0, ends );
        col = mix( col, ${glsl(look.chevron)} * ( 0.9 + 0.06 * grain ), chev );
        // White edge lines along the sides.
        float edge = 1.0 - smoothstep( ${fw} - aaS, ${fw} + aaS, side );
        col = mix( col, ${glsl(look.frame)}, edge );
        // A soft glow pulse running forward along the lane.
        float pulse = fract( ( p.y - padTime * ${look.speed.toFixed(1)} ) / ( ${look.period.toFixed(1)} * 3.0 ) );
        col *= 1.0 + 0.28 * smoothstep( 0.75, 1.0, pulse ) * ( 1.0 - edge );
        // Soft ends (laid in the asphalt, no frame).
        diffuseColor.rgb = col;
        diffuseColor.a = smoothstep( 0.0, 14.0, ends );`;
}

function kickerShader(look: PadLook): string {
    const lw = (look.frameWidth ?? 60).toFixed(1);
    return `
        vec2 p = vPadUv * vPadSize;
        float side = min( p.x, vPadSize.x - p.x );
        // Distance down from the lip (v = 1).
        float lip = vPadSize.y - p.y;
        float aaL = fwidth( lip ) + 1e-3;
        // Bold diagonal stripes, 45 degrees.
        float ph = ( p.x + p.y ) / ${look.period.toFixed(1)};
        float aa = fwidth( ph ) + 1e-4;
        float c = fract( ph );
        float stripe = smoothstep( 0.0, aa, c ) * ( 1.0 - smoothstep( 0.4 - aa, 0.4 + aa, c ) );
        vec3 col = mix( ${glsl(look.base)}, ${glsl(look.chevron)}, stripe );
        // Darker toward the foot, as the slope turns to the sky toward the lip.
        col *= 0.7 + 0.3 * clamp( vPadUv.y, 0.0, 1.0 );
        // Black side edges.
        col = mix( col, ${glsl(look.chevron)}, 1.0 - smoothstep( 26.0, 30.0 + fwidth( side ), side ) );
        // White lip line, with a black gap below it so it reads against the yellow.
        float lipLine = 1.0 - smoothstep( ${lw} - aaL, ${lw} + aaL, lip );
        float gap = 1.0 - smoothstep( ${lw} + 18.0 - aaL, ${lw} + 18.0 + aaL, lip );
        col = mix( col, ${glsl(look.chevron)}, gap );
        // Reflector studs along the lip line (orange).
        float stud = step( length( vec2( mod( p.x, 260.0 ) - 130.0, lip - ${lw} * 0.5 ) ), 14.0 );
        vec3 line = mix( ${glsl(look.frame)} * 1.15, ${glsl(PIECE_COLORS.signalOrange)}, stud );
        col = mix( col, line, lipLine );
        diffuseColor.rgb = col;`;
}

/** Pad surface in the look's style. */
export function padMaterial(look: PadLook, opts: { side?: THREE.Side } = {}): THREE.MeshBasicMaterial {
    const lane = look.style === 'lane';
    const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        toneMapped: false,
        transparent: lane,
        side: opts.side ?? THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.padTime = padTime;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec2 padSize;\nvarying vec2 vPadUv;\nvarying vec2 vPadSize;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPadUv = uv;\nvPadSize = padSize;');
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float padTime;\nvarying vec2 vPadUv;\nvarying vec2 vPadSize;')
            .replace('#include <map_fragment>', `#include <map_fragment>\n{${lane ? laneShader(look) : kickerShader(look)}\n}`);
    };
    mat.customProgramCacheKey = () => `pad-${look.style}-${look.base}-${look.chevron}-${look.frame}-${look.period}-${look.speed}-${look.frameWidth}`;
    return mat;
}

/**
 * Glow on the ground around a pad (additive): geometry is the pad grown by `margin` on every side,
 * with uv / padSize of the pad itself (uv runs outside 0..1 in the margin).
 */
export function padGlowMaterial(color: number, margin: number): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({
        color,
        toneMapped: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.padTime = padTime;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec2 padSize;\nvarying vec2 vPadUv;\nvarying vec2 vPadSize;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPadUv = uv;\nvPadSize = padSize;');
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float padTime;\nvarying vec2 vPadUv;\nvarying vec2 vPadSize;')
            .replace(
                '#include <color_fragment>',
                `#include <color_fragment>
                {
                    vec2 p = vPadUv * vPadSize;
                    vec2 d = max( max( -p, p - vPadSize ), 0.0 );
                    float out_d = length( d );
                    float g = exp( -out_d / ${(margin * 0.35).toFixed(1)} ) * ( 1.0 - smoothstep( ${(margin * 0.7).toFixed(1)}, ${margin.toFixed(1)}, out_d ) );
                    g *= 0.8 + 0.2 * sin( padTime * 6.0 );
                    diffuseColor.a *= g * 0.3;
                }`,
            );
    };
    mat.customProgramCacheKey = () => `padGlow-${margin}`;
    return mat;
}
