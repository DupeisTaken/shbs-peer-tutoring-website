export const tuteeViews = ["dashboard", "schedule", "requests", "attendance", "support"] as const;
export type TuteeView = (typeof tuteeViews)[number];
/** Unrecognized links fall back to the overview; no URL value becomes an API input. */
export function resolveTuteeView(value: string | string[] | undefined | null): TuteeView {
  return tuteeViews.find((view) => view === value) ?? "dashboard";
}
