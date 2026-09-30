/**
 * Every data file the boot loads (paths under public/data), all requested at the top of main() so
 * they download in parallel. Each loader asked for its files only once the one before it was done
 * (course → world.json → terrain and imagery → street detail), four round trips in a row. The loaders
 * pick these requests up (data.ts); tests/bootData.test.ts keeps the list in step with world.json.
 */

import { prefetchData } from './data';

const COURSE = 'courses/golden_gate';

/** What the menu waits for (main.ts): the title's chart (ui/chart.ts), the vehicles and the course. */
export const BOOT_FIRST = [`${COURSE}/chart.json`, 'vehicles/vehicles.json', `${COURSE}/course.kcl`, `${COURSE}/course.kmp`, `${COURSE}/course_meta.json`];

/** What the San Francisco scene waits for (sf/scene.ts, sf/world.ts): the rivals, then world.json and the files it names. */
export const BOOT_SCENE = [
    `${COURSE}/rivals.json`,
    `${COURSE}/rivals.bin`,
    'sf/world.json',
    'sf/terrain.bin',
    'sf/landcover.bin',
    'sf/terrain_far.bin',
    'sf/depth.bin',
    'sf/img/base_0_0.webp',
    'sf/img/base_1_0.webp',
    'sf/img/base_0_1.webp',
    'sf/img/base_1_1.webp',
    'sf/img/detail_0.webp',
    'sf/img/detail_1.webp',
    'sf/img/far.jpg',
];

/** Street detail (sf/streetDetail.ts), loaded once the scene is ready if it's on. */
export const STREET_DETAIL = 'sf/detail.json';

export function prefetchBoot(streetDetail: boolean): void {
    prefetchData(BOOT_FIRST, 'high');
    prefetchData(streetDetail ? [...BOOT_SCENE, STREET_DETAIL] : BOOT_SCENE, 'low');
}
