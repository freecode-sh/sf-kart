/** Port of Kinoko source/game/field/jugem/JugemSwitch.{hh,cc}. */

import { fr } from '../../../egg/math/Math';
import { KartObjectManager } from '../../kart/KartObjectManager';
import { eStatus } from '../../kart/Status';
import { RaceManager } from '../../system/RaceManager';

/** Base class which is used to represent cases that toggle Lakitu on or off. */
export abstract class JugemSwitch {
    protected m_isOn = false;

    isOn(): boolean {
        return this.m_isOn;
    }

    init(): void {
        this.m_isOn = false;
    }

    abstract calc(): void;
}

const ACTIVATION_FRAME_STEP = fr(1.0 / 60.0);

/** Represents a Lakitu toggle when turning to face backwards. */
export class JugemSwitchReverse extends JugemSwitch {
    /** Lakitu is activated when this reaches 1.0f. (Uninitialized in C++; zero here.) */
    private m_activationPercent = 0.0;

    override init(): void {
        this.m_isOn = false;
        this.m_activationPercent = 0.0;
    }

    calc(): void {
        if (RaceManager.Instance()!.player().drivingWrongWay()) {
            const kartStatus = KartObjectManager.Instance()!.object(0).status();
            if (kartStatus.offBit(eStatus.InAction)) {
                this.m_activationPercent = fr(this.m_activationPercent + ACTIVATION_FRAME_STEP);
            }

            if (this.m_activationPercent > 1.0 && kartStatus.offBit(eStatus.BeforeRespawn)) {
                this.m_activationPercent = 1.0;
                this.m_isOn = true;
            }
        } else {
            this.m_activationPercent = fr(this.m_activationPercent - ACTIVATION_FRAME_STEP);
            if (this.m_activationPercent < 0.0) {
                this.m_activationPercent = 0.0;
                this.m_isOn = false;
            }
        }
    }
}
