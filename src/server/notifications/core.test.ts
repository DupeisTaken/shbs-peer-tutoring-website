import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";

// A DB-only host must be able to load and use these primitives without any
// application singleton, environment validation or approval/API initialization.
vi.mock("~/server/db", () => { throw new Error("Notification core imported the shared database"); });
vi.mock("~/env", () => { throw new Error("Notification core imported environment validation"); });
vi.mock("~/server/approvals", () => { throw new Error("Notification core imported approval dispatch"); });
vi.mock("~/server/api/root", () => { throw new Error("Notification core imported the API root"); });
import {
  managementNotificationRecipients,
  managementReviewers,
  managementReviewSourceLink,
  namedNotificationDetail,
  notificationData,
  notifyAdmins,
  notifyTutors,
  notifyUsers,
  selectManagementReviewers,
} from "./core";

function fixture() {
  const findMany = vi.fn().mockResolvedValue([{ id: "admin", role: "ADMIN" }, { id: "head", role: "HEAD" }]);
  const createMany = vi.fn().mockResolvedValue({ count: 2 });
  return { findMany, createMany, client: { user: { findMany }, notification: { createMany } } as unknown as TransactionDb };
}
beforeEach(() => vi.clearAllMocks());

describe("client-required notification primitives", () => {
  it("preserves explicit events, bilingual detail and in-app-only intent for exact deduplicated recipients", async () => {
    const { client, createMany } = fixture();
    const detail = { en: "Synthetic assignment ready", zh: "示例辅导安排已就绪" };
    await notifyUsers(["learner", "tutor", "learner", ""], {
      ...notificationData("student_assignment_updated", undefined, detail), link: "/student", inAppOnly: true,
    }, client);
    expect(createMany).toHaveBeenCalledWith({ data: ["learner", "tutor"].map((userId) => ({
      userId, title: "Tutoring Assignment Updated", body: null, link: "/student", inAppOnly: true,
      event: "student_assignment_updated", context: { inAppDetail: detail },
    })) });
  });

  it("leaves empty participant fanout without a database read or write", async () => {
    const { client, createMany, findMany } = fixture();
    await notifyUsers(["", ""], { title: "Empty" }, client);
    await notifyTutors([], { title: "Empty" }, client);
    expect(createMany).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("keeps outcomes on the full management audience and pending review on Admin-first ownership", async () => {
    const { client, findMany } = fixture();
    expect(await managementNotificationRecipients(client, "student_assignment_updated")).toEqual([
      { id: "admin", role: "ADMIN" }, { id: "head", role: "HEAD" },
    ]);
    expect(findMany).toHaveBeenLastCalledWith({ where: {
      role: { in: ["ADMIN", "HEAD"] }, suspendedAt: null, mergedIntoId: null,
    }, select: { id: true, role: true } });
    expect(await managementNotificationRecipients(client, "tutor_optout_requested")).toEqual([{ id: "admin", role: "ADMIN" }]);
    expect(await managementReviewers(client, { exclude: "admin" })).toEqual([{ id: "head", role: "HEAD" }]);
  });

  it("preserves reviewer exclusions, Head-only review and explicit self-review fallback", () => {
    const candidates = [{ id: "admin", role: "ADMIN" }, { id: "head", role: "HEAD" }];
    expect(selectManagementReviewers(candidates, { exclude: "admin" })).toEqual([candidates[1]]);
    expect(selectManagementReviewers(candidates, { headOnly: true, exclude: "head" })).toEqual([]);
    expect(selectManagementReviewers(candidates, { headOnly: true, exclude: "head", allowHeadSelfReview: true })).toEqual([candidates[1]]);
  });

  it("uses the injected client for both audience selection and management fanout", async () => {
    const { client, createMany } = fixture();
    await notifyAdmins({ title: "Review", event: "tutor_optout_requested", body: "Synthetic request" }, { exclude: "admin" }, client);
    expect(createMany).toHaveBeenCalledWith({ data: [{ userId: "head", title: "Review", body: "Synthetic request", link: null,
      event: "tutor_optout_requested", context: {} }] });
  });

  it("resolves tutor login identities without substituting participant IDs as recipients", async () => {
    const { client, createMany, findMany } = fixture();
    findMany.mockResolvedValue([{ id: "login" }]);
    await notifyTutors(["tutor", "tutor", ""], { title: "Participant update" }, client);
    expect(findMany).toHaveBeenCalledWith({ where: { tutorId: { in: ["tutor"] } }, select: { id: true } });
    expect(createMany).toHaveBeenCalledWith({ data: [{ userId: "login", title: "Participant update", body: null, link: null }] });
  });

  it("keeps source-specific review links and named translations separate from authority selection", () => {
    expect(managementReviewSourceLink("TutorStatusRequest", "source/id")).toBe("/admin/tutor-requests#request-source%2Fid");
    expect(managementReviewSourceLink("CrewApplication", "source")).toBe("/admin/crew#application-source");
    const detail = namedNotificationDetail("student_assignment_updated", "Synthetic learner");
    expect(detail.en).toContain("Synthetic learner:");
    expect(detail.zh).toContain("Synthetic learner：");
  });
});
