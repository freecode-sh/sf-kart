/** Starts a race the way the app does. */

import type { RaceSession, RaceSessionFiles, RaceSessionScenario } from '../game/scene/RaceSession';
import type { Trick } from '../game/system/KPadController';
import { RaceManager, Stage } from '../game/system/RaceManager';

export function startRace(session: RaceSession, files: RaceSessionFiles, scenario: RaceSessionScenario): void {
    session.init(files, scenario);
    // The 172-frame intro ignores input, so simulate it instantly: the race opens on the
    // countdown. The result is identical to letting it play out.
    while (RaceManager.Instance()!.stage() === Stage.Intro) {
        session.hostController().setRawInputs(0, 7, 7, 0 as Trick);
        session.step();
    }
}
