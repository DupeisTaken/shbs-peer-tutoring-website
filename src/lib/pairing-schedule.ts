import { formatWeekday, minToHm } from "~/lib/time";

type PairingSchedule = {
  scheduleConfirmed: boolean;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
};

/** Numeric storage placeholders must never be presented as agreed appointment times. */
export function pairingScheduleText(
  pairing: PairingSchedule,
  awaiting: string,
  locale = "en",
) {
  return pairing.scheduleConfirmed
    ? `${formatWeekday(pairing.dayOfWeek, locale)} ${minToHm(pairing.startMin)}–${minToHm(pairing.endMin)}`
    : awaiting;
}

/** Sort confirmed weekly appointments by school weekday, start and end; unknowns stay last. */
export function pairingScheduleSortValue(
  pairing: PairingSchedule,
): number | "" {
  return pairing.scheduleConfirmed
    ? (pairing.dayOfWeek * 1441 + pairing.startMin) * 1441 + pairing.endMin
    : "";
}
