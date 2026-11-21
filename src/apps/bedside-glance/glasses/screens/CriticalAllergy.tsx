import { Frame, type ScreenProps } from './Frame';

/** Critical allergy alert. Never fades; needs "acknowledge". */
export function CriticalAllergy(props: ScreenProps) {
  return <Frame {...props} />;
}
