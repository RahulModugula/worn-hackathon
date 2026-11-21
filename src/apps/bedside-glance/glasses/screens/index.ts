import type { ComponentType } from 'react';
import type { ScreenId } from '../stateMachine';
import type { ScreenProps } from './Frame';
import { CriticalAllergy } from './CriticalAllergy';
import { G1Idle } from './G1Idle';
import { G2Scanning } from './G2Scanning';
import { G3ScanFailed } from './G3ScanFailed';
import { G4MedsCard } from './G4MedsCard';
import { G5MedLogged } from './G5MedLogged';
import { G6Prn } from './G6Prn';
import { G7WoundPrompt } from './G7WoundPrompt';
import { G8WoundAssessment } from './G8WoundAssessment';
import { G9PhoneNotice } from './G9PhoneNotice';
import { H3Capture } from './H3Capture';
import { Vitals } from './Vitals';

export type { ScreenProps };
export const SCREENS: Record<ScreenId, ComponentType<ScreenProps>> = {
  G1: G1Idle, G2: G2Scanning, G3: G3ScanFailed, G4: G4MedsCard, G5: G5MedLogged, G6: G6Prn,
  G7: G7WoundPrompt, H3: H3Capture, G8: G8WoundAssessment, G9: G9PhoneNotice,
  VITALS: Vitals, ALLERGY: CriticalAllergy,
};
