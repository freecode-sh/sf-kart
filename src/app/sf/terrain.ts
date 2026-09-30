/**
 * Terrain meshes for the San Francisco course: the multi-resolution core cells (2 m along the road
 * out to 16 m under the shallows; see tools/sf/terrainBake.ts), in chunks of cells that share a base
 * image, and the 100 m far grid for the horizon (with a hole where the core is).
 *
 * NOAA aerial imagery on a lit standard material — the 1 m base everywhere, and 0.3 m detail tiles
 * along the course blended over it up close (an atlas + page table per cell). Evened out to one
 * level of realism (groundMaps.ts): the photo's own tree crowns and dark shadows give way to the
 * ground around them under our 3D trees, streets get an asphalt grain, steep slopes (where the photo
 * smears) a rock / scrub texture, and the same fine grain everywhere.
 */

import * as THREE from 'three';
import type { GroundMaps } from './groundMaps';
import type { SfWorld } from './world';

/** Chunk size in cells (a chunk never straddles two base images: 25 x 27 cells each). */
const CHUNK_X = 5;
const CHUNK_Z = 9;
/**
 * The far grid's city, per channel: measured against the detailed terrain on the same streets (the
 * far grid raised over the core), it renders 12-18 % darker and cooler; this brings it within a few %.
 */
const FAR_CITY = [1.45, 1.28, 1.04];
/**
 * The sky's ambient light on lawns and sand, per channel: the cool dome that makes shade read
 * blue-grey turns light open ground lilac from above (from the road the grazing reflection of the
 * warm horizon makes up for it). Only on the terrain: the road, buildings and bridge keep it.
 */
const AMBIENT_OPEN = [1.1, 1.0, 0.6];
/** Detail imagery fades out beyond this distance from the camera (world units). */
const DETAIL_FAR = 16000;
/**
 * For taking out the photo's paint: the ground around a texel (at least this wide, m), and the
 * width a mark stands out from (thin marks do, a patch of bright ground doesn't).
 */
const PAINT_AROUND = 2.4;
const PAINT_THIN = 0.9;

export interface TerrainMeshes {
    group: THREE.Group;
    dispose(): void;
    /**
     * The imagery material over (x, z) (world units; owned by the terrain) and the
     * uv of a point in its base image, for meshes draped over the ground (the tunnel covers).
     */
    imageryAt(x: number, z: number): { material: THREE.Material; uv: (x: number, z: number) => [number, number] };
}

/** Tileable grayscale noise for ground detail (value noise, a few octaves). */
function detailTexture(): THREE.DataTexture {
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    const lattice = (g: number, seed: number) => {
        const v = new Float32Array(g * g);
        let s = seed;
        for (let i = 0; i < v.length; ++i) v[i] = ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        return v;
    };
    const octs = [
        [8, 0.45],
        [32, 0.3],
        [128, 0.25],
    ].map(([g, a]) => ({ g: g!, a: a!, v: lattice(g!, g! * 7 + 3) }));
    for (let y = 0; y < N; ++y)
        for (let x = 0; x < N; ++x) {
            let h = 0;
            for (const o of octs) {
                const fx = (x / N) * o.g;
                const fy = (y / N) * o.g;
                const ix = Math.floor(fx);
                const iy = Math.floor(fy);
                const tx = fx - ix;
                const ty = fy - iy;
                const sx = tx * tx * (3 - 2 * tx);
                const sy = ty * ty * (3 - 2 * ty);
                const at = (i: number, j: number) => o.v[((j + o.g) % o.g) * o.g + ((i + o.g) % o.g)]!;
                const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
                const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
                h += (a + (b - a) * sy) * o.a;
            }
            const k = (y * N + x) * 4;
            data[k] = data[k + 1] = data[k + 2] = Math.round(h * 255);
            data[k + 3] = 255;
        }
    const t = new THREE.DataTexture(data, N, N);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
}

/**
 * The page table for the detail atlases: per cell, RGBA = (slot column, slot row, atlas, present),
 * nearest; and a presence mask sampled linearly, so detail fades out toward cells without it.
 */
