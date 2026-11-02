export type ScheduleView = "upcoming" | "all" | "history";

export type SchedulePreviewItem = {
  id: string;
  startsAt: Date | null;
  sortAt: Date;
  needsAction: boolean;
};

/** Outstanding work comes first (most recent first), then the nearest commitment.
 * The preview is independent of event filters and never claims a total count. */
export function upcomingPreview<T extends SchedulePreviewItem>(
  items: readonly T[],
) {
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  return unique
    .sort(
      (a, b) =>
        Number(b.needsAction) - Number(a.needsAction) ||
        (a.needsAction
          ? b.sortAt.getTime() - a.sortAt.getTime()
          : (a.startsAt ?? a.sortAt).getTime() -
            (b.startsAt ?? b.sortAt).getTime()) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 3);
}
