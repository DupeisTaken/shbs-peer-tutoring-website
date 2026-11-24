import { describe, expect, it } from "vitest";
import { helpAccess, type HelpAccessAccount } from "./access";

describe("help audiences follow live, independent account capabilities", () => {
  it("gives guests only public instructions and merged accounts no account guide", () => {
    expect(helpAccess(null)).toEqual({
      audiences: ["public"],
      downloadableAudiences: ["public"],
      canDownload: false,
    });
    expect(
      helpAccess({ role: "HEAD", mergedIntoId: "surviving-account" }),
    ).toEqual({
      audiences: ["public"],
      downloadableAudiences: ["public"],
      canDownload: false,
    });
  });

  it("keeps account recovery readable during suspension without workspaces or staff downloads", () => {
    expect(
      helpAccess({
        role: "HEAD",
        suspendedAt: new Date(),
        tutor: { status: "ACTIVE" },
        crewStatus: "ACTIVE",
        canTranslate: true,
      }),
    ).toEqual({
      audiences: ["public", "account"],
      downloadableAudiences: ["public", "account"],
      canDownload: false,
    });
  });

  it("separates ordinary participant and observer instructions and matching PDF downloads", () => {
    const student = helpAccess({ role: "STUDENT" });
    expect(student.audiences).toEqual(["public", "account", "student"]);
    expect(student.downloadableAudiences).toEqual(["public", "account", "student"]);
    const viewer = helpAccess({ role: "VIEWER" });
    expect(viewer.audiences).toEqual(["public", "account", "observer"]);
    expect(viewer.downloadableAudiences).toEqual(["public", "account", "observer"]);
    expect(
      helpAccess({ role: "VIEWER", canTranslate: true }).audiences,
    ).not.toContain("translator");
  });

  it.each(["HEAD", "ADMIN", "COORDINATOR"])(
    "does not infer tutor or crew membership from %s authority",
    (role) => {
      const result = helpAccess({ role });
      expect(result.canDownload).toBe(true);
      expect(result.audiences).toContain("staff");
      expect(result.audiences).toContain("student");
      expect(result.audiences).toContain("translator"); // Existing management review access.
      expect(result.audiences).not.toContain("tutor");
      expect(result.audiences).not.toContain("crew");
      expect(result.audiences.includes("head")).toBe(role === "HEAD");
      expect(result.audiences.includes("admin")).toBe(role !== "COORDINATOR");
      // Staff can distribute participant training handbooks while keeping admin/Head gated.
      expect(result.downloadableAudiences).toContain("tutor");
      expect(result.downloadableAudiences).toContain("crew");
      expect(result.downloadableAudiences.includes("admin")).toBe(
        role !== "COORDINATOR",
      );
      expect(result.downloadableAudiences.includes("head")).toBe(role === "HEAD");
    },
  );

  it("retains a pure tutor's archived history guidance but rejects revoked or elevated archived links", () => {
    expect(
      helpAccess({ role: "TUTOR", tutor: { status: "ARCHIVED" } }).audiences,
    ).toContain("tutor");
    expect(
      helpAccess({ role: "ADMIN", tutor: { status: "ARCHIVED" } }).audiences,
    ).not.toContain("tutor");
    expect(
      helpAccess({
        role: "TUTOR",
        tutor: { status: "ACTIVE" },
        tutorAccessRevoked: true,
      }).audiences,
    ).not.toContain("tutor");
    expect(
      helpAccess({ role: "ADMIN", tutor: { status: "ACTIVE" } }).audiences,
    ).toContain("tutor");
  });

  it("gates independent Crew membership and its inactive/reentry guidance on the module", () => {
    expect(
      helpAccess({ role: "STUDENT", crewStatus: "ACTIVE" }).audiences,
    ).toContain("crew");
    expect(
      helpAccess({ role: "TUTOR", crewStatus: "OPTED_OUT" }).audiences,
    ).toContain("crew");
    expect(helpAccess({ role: "CREW" }).audiences).toContain("crew");
    expect(
      helpAccess({ role: "CREW", crewStatus: "ACTIVE" }, false).audiences,
    ).not.toContain("crew");
  });

  it("adds translation instructions only for assigned editors or management reviewers", () => {
    expect(
      helpAccess({ role: "STUDENT", canTranslate: true }).audiences,
    ).toContain("translator");
    expect(
      helpAccess({ role: "TUTOR", canTranslate: false }).audiences,
    ).not.toContain("translator");
  });

  it("preserves departure history while following current observer and tutor-derived revocations", () => {
    const account: HelpAccessAccount = {
      role: "TUTOR",
      tutor: { status: "ACTIVE" },
      schoolDeparture: {
        reason: "GRADUATED",
        observerRevoked: false,
        tutorDerived: true,
      },
    };
    expect(helpAccess(account).audiences).toEqual([
      "public",
      "account",
      "student",
      "tutor",
      "observer",
    ]);
    expect(
      helpAccess({ ...account, tutorAccessRevoked: true }).audiences,
    ).toEqual(["public", "account", "student"]);
    expect(
      helpAccess({
        ...account,
        schoolDeparture: { ...account.schoolDeparture!, observerRevoked: true },
      }).audiences,
    ).not.toContain("observer");
    const independentStaff = helpAccess({
      ...account,
      role: "ADMIN",
      tutorAccessRevoked: true,
    });
    expect(independentStaff.canDownload).toBe(true);
    expect(independentStaff.audiences).toContain("admin");
    expect(independentStaff.audiences).not.toContain("head");
  });
});
