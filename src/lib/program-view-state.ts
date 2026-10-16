import { viewEnum, viewFields } from "./session-view-state";

export type RoomSelection = { owner: string; ids: "default" | null | string[] };
/** Keep default selection distinct from deliberately clearing all rooms. Removed
 * room IDs are dropped only after the owning query provides its current catalog. */
export function roomSelectionParser(roomIds: readonly string[], owner: string) {
  return viewFields<RoomSelection>({
    owner: viewEnum([owner]),
    ids: (value) => {
      if (value === "default" || value === null) return value;
      if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
        return;
      return [...new Set(value)].filter((id) =>
        roomIds.includes(id),
      );
    },
  });
}
export type ScheduleFilters = {
  day: string;
  slot: string;
  room: string;
  interval: string;
};
export function scheduleFiltersParser(catalog: {
  rooms: readonly string[];
  slots: readonly string[];
  intervals: readonly string[];
}) {
  const catalogChoice = (choices: readonly string[]) => (value: unknown) =>
    typeof value === "string"
      ? choices.includes(value)
        ? value
        : ""
      : undefined;
  return viewFields<ScheduleFilters>({
    day: viewEnum(["", "1", "2", "3", "4", "5", "6", "7"]),
    slot: catalogChoice(catalog.slots),
    room: catalogChoice(catalog.rooms),
    interval: catalogChoice(catalog.intervals),
  });
}
