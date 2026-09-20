import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { approveQualification, eligibleSubjectIds } from "~/server/qualifications";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { reconcileApplication } from "~/server/tutors/application-status";
import { qualificationSnapshot } from "~/lib/qualification-applications";

// Session claims are deliberately stale: procedures must use the database role/link, not the cookie.
const caller = (id = "applicant") => createCaller({ db, headers: new Headers(), session: {
  user: { id, name: "Synthetic account", email: `${id}@example.test` },
  role: "HEAD" as Session["role"], tutorId: "forged-link", expires: "2099-01-01",
} });
const request = (subjectId = "history-ap", id = "applicant") => caller(id).qualificationApplication.submit({ subjectId, reason: "Synthetic qualification evidence" });
async function decide(id: string, accept = true, reviewer = "admin") {
  const app = await db.tutorApplication.findUniqueOrThrow({ where: { id } });
  return caller(reviewer).qualificationApplication.decide({ id, accept, comment: "Reviewed synthetic evidence", expectedUpdatedAt: app.updatedAt });
}
async function panel(id: string, chair = "admin-tutor") {
  const app = await db.tutorApplication.findUniqueOrThrow({ where: { id } });
  return caller("admin").admin.assignInterviewers({ applicationId: id, tutorIds: [chair, "panel-a-tutor", "panel-b-tutor"], headTutorId: chair, expectedUpdatedAt: app.updatedAt });
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test") throw new Error("Use the serial shbs_shipping_test database");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(row => '"' + row.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  for (const [id, role] of [["applicant", "TUTOR"], ["other", "TUTOR"], ["admin", "ADMIN"], ["head", "HEAD"], ["coordinator", "COORDINATOR"], ["panel-a", "TUTOR"], ["panel-b", "TUTOR"]] as const) {
    await db.tutor.create({ data: { id: `${id}-tutor`, englishName: `Synthetic ${id}`, email: `${id}@example.test`, status: "ACTIVE" } });
    await db.user.create({ data: { id, role, username: id, email: `${id}@example.test`, tutorId: `${id}-tutor`, emailVerifiedAt: new Date() } });
  }
  await db.courseGroup.createMany({ data: [{ id: "history", name: "History", rank: 0 }, { id: "science", name: "Science", rank: 1 }] });
  await db.subjectLevel.createMany({ data: [{ id: "standard", name: "Standard", prefix: "", rank: 0 }, { id: "honors", name: "Honors", prefix: "Honors", rank: 1 }, { id: "ap", name: "AP", prefix: "AP", rank: 2 }] });
  await db.subject.createMany({ data: [
    ...["standard", "honors", "ap"].map(levelId => ({ id: `history-${levelId}`, name: `History ${levelId}`, baseName: "History", groupId: "history", levelId })),
    { id: "science-standard", name: "Science", baseName: "Science", groupId: "science", levelId: "standard" },
  ] });
  await db.$transaction(async tx => {
    await approveQualification(tx, "applicant-tutor", "science-standard", "head");
    await approveQualification(tx, "panel-a-tutor", "history-ap", "head");
  });
});
afterAll(() => db.$disconnect());