function pageTextures(world: SfWorld): { page: THREE.DataTexture; presence: THREE.DataTexture } {
    const t = world.json.terrain;
    const d = world.json.imagery.detail;
    const page = new Uint8Array(t.cx * t.cz * 4);
    const pres = new Uint8Array(t.cx * t.cz);
    d.page.forEach((slot, c) => {
        if (slot < 0) return;
        const per = d.per * d.per;
        const a = Math.floor(slot / per);
        const s = slot % per;
        page[c * 4] = s % d.per;
        page[c * 4 + 1] = Math.floor(s / d.per);
        page[c * 4 + 2] = a;
        page[c * 4 + 3] = 255;
        pres[c] = 255;
    });
    const pt = new THREE.DataTexture(page, t.cx, t.cz, THREE.RGBAFormat, THREE.UnsignedByteType);
    pt.magFilter = pt.minFilter = THREE.NearestFilter;
    pt.needsUpdate = true;
    const pr = new THREE.DataTexture(pres, t.cx, t.cz, THREE.RedFormat, THREE.UnsignedByteType);
    pr.magFilter = pr.minFilter = THREE.LinearFilter;
    pr.needsUpdate = true;
    return { page: pt, presence: pr };
}

/** Aerial-imagery material: base map, detail atlases near the road, the ground maps, noise. */
function imageryMaterial(world: SfWorld, base: THREE.Texture, noise: THREE.Texture, pages: ReturnType<typeof pageTextures>, ground: GroundMaps): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ map: base, roughness: 1, metalness: 0, color: 0xd0d0d0, envMapIntensity: 0.35 });
    const t = world.json.terrain;
    const d = world.json.imagery.detail;
    const s = world.json.scale;
    const lc = world.json.landcover;
    const atlases = world.detailAtlases;
    const f = (v: number) => v.toFixed(4);
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.noiseMap = { value: noise };
        sh.uniforms.pageTex = { value: pages.page };
        sh.uniforms.presTex = { value: pages.presence };
        sh.uniforms.groundMask = { value: ground.mask };
        sh.uniforms.groundFill = { value: ground.fill };
        sh.uniforms.groundCover = { value: ground.cover };
        atlases.forEach((a, k) => (sh.uniforms[`detailAtlas${k}`] = { value: a }));
        const pick = (gx: string, gy: string) => atlases.map((_, k) => `at == ${k} ? textureGrad( detailAtlas${k}, duv, ${gx}, ${gy} ) : `).join('') + 'vec4( 0.0 )';
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vEN;\nvarying vec3 vWN;\nvarying float vHM;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nvEN = vec2( position.x, -position.z ) / ${f(s)};\nvWN = normal;\nvHM = position.y / ${f(s)};`);
        sh.fragmentShader = sh.fragmentShader
            // Bare ground has little sheen: at grazing angles the sky's reflection washed it lilac.
            .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularF90 = 0.5;')
            .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), vec3( ${AMBIENT_OPEN.map(f).join(', ')} ), openGround );`)
            .replace(
                '#include <common>',
                `#include <common>
                uniform sampler2D noiseMap;
                uniform sampler2D pageTex;
                uniform sampler2D presTex;
                uniform sampler2D groundMask;
                uniform sampler2D groundFill;
                uniform sampler2D groundCover;
                ${atlases.map((_, k) => `uniform sampler2D detailAtlas${k};`).join('\n')}
                varying vec2 vEN;
                varying vec3 vWN;
                varying float vHM;`,
            )
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
                float openGround = 0.0;
                {
                    // The photo around each texel (PAINT_AROUND across, or the pixel's footprint).
                    float aroundK = max( 1.0, ${f(PAINT_AROUND)} / max( length( dFdx( vEN ) ), length( dFdy( vEN ) ) ) );
                    vec3 around = textureGrad( map, vMapUv, dFdx( vMapUv ) * aroundK, dFdy( vMapUv ) * aroundK ).rgb * diffuse;
                    vec3 thinRef = diffuseColor.rgb;
                    // Detail imagery: which cell, its atlas slot, and the position inside it.
                    vec2 cf = vec2( ( vEN.x - ${f(t.e0)} ) / ${f(t.cell)}, ( ${f(t.n1)} - vEN.y ) / ${f(t.cell)} );
                    ivec2 ci = ivec2( floor( cf ) );
                    float near = clamp( 1.0 - vViewPosition.z / ${f(DETAIL_FAR)}, 0.0, 1.0 );
                    if ( near > 0.0 && ci.x >= 0 && ci.y >= 0 && ci.x < ${t.cx} && ci.y < ${t.cz} ) {
                        vec4 pg = texelFetch( pageTex, ci, 0 );
                        if ( pg.a > 0.5 ) {
                            float fade = clamp( ( texture2D( presTex, cf / vec2( ${f(t.cx)}, ${f(t.cz)} ) ).r - 0.5 ) * 2.0, 0.0, 1.0 ) * near;
                            vec2 slot = floor( pg.rg * 255.0 + 0.5 );
                            int at = int( floor( pg.b * 255.0 + 0.5 ) );
                            vec2 duv = ( slot * ${f(d.tile + 2 * d.pad)} + ${f(d.pad)} + fract( cf ) * ${f(d.tile)} ) / ${f(d.atlasSize)};
                            // Gradients of the continuous position, so mip selection has no seams at cell edges.
                            vec2 cont = cf * ${f(d.tile / d.atlasSize)};
                            // (a little softer than the 0.3 m photo: nearer the 1 m base beyond)
                            vec2 gx = dFdx( cont ) * 1.5;
                            vec2 gy = dFdy( cont ) * 1.5;
                            vec4 dc = ${pick('gx', 'gy')};
                            diffuseColor.rgb = mix( diffuseColor.rgb, dc.rgb * diffuse, fade );
                            // (its own gradients: at most 8 atlas texels across, inside the tile's padding)
                            vec2 ax = dFdx( cont ) * aroundK;
                            vec2 ay = dFdy( cont ) * aroundK;
                            float aw = max( 1.0, max( length( ax ), length( ay ) ) * ${f(d.atlasSize / 8)} );
                            around = mix( around, ( ${pick('ax / aw', 'ay / aw')} ).rgb * diffuse, fade );
                            float tk = max( 1.0, aroundK * ${f(PAINT_THIN / PAINT_AROUND)} );
                            thinRef = mix( thinRef, ( ${pick('dFdx( cont ) * tk', 'dFdy( cont ) * tk')} ).rgb * diffuse, fade );
                        }
                    }
                    vec3 c = diffuseColor.rgb;
                    float dA = texture2D( noiseMap, vEN * 0.35 ).r;
                    float dB = texture2D( noiseMap, vEN * 0.048 + 0.37 ).r;
                    float dC = texture2D( noiseMap, vEN * 1.7 + 0.61 ).r;
                    float dM = texture2D( noiseMap, vEN * 0.006 + 0.13 ).r;
                    // Under our 3D trees, and in the photo's dark (bluish) shadows: the open ground
                    // around them (the fill map), with the trees' own soft contact shade.
                    vec2 gm = vec2( ( vEN.x - ${f(ground.e0)} ) / ${f(ground.width)}, ( ${f(ground.n1)} - vEN.y ) / ${f(ground.height)} );
                    vec4 gk = texture2D( groundMask, gm );
                    vec2 cuv = ( gm * vec2( ${lc.nx - 1}.0, ${lc.nz - 1}.0 ) + 0.5 ) / vec2( ${lc.nx}.0, ${lc.nz}.0 );
                    vec4 cover = texture2D( groundCover, cuv );
                    // The photo's paint on road ground (lane and centre lines, stalls, arrows: thin
                    // marks brighter than the ground around them, white or yellow, tan in shade),
                    // which isn't ours and shows as stray dashes where its roads sit off ours.
                    vec3 LUM = vec3( 0.2126, 0.7152, 0.0722 );
                    float pdl = min( dot( c - around, LUM ), dot( c - thinRef, LUM ) * 1.5 );
                    float pyel = ( c.r + c.g ) * 0.5 - c.b - ( ( around.r + around.g ) * 0.5 - around.b );
                    float pchroma = ( max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) ) ) / max( max( c.r, max( c.g, c.b ) ), 1e-3 );
                    float paint = max( smoothstep( 0.003, 0.025, pdl ) * smoothstep( 0.003, 0.02, pyel ), smoothstep( 0.005, 0.05, pdl ) * smoothstep( 0.3, 0.18, pchroma ) );
                    // (the ground just around the mark: a patch of bright ground only softens at its
                    // rim, rather than ringing)
                    c = mix( c, min( c, mix( thinRef, around, 0.6 ) ), paint * cover.b );
                    vec3 fillC = texture2D( groundFill, gm ).rgb * diffuse * ( 0.6 + 0.8 * ( dA * 0.4 + dB * 0.6 ) );
                    float L = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
                    // (not in ponds: the fill's alpha is 0 where the dark blue is too wide for a shadow)
                    float shade = smoothstep( 0.07, 0.025, L ) * smoothstep( -0.004, 0.012, c.b - c.r ) * texture2D( groundFill, gm ).a;
                    c = mix( c, fillC, max( gk.r, shade * 0.85 ) );
                    c *= 1.0 - 0.3 * gk.a;
                    // Parking lots: their bare asphalt (the fill) with only a trace of the photo's
                    // detail, so no parked cars are printed on the ground.
                    vec3 lotC = texture2D( groundFill, gm ).rgb * diffuse;
                    c = mix( c, lotC + clamp( c - lotC, -0.025, 0.025 ), gk.b );
                    // Streets and parking lots: the photo's, greyed (its cars and glare) with an
                    // asphalt grain.
                    float st = max( smoothstep( 0.3, 0.8, gk.g ), gk.b * 0.8 );
                    // Grey ground (the February photo's bare soil, gravel, dormant grass) a touch
                    // green and warm, so it reads neutral, not lilac, in the orange sun and blue sky
                    // light; and bright, washed-out park ground (young plantings, dormant meadow; not
                    // its paths) pulled a little toward lawn.
                    float grey = smoothstep( 0.08, 0.03, max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) ) );
                    c *= mix( vec3( 1.0 ), vec3( 0.96, 1.06, 0.88 ), grey * ( 1.0 - st ) );
                    float cl = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
                    float pale = smoothstep( 0.1, 0.2, cl ) * grey;
                    float path = smoothstep( 0.03, 0.08, cl - dot( texture2D( groundFill, gm, 2.0 ).rgb * diffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) );
                    c = mix( c, cl * vec3( 0.8, 1.02, 0.56 ), 0.35 * cover.g * pale * ( 1.0 - path ) * ( 1.0 - st ) );
                    float sl = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
                    c = mix( c, vec3( sl ) * vec3( 0.97, 0.99, 1.04 ) * ( 0.86 + 0.28 * dC ), st * 0.7 );
                    // Slopes, where the photo smears (and streets on slopes no street has: the photo's,
                    // on cut / fill slopes): grass, scrub and rock in the broad colour around.
                    float steep = max( smoothstep( 0.88, 0.72, vWN.y ), st * smoothstep( 0.95, 0.9, vWN.y ) );
                    if ( steep > 0.0 ) {
                        vec3 broad = texture2D( groundFill, gm, 1.5 ).rgb * diffuse;
                        float ax = abs( vWN.x ) / ( abs( vWN.x ) + abs( vWN.z ) + 1e-4 );
                        #define TRI( k ) mix( texture2D( noiseMap, vec2( vEN.y, vHM ) * k ).r, texture2D( noiseMap, vec2( vEN.x, vHM ) * k ).r, 1.0 - ax )
                        float tA = TRI( 0.012 );
                        float tB = TRI( 0.05 );
                        float tC = TRI( 0.23 );
                        float tD = TRI( 0.9 );
                        float strata = texture2D( noiseMap, vec2( ( vEN.x + vEN.y ) * 0.003, vHM * 0.18 ) ).r;
                        float bl = dot( broad, vec3( 0.2126, 0.7152, 0.0722 ) );
                        float cliff = smoothstep( 0.72, 0.55, vWN.y );
                        // Vegetated: green in the photo, or golden / olive (summer grass, coyote brush)
                        // and not bright rock, or grass / scrub / forest in the land cover (short of
                        // the sheer cliffs, which stay rock).
                        float green = smoothstep( -0.01, 0.03, broad.g - max( broad.r, broad.b ) );
                        float golden = smoothstep( 0.02, 0.08, broad.g - broad.b ) * smoothstep( 0.55, 0.35, bl );
                        float veg = max( max( green, golden ), cover.r * ( 1.0 - 0.7 * cliff ) );
                        // Weathered rock and soil with dark cracks (strata only on the cliffs, and
                        // only near: far off they read as contour lines); grass in clumps; coastal
                        // scrub in patches (more where it's vegetated).
                        vec3 rock = mix( vec3( 0.19, 0.17, 0.14 ) * ( 0.5 + 3.0 * bl ), broad, 0.35 );
                        float layers = mix( 0.5, smoothstep( 0.35, 0.65, strata ), cliff * clamp( 1.0 - vViewPosition.z / 20000.0, 0.0, 1.0 ) );
                        rock *= ( 0.55 + 0.9 * smoothstep( 0.3, 0.7, tB ) ) * ( 0.7 + 0.6 * layers );
                        rock *= mix( 0.55, 1.0, smoothstep( 0.32, 0.42, tC ) );
                        vec3 grass = broad * vec3( 0.95, 1.04, 0.82 ) * ( 0.62 + 0.7 * smoothstep( 0.25, 0.75, tD ) ) * ( 0.8 + 0.4 * tB );
                        vec3 bush = vec3( 0.055, 0.07, 0.035 ) * ( 0.55 + 0.9 * smoothstep( 0.3, 0.7, tC ) ) * ( 0.8 + 0.4 * tB );
                        float scrub = smoothstep( 0.54 - 0.2 * veg, 0.6 - 0.2 * veg, tA + 0.25 * ( tB - 0.5 ) );
                        vec3 slope = mix( mix( rock, grass, veg * ( 1.0 - 0.6 * cliff ) ), bush, scrub * ( 1.0 - cliff * 0.6 ) );
                        // (bare soil stays warm: no lilac under the evening sky)
                        slope.b = min( slope.b, slope.g * 1.02 );
                        c = mix( c, slope, steep );
                    }
                    // One grain for all the ground: fine up close, broad patches (the same at every
                    // distance) so the base imagery and the detail tiles read alike.
                    float fadeN = clamp( 1.0 - vViewPosition.z / 40000.0, 0.0, 1.0 );
                    float fadeF = clamp( 1.0 - vViewPosition.z / 6000.0, 0.0, 1.0 );
                    c *= mix( 1.0, 0.82 + 0.36 * ( dA * 0.6 + dB * 0.4 ), fadeN );
                    c *= mix( 1.0, 0.8 + 0.4 * dC, fadeF * 0.6 );
                    c *= 0.9 + 0.2 * dM;
                    // Open ground (AMBIENT_OPEN): lawns and sand in the land cover, and light, warm
                    // bare ground (the beaches the land cover misses, dunes; not streets or lots).
                    float sandy = smoothstep( 0.1, 0.2, dot( c, LUM ) ) * smoothstep( -0.005, 0.02, c.r - c.b );
                    openGround = max( max( cover.g, cover.a ), sandy * ( 1.0 - st ) );
                    diffuseColor.rgb = c;
                }`,
            );
    };
    return mat;
}

/**
 * The far grid's material: its photo (graded like the core's at bake time) with the core terrain's
 * ground grain, grey-ground tint and low sheen, and a colour that renders the Marin hills as the
 * detailed terrain does (measured on the same ground: its coarse slopes catch more sun, a little
 * warmer), so the hills keep one look where the detailed terrain ends. Its city (grey, roof-dense
 * ground: not yellowish like the hills' grass and scrub) comes out darker and cooler than the
 * detailed terrain's on the same streets, so it takes FAR_CITY on top.
 */
function farMaterial(world: SfWorld, noise: THREE.Texture): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ map: world.farImage, roughness: 1, metalness: 0, color: 0xbcbdbf, envMapIntensity: 0.35 });
    const s = world.json.scale;
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.noiseMap = { value: noise };
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vEN;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nvEN = vec2( position.x, -position.z ) / ${s.toFixed(4)};`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularF90 = 0.5;')
            .replace('#include <common>', '#include <common>\nuniform sampler2D noiseMap;\nvarying vec2 vEN;')
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
                {
                    vec3 c = diffuseColor.rgb;
                    // City: the photo (sRGB) grey, not yellowish and not dark (water).
                    vec3 ps = pow( sampledDiffuseColor.rgb, vec3( 1.0 / 2.2 ) );
                    float pmax = max( ps.r, max( ps.g, ps.b ) );
                    float city = smoothstep( 0.2, 0.1, ( pmax - min( ps.r, min( ps.g, ps.b ) ) ) / max( pmax, 1e-3 ) ) * smoothstep( -0.035, -0.01, ps.b - ( ps.r + ps.g ) * 0.5 ) * smoothstep( 0.25, 0.4, pmax );
                    c *= mix( vec3( 1.0 ), vec3( ${FAR_CITY.map((v) => v.toFixed(3)).join(', ')} ), city );
                    float grey = smoothstep( 0.08, 0.03, max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) ) );
                    c *= mix( vec3( 1.0 ), vec3( 0.96, 1.06, 0.88 ), grey );
                    float dA = texture2D( noiseMap, vEN * 0.35 ).r;
                    float dB = texture2D( noiseMap, vEN * 0.048 + 0.37 ).r;
                    float dM = texture2D( noiseMap, vEN * 0.006 + 0.13 ).r;
                    c *= mix( 1.0, 0.82 + 0.36 * ( dA * 0.6 + dB * 0.4 ), clamp( 1.0 - vViewPosition.z / 40000.0, 0.0, 1.0 ) );
                    c *= 0.9 + 0.2 * dM;
                    diffuseColor.rgb = c;
                }`,
            );
    };
    return mat;
}

/**
 * `ground` belongs to the terrain from here on (disposed with it). `buried`: per cell, the samples
 * the road surface always hides (sections/roadbed.ts buriedUnderRoad); quads with all four corners
 * buried are left out.
 */
export function buildTerrain(world: SfWorld, ground: GroundMaps, buried: (Uint8Array | null)[] = []): TerrainMeshes {
    const noise = detailTexture();
    const pages = pageTextures(world);
    const group = new THREE.Group();
    group.name = 'terrain';
    const t = world.json.terrain;
    const s = world.json.scale;
    const seaY = world.json.seaY;
    const B = world.json.imagery.base;
    const tileE = (B.e1 - B.e0) / B.n;
    const tileN = (B.n1 - B.n0) / B.n;
    const imageryMats = new Map<number, THREE.MeshStandardMaterial>();
    const meshes: THREE.Mesh[] = [];
    const deep = seaY - 300;

    /** Height at (e, n) m, falling back across missing cells so normals at edges stay sane. */
    const hAt = (e: number, n: number, fallback: number) => world.coreY(e, n) ?? fallback;

    for (let cz0 = 0; cz0 < t.cz; cz0 += CHUNK_Z)
        for (let cx0 = 0; cx0 < t.cx; cx0 += CHUNK_X) {
            const pos: number[] = [];
            const nrm: number[] = [];
            const uv: number[] = [];
            const idx: number[] = [];
            // Base image under this chunk (all its cells share one).
            const bi = Math.min(B.n - 1, Math.floor((t.e0 + (cx0 + 0.5) * t.cell - B.e0) / tileE));
            const bj = Math.min(B.n - 1, Math.floor((B.n1 - (t.n1 - (cz0 + 0.5) * t.cell)) / tileN));
            const te0 = B.e0 + bi * tileE;
            const tn0 = B.n1 - (bj + 1) * tileN;
            for (let j = cz0; j < Math.min(t.cz, cz0 + CHUNK_Z); ++j)
                for (let i = cx0; i < Math.min(t.cx, cx0 + CHUNK_X); ++i) {
                    const h = world.cells[j * t.cx + i];
                    if (!h) continue;
                    const st = t.steps[t.levels[j * t.cx + i]!]!;
                    const m = t.cell / st + 1;
                    const v0 = pos.length / 3;
                    const bm = buried[j * t.cx + i];
                    const ce0 = t.e0 + i * t.cell;
                    const cn1 = t.n1 - j * t.cell;
                    for (let b = 0; b < m; ++b)
                        for (let a = 0; a < m; ++a) {
                            const e = ce0 + a * st;
                            const n = cn1 - b * st;
                            const y = h[b * m + a]!;
                            pos.push(e * s, y, -n * s);
                            // Normal from central differences of the height field (seamless across cells).
                            const dyde = (hAt(e + st, n, y) - hAt(e - st, n, y)) / (2 * st * s);
                            const dydn = (hAt(e, n + st, y) - hAt(e, n - st, y)) / (2 * st * s);
                            const len = Math.hypot(dyde, 1, dydn);
                            // World z = -n: dy/dz = -dy/dn.
                            nrm.push(-dyde / len, 1 / len, dydn / len);
                            uv.push((e - te0) / tileE, (n - tn0) / tileN);
                        }
                    for (let b = 0; b + 1 < m; ++b)
                        for (let a = 0; a + 1 < m; ++a) {
                            const p = v0 + b * m + a;
                            const q = p + 1;
                            const r = p + m;
                            const u = r + 1;
                            // Skip cells that are entirely deep under water (the water plane covers them)
                            // or under the road.
                            if (pos[p * 3 + 1]! < deep && pos[q * 3 + 1]! < deep && pos[r * 3 + 1]! < deep && pos[u * 3 + 1]! < deep) continue;
                            if (bm && bm[p - v0] && bm[q - v0] && bm[r - v0] && bm[u - v0]) continue;
                            idx.push(p, r, q, q, r, u);
                        }
                }
            if (!idx.length) continue;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
            geo.computeBoundingSphere();
            const key = bj * B.n + bi;
            let mat = imageryMats.get(key);
            if (!mat) imageryMats.set(key, (mat = imageryMaterial(world, world.baseImage(bi, bj), noise, pages, ground)));
            const mesh = new THREE.Mesh(geo, mat);
            mesh.receiveShadow = true;
            meshes.push(mesh);
            group.add(mesh);
        }

    // Far field (100 m grid) with a hole over the core.
    const f = world.json.far;
    const ce1 = t.e0 + t.cx * t.cell;
    const cn0 = t.n1 - t.cz * t.cell;
    const fpos = new Float32Array(f.nx * f.nz * 3);
    const fuv = new Float32Array(f.nx * f.nz * 2);
    for (let j = 0; j < f.nz; ++j)
        for (let i = 0; i < f.nx; ++i) {
            const k = j * f.nx + i;
            const e = f.e0 + i * f.step;
            const n = f.n1 - j * f.step;
            let y = world.far[k]!;
            // Sink the far grid under the core so the detailed terrain wins at the seam.
            const inside = e > t.e0 + 50 && e < ce1 - 50 && n > cn0 + 50 && n < t.n1 - 50;
            if (inside) y -= 600;
            fpos[k * 3] = e * s;
            fpos[k * 3 + 1] = y;
            fpos[k * 3 + 2] = -n * s;
            fuv[k * 2] = i / (f.nx - 1);
            fuv[k * 2 + 1] = 1 - j / (f.nz - 1);
        }
    const fidx: number[] = [];
    for (let j = 0; j + 1 < f.nz; ++j)
        for (let i = 0; i + 1 < f.nx; ++i) {
            const e0 = f.e0 + i * f.step;
            const n0 = f.n1 - j * f.step;
            if (e0 >= t.e0 && e0 + f.step <= ce1 && n0 - f.step >= cn0 && n0 <= t.n1) continue;
            const a = j * f.nx + i;
            const b = a + 1;
            const d = a + f.nx;
            const e = d + 1;
            if (fpos[a * 3 + 1]! < deep && fpos[b * 3 + 1]! < deep && fpos[d * 3 + 1]! < deep && fpos[e * 3 + 1]! < deep) continue;
            fidx.push(a, d, b, b, d, e);
        }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    fgeo.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
    fgeo.setIndex(fidx);
    fgeo.computeVertexNormals();
    const farReal = farMaterial(world, noise);
    const farMesh = new THREE.Mesh(fgeo, farReal);
    meshes.push(farMesh);
    group.add(farMesh);

    return {
        group,
        imageryAt(x, z) {
            const bi = Math.max(0, Math.min(B.n - 1, Math.floor((x / s - B.e0) / tileE)));
            const bj = Math.max(0, Math.min(B.n - 1, Math.floor((B.n1 + z / s) / tileN)));
            const key = bj * B.n + bi;
            let material = imageryMats.get(key);
            if (!material) imageryMats.set(key, (material = imageryMaterial(world, world.baseImage(bi, bj), noise, pages, ground)));
            const te0 = B.e0 + bi * tileE;
            const tn0 = B.n1 - (bj + 1) * tileN;
            return { material, uv: (px, pz) => [(px / s - te0) / tileE, (-pz / s - tn0) / tileN] };
        },
        dispose() {
            for (const m of meshes) m.geometry.dispose();
            for (const m of imageryMats.values()) m.dispose();
            farReal.dispose();
            noise.dispose();
            pages.page.dispose();
            pages.presence.dispose();
            ground.dispose();
        },
    };
}
