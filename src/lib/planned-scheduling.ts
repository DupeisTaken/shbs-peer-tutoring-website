/** Weekly copied times are authoritative even after a catalog slot is removed. */
export type PlannedInterval = {
  dayOfWeek: number;
  startMin: number;
  endMin: number;
};

export type TutorPlannedSchedule = PlannedInterval & {
  termId: string;
  tutorId: string;
  scheduleConfirmed: boolean;
};

export type TutorPlannedBooking = TutorPlannedSchedule & { id: string };

/** Strict overlap allows adjacent teaching blocks and never compares slot IDs. */
export function plannedIntervalsOverlap(a: PlannedInterval, b: PlannedInterval) {
  return a.dayOfWeek === b.dayOfWeek &&
    a.startMin < b.endMin && a.endMin > b.startMin;
}

/** Only a caller's explicit current reservation unit may be excluded. Equal
 * clocks, shared students or equal group-like counts never imply membership. */
export function findTutorScheduleConflict<T extends TutorPlannedBooking>(
  candidate: TutorPlannedSchedule,
  bookings: readonly T[],
  excludePairingIds: readonly string[] = [],
): T | undefined {
  if (!candidate.scheduleConfirmed) return undefined;
  const excluded = new Set(excludePairingIds);
  return bookings.find(booking =>
    booking.scheduleConfirmed && !excluded.has(booking.id) &&
    booking.tutorId === candidate.tutorId && booking.termId === candidate.termId &&
    plannedIntervalsOverlap(candidate, booking));
}