it("records a self-owned new subject request without granting eligibility or exposing other tutors' history", async () => {
  const { id } = await request();
  expect(await db.tutorApplication.findUniqueOrThrow({ where: { id } })).toMatchObject({ type: "ADDITIONAL_SUBJECT", requestedTutorId: "applicant-tutor", requestedSubjectId: "history-ap", status: "PENDING", promotedTutorId: null });
  expect(await eligibleSubjectIds(db, "applicant-tutor")).toEqual(["science-standard"]);
  expect((await caller().qualificationApplication.mine()).requests.map(row => row.id)).toEqual([id]);
  expect((await caller("other").qualificationApplication.mine()).requests).toEqual([]);
  await expect(caller().qualificationApplication.submit({ subjectId: "history-ap", reason: "Evidence", tutorId: "other-tutor" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it.each(["admin", "head"])("lets %s approve directly with interviews enabled while preserving roles and prior grants", async reviewer => {
  const userBefore = await db.user.findUniqueOrThrow({ where: { id: "applicant" } });
  const original = await db.tutorQualification.findUniqueOrThrow({ where: { tutorId_subjectId: { tutorId: "applicant-tutor", subjectId: "science-standard" } } });
  const { id } = await request();
  await decide(id, true, reviewer);
  const app = await db.tutorApplication.findUniqueOrThrow({ where: { id } });
  expect(app).toMatchObject({ status: "ACCEPTED", qualificationDecidedById: reviewer, promotedTutorId: null });
  expect(qualificationSnapshot(app.qualificationSnapshot).map(subject => subject.id).sort()).toEqual(["history-ap", "history-honors", "history-standard"]);
  expect((await eligibleSubjectIds(db, "applicant-tutor")).sort()).toEqual(["history-ap", "history-honors", "history-standard", "science-standard"]);
  expect(await db.user.findUniqueOrThrow({ where: { id: "applicant" } })).toEqual(userBefore);
  expect(await db.tutorQualification.findUniqueOrThrow({ where: { tutorId_subjectId: { tutorId: "applicant-tutor", subjectId: "science-standard" } } })).toEqual(original);
  expect(await db.registrationCode.count()).toBe(0);
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await db.tutorSubjectWillingness.count({ where: { tutorId: "applicant-tutor" } })).toBe(0);
  expect(await db.notification.count({ where: { userId: "applicant", link: "/dashboard#qualification-requests" } })).toBe(1);
});

it("classifies higher-level requests, snapshots missing intermediate offerings and survives later reordering", async () => {
  await db.$transaction(tx => approveQualification(tx, "applicant-tutor", "history-standard", "head"));
  await db.subject.update({ where: { id: "history-honors" }, data: { active: false } });
  const { id } = await request();
  expect((await db.tutorApplication.findUniqueOrThrow({ where: { id } })).type).toBe("HIGHER_LEVEL");
  await decide(id);
  const snapshot = (await db.tutorApplication.findUniqueOrThrow({ where: { id } })).qualificationSnapshot;
  await db.subjectLevel.update({ where: { id: "ap" }, data: { rank: -1 } });
  await db.subject.update({ where: { id: "history-honors" }, data: { active: true } });
  expect((await eligibleSubjectIds(db, "applicant-tutor")).sort()).toEqual(["history-ap", "history-standard", "science-standard"]);
  expect((await caller().qualificationApplication.mine()).requests[0]?.qualificationSnapshot).toEqual(snapshot);
});

it("takes inheritance at decision time and not submission time", async () => {
  const { id } = await request();
  await db.subjectLevel.update({ where: { id: "honors" }, data: { rank: 10 } });
  await decide(id);
  expect((await eligibleSubjectIds(db, "applicant-tutor")).sort()).toEqual(["history-ap", "history-standard", "science-standard"]);
});

it("serializes duplicate submissions and refuses already approved or inactive subjects", async () => {
  const attempts = await Promise.allSettled([request(), request()]);
  expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.tutorApplication.count()).toBe(1);
  await expect(request("science-standard")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await db.subjectLevel.update({ where: { id: "honors" }, data: { active: false } });
  await expect(request("history-honors")).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("rejects Coordinator decisions and legacy entry points before queuing any proposal", async () => {
  const { id } = await request();
  const app = await db.tutorApplication.findUniqueOrThrow({ where: { id } });
  await expect(decide(id, true, "coordinator")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller("coordinator").admin.assignInterviewers({ applicationId: id, tutorIds: ["coordinator-tutor", "panel-a-tutor", "panel-b-tutor"], headTutorId: "coordinator-tutor", expectedUpdatedAt: app.updatedAt })).rejects.toMatchObject({ code: "FORBIDDEN" });
  for (const reviewer of ["coordinator", "admin", "head"]) {
    await expect(caller(reviewer).admin.setApplicationStatus({ id, status: "ACCEPTED", expectedUpdatedAt: app.updatedAt })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(reviewer).admin.deleteApplication({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(reviewer).tutor.decideInterview({ applicationId: id, accept: true, comment: "Legacy bypass", expectedUpdatedAt: app.updatedAt })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  expect(await db.approvalRequest.count()).toBe(0);
  expect((await db.tutorApplication.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
});

it.each([true, false])("retains interview records on decision %s and requires every vote, the majority and an Admin/Head chair", async accept => {
  const { id } = await request();
  await expect(panel(id, "coordinator-tutor")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await panel(id);
  await expect(decide(id)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  for (const voter of ["admin", "panel-a", "panel-b"]) await caller(voter).tutor.castInterviewVote({ applicationId: id, accept, comment: "Synthetic panel vote" });
  await expect(decide(id, !accept)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(decide(id, accept, "head")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await decide(id, accept);
  expect(await db.interviewAssignment.count({ where: { applicationId: id } })).toBe(3);
  expect(await db.interviewVote.count({ where: { applicationId: id } })).toBe(3);
  expect((await db.tutorApplication.findUniqueOrThrow({ where: { id } })).status).toBe(accept ? "ACCEPTED" : "REJECTED");
  expect((await eligibleSubjectIds(db, "applicant-tutor")).includes("history-ap")).toBe(accept);
  await expect(panel(id)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(decide(id, !accept)).rejects.toMatchObject({ code: "CONFLICT" });
});

it("preserves old qualifications after rejection, permits resubmission, and never archives the existing tutor", async () => {
  const first = await request();
  await decide(first.id, false);
  await reconcileApplication(db, first.id);
  expect(await eligibleSubjectIds(db, "applicant-tutor")).toEqual(["science-standard"]);
  expect((await db.tutor.findUniqueOrThrow({ where: { id: "applicant-tutor" } })).status).toBe("ACTIVE");
  expect((await request()).id).not.toBe(first.id);
  expect((await caller().qualificationApplication.mine()).requests).toHaveLength(2);
});

it("blocks revoked and inactive tutor submissions, self-review and stale decisions", async () => {
  await db.user.update({ where: { id: "applicant" }, data: { tutorAccessRevoked: true } });
  await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: "applicant" }, data: { tutorAccessRevoked: false } });
  await db.tutor.update({ where: { id: "applicant-tutor" }, data: { status: "OPTED_OUT" } });
  await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.tutor.update({ where: { id: "applicant-tutor" }, data: { status: "ACTIVE" } });
  const { id } = await request("history-ap", "admin");
  await expect(decide(id, true, "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: "admin" }, data: { tutorAccessRevoked: true } });
  await expect(decide(id, true, "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller("head").qualificationApplication.decide({ id, accept: true, comment: "Old form", expectedUpdatedAt: new Date(0) })).rejects.toMatchObject({ code: "CONFLICT" });
});

it("keeps direct review available without interviews but rolls back approval of removed offerings", async () => {
  await db.programFeature.create({ data: { key: "INTERVIEWS", enabled: false } });
  const first = await request();
  await decide(first.id);
  const second = await request("history-ap", "other");
  await db.subjectLevel.update({ where: { id: "ap" }, data: { active: false } });
  await expect(decide(second.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await db.subjectLevel.update({ where: { id: "ap" }, data: { active: true } });
  await db.subject.update({ where: { id: "history-ap" }, data: { active: false } });
  await expect(decide(second.id)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await db.tutorApplication.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PENDING");
  expect(await eligibleSubjectIds(db, "other-tutor")).toEqual([]);
});
