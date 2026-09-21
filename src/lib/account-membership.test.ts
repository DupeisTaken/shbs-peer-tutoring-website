import { describe, expect, it } from "vitest";
import { accountMembership, membershipBadges, membershipSchema, type AccountMembership } from "./account-membership";

const base: AccountMembership = { rank: "NONE", viewer: false, tutor: false, tutee: false, translator: false, crew: false };
describe("composable account badges", () => {
  it.each(["COORDINATOR", "ADMIN", "HEAD"] as const)("keeps exact %s rank independent of participation", rank => {
    expect(membershipBadges({ ...base, rank })).toEqual([rank]);
    expect(membershipBadges({ ...base, rank, tutor: true, tutee: true, crew: true, translator: true }))
      .toEqual([rank, "TUTOR", "TRANSLATOR", "CREW"]);
    expect(membershipBadges({ ...base, rank, tutee: true })).toEqual([rank, "STUDENT"]);
  });
  it.each(["tutor", "tutee", "translator", "crew"] as const)("rejects Viewer with %s", key => {
    expect(membershipSchema.safeParse({ ...base, viewer: true, [key]: true }).success).toBe(false);
  });
  it.each(["COORDINATOR", "ADMIN", "HEAD"] as const)("rejects Viewer with %s", rank => {
    expect(membershipSchema.safeParse({ ...base, viewer: true, rank }).success).toBe(false);
  });
  it("does not infer translation or tutee membership from a management rank", () => {
    expect(accountMembership({ role: "ADMIN" })).toEqual({ ...base, rank: "ADMIN" });
  });
  it("retains historical tutor linkage without a current Tutor badge after archival", () => {
    expect(membershipBadges(accountMembership({ role: "ADMIN", tutorId: "history", tutorStatus: "ARCHIVED", tuteeMember: true })))
      .toEqual(["ADMIN", "STUDENT"]);
  });
});
