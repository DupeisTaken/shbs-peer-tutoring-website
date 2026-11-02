import { recruitmentStatus, type RecruitmentWindow } from "./recruitment";

/** Only public intake metadata crosses this boundary; approval evidence stays server-side. */
export type PublicSignupTransition = {
  serverNow: string;
  timeZone: string;
  current: {
    termId: string;
    label: string;
    kind: "quarter" | "semester";
    window: RecruitmentWindow;
  } | null;
  next: {
    label: string;
    opensAt: string | null;
    closesAt: string | null;
    enabled: boolean;
    previewUrl: string | null;
    preparationValid: boolean;
    refresh: null | {
      executeAt: string;
      state: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "BLOCKED" | "FAILED";
      valid: boolean;
    };
  } | null;
};

export type PublicSignupView = {
  label: string | null;
  next: boolean;
  state:
    | "open"
    | "currentScheduled"
    | "closed"
    | "planned"
    | "scheduled"
    | "pendingActivation"
    | "awaitingSchedule"
    | "unavailable"
    | "needsReview"
    | "cancelled";
  opensAt: string | null;
  previewUrl: string | null;
};

/** A clock transition changes the announcement, never the active enrollment target. */
export function publicSignupView(
  data: PublicSignupTransition,
  now: number,
): PublicSignupView {
  const current = data.current;
  const status = current ? recruitmentStatus(current.window, now) : "paused";
  const base = {
    label: current?.label ?? null,
    next: false,
    opensAt: null,
    previewUrl: null,
  };
  if (status === "open") return { ...base, state: "open" };
  if (status === "scheduled" && current?.window.opensAt)
    return {
      ...base,
      state: "currentScheduled",
      opensAt: new Date(current.window.opensAt).toISOString(),
      previewUrl: current.window.previewUrl,
    };
  const next = data.next;
  if (!next) return { ...base, state: "closed" };
  const target = {
    label: next.label,
    next: true,
    opensAt: next.opensAt,
    previewUrl: next.previewUrl,
  };
  if (next.refresh?.state === "CANCELLED")
    return { ...target, opensAt: null, state: "cancelled" };
  if (
    !next.preparationValid ||
    (next.refresh && (!next.refresh.valid || next.refresh.state === "BLOCKED"))
  )
    return { ...target, opensAt: null, state: "needsReview" };
  if (
    !next.enabled ||
    (next.closesAt && now >= new Date(next.closesAt).getTime())
  )
    return { ...target, opensAt: null, state: "unavailable" };
  if (!next.opensAt) return { ...target, state: "awaitingSchedule" };
  const opening = new Date(next.opensAt).getTime();
  if (next.closesAt && opening >= new Date(next.closesAt).getTime())
    return { ...target, opensAt: null, state: "needsReview" };
  // A promised opening cannot precede the approved activation. Never silently move its date.
  if (
    next.refresh?.state === "SCHEDULED" &&
    new Date(next.refresh.executeAt).getTime() > opening &&
    opening > now
  )
    return { ...target, opensAt: null, state: "needsReview" };
  if (
    now >= opening ||
    (next.refresh?.state === "SCHEDULED" &&
      now >= new Date(next.refresh.executeAt).getTime())
  )
    return { ...target, state: "pendingActivation" };
  return {
    ...target,
    state: next.refresh?.state === "SCHEDULED" ? "scheduled" : "planned",
  };
}
