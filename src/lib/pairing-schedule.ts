import { DAY_NAMES, minToHm } from "~/lib/time";

type PairingSchedule = {
  scheduleConfirmed: boolean;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
};

/** Numeric storage placeholders must never be presented as agreed appointment times. */
export function pairingScheduleText(pairing: PairingSchedule, awaiting: string) {
  return pairing.scheduleConfirmed
    ? `${DAY_NAMES[pairing.dayOfWeek]} ${minToHm(pairing.startMin)}–${minToHm(pairing.endMin)}`
    : awaiting;
}
