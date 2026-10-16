/** Room intent is independent of the current result: an AUTO shortage has no reservation. */
export type RoomMode = "AUTO" | "FIXED" | "NONE" | "LEGACY";
export type RoomOutcome =
  | "ASSIGNED"
  | "RETAINED"
  | "MOVED"
  | "UNAVAILABLE"
  | "NONE"
  | "DISABLED"
  | "AWAITING"
  | "UNASSIGNED";

export type RoomCandidate = {
  id: string;
  familiarParticipants: number;
  familiarTutor: boolean;
  occupiedMinutes: number;
};

/** Retention is handled before scoring; room display and patrol order never affect allocation. */
export function rankRoomCandidates(candidates: readonly RoomCandidate[]) {
  return [...candidates].sort(
    (a, b) =>
      b.familiarParticipants - a.familiarParticipants ||
      Number(b.familiarTutor) - Number(a.familiarTutor) ||
      a.occupiedMinutes - b.occupiedMinutes ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
