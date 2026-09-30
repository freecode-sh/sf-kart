/**
 * The times to beat: the top five laps, then your best in each ride with its place among them all.
 * Until the online board is up its entries are this browser's: the five rivals and your best lap in
 * each vehicle (main.ts builds them). Names are text only (ui/dom.ts): the online board's names come
 * from players.
 */

import { formatFrames } from '../hud';
import { PICKER_ORDER, vehicleDef, type VehicleId } from '../vehicles';
import { el, setChildren } from './dom';

export interface BoardEntry {
    name: string;
    vehicle: VehicleId;
    /** Lap time in engine frames (59.94 per second), as the HUD's timer counts it. */
    frames: number;
    you?: boolean;
}

const TOP = 5;

/** The board. `update` replaces the entries; `ride` marks the vehicle you picked. */
export class Leaderboard {
    readonly el: HTMLElement;

    constructor(
        private entries: BoardEntry[],
        private ride: VehicleId | null = null,
    ) {
        this.el = el('div', { class: 'board', 'aria-label': 'Times to beat' });
        this.render();
    }

    update(entries: BoardEntry[], ride: VehicleId | null = this.ride): void {
        this.entries = entries;
        this.ride = ride;
        this.render();
    }

    private render(): void {
        const all = [...this.entries].sort((a, b) => a.frames - b.frames);
        const place = (e: BoardEntry) => all.indexOf(e) + 1;
        const row = (cls: string, at: string | number, name: string, time: string) =>
            el('li', { class: `row ${cls}` }, el('span', { class: 'place' }, at), el('span', { class: 'name' }, name), el('span', { class: 'time' }, time));
        setChildren(
            this.el,
            el('div', { class: 'label' }, `Top ${TOP}`),
            el('ol', { class: 'rows' }, ...all.slice(0, TOP).map((e, i) => row(e.you ? 'you' : '', i + 1, e.you ? `You · ${vehicleDef(e.vehicle).short}` : e.name, formatFrames(e.frames)))),
            el('div', { class: 'label' }, 'Your times'),
            el(
                'ol',
                { class: 'rows' },
                ...PICKER_ORDER.map((id) => {
                    const best = all.find((e) => e.you && e.vehicle === id);
                    return row(`${best ? '' : 'none'} ${id === this.ride ? 'sel' : ''}`, best ? place(best) : '–', vehicleDef(id).name, best ? formatFrames(best.frames) : 'No time yet');
                }),
            ),
        );
    }
}
