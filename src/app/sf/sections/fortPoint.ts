/**
 * Section dressing from Marine Drive round Fort Point, up Long Avenue and Lincoln Boulevard to the
 * toll plaza: the seawall and surf along the water (seawall.ts) and the toll gantries over the
 * plaza's lane panels, both directions (tollGantry.ts). The half-pipes are drawn with the rest of
 * the KCL extras (halfpipe.ts).
 */

import * as THREE from 'three';
import type { RoadMeta } from '../road';
import type { SfWorld } from '../world';
import { buildSeawall } from './seawall';
import { buildTollGantries } from './tollGantry';

export function buildFortPointSection(
    meta: RoadMeta,
    world: SfWorld,
): { group: THREE.Group; update(t: number): void; dispose(): void } {
    const group = new THREE.Group();
    group.name = 'section:fortPoint';
    const seg = meta.segments ?? {};
    const feats = (meta.features ?? []) as { type: string; s?: number[]; side?: string; lat?: [number, number] }[];
    const within = (s: number, names: string[]) => names.some((n) => seg[n] && s >= seg[n]![0] && s <= seg[n]![1]);

    const parts: { group: THREE.Group; update?(t: number): void; dispose(): void }[] = [];
    if (seg.marine_w && seg.marine_e) {
        const pipes = feats
            .filter((f) => f.type === 'halfpipe' && f.s)
            .map((f) => ({ s: [f.s![0]!, f.s![1]!] as [number, number], side: (f.side === 'left' ? 1 : -1) as 1 | -1 }));
        parts.push(buildSeawall(meta.centerline, [seg.marine_w[0], seg.marine_e[1]], pipes, world.groundY, world.json.seaY));
    }
    const panels = feats
        .filter((f) => f.type === 'dashPanel' && f.s && f.lat && within(f.s[0]!, ['plaza_nb', 'plaza_sb']))
        .map((f) => ({ s: (f.s![0]! + f.s![1]!) / 2, lat: f.lat! }));
    if (panels.length) parts.push(buildTollGantries(meta.centerline, panels));
    for (const p of parts) group.add(p.group);
    return {
        group,
        update(t) {
            for (const p of parts) p.update?.(t);
        },
        dispose() {
            for (const p of parts) p.dispose();
        },
    };
}
