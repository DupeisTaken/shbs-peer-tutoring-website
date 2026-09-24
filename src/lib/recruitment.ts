/** Independent intake windows. Start is inclusive; end is exclusive. Missing bounds are unlimited. */
export type RecruitmentAudience = "tutor" | "tutee";
export type RecruitmentWindow = {
  enabled: boolean;
  opensAt: Date | string | null;
  closesAt: Date | string | null;
  previewUrl: string | null;
};
export function recruitmentStatus(window: RecruitmentWindow, now = Date.now()) {
  if (!window.enabled) return "paused";
  if (window.closesAt && now >= new Date(window.closesAt).getTime())
    return "ended";
  if (window.opensAt && now < new Date(window.opensAt).getTime())
    return "scheduled";
  return "open";
}

/** Optional fields also allow older callers to keep their original default-open behavior. */
type RecruitmentTerm = {
  signupEnabled?: boolean;
  signupOpensAt?: Date | null;
  signupClosesAt?: Date | null;
  signupPreviewUrl?: string | null;
  tutorSignupEnabled?: boolean;
  tutorSignupOpensAt?: Date | null;
  tutorSignupClosesAt?: Date | null;
  tutorSignupPreviewUrl?: string | null;
};
export function recruitmentWindow(
  term: RecruitmentTerm | null,
  audience: RecruitmentAudience,
): RecruitmentWindow {
  const tutor = audience === "tutor";
  return {
    enabled:
      !!term &&
      (tutor
        ? (term.tutorSignupEnabled ?? true)
        : (term.signupEnabled ?? true)),
    opensAt: (tutor ? term?.tutorSignupOpensAt : term?.signupOpensAt) ?? null,
    closesAt:
      (tutor ? term?.tutorSignupClosesAt : term?.signupClosesAt) ?? null,
    previewUrl:
      (tutor ? term?.tutorSignupPreviewUrl : term?.signupPreviewUrl) ?? null,
  };
}
