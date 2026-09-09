import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "../root";
import { db } from "~/server/db";
import { ApprovalQueued, parseProposal } from "~/server/approvals";
import { databaseScope } from "~/server/db-scope";
import { APPROVAL_OPERATIONS } from "~/lib/approval-policy";
import { appRouter } from "../root";
import type { AnyTRPCProcedure } from "@trpc/server";

const actor = (id: string, role: Session["role"] = "COORDINATOR") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: "Cookie name", email: `${id}@example.test` },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
const trainee = () => actor("approval-coordinator");
const admin = () => actor("approval-admin", "ADMIN");
const head = () => actor("approval-head", "HEAD");
async function queued(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    const cause = (error as { cause: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({
      where: { id: (cause as ApprovalQueued).approvalId },
    });
  }
  throw new Error("Expected a queued proposal, not a successful live save");
}

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !["/shbs_coordinator_approvals_test", "/shbs_shipping_test"].includes(
      url.pathname,
    )
  )
    throw Error("Approval tests require the dedicated local database");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: [
      ["approval-coordinator", "COORDINATOR", "Alex Newcomer"],
      ["approval-other", "COORDINATOR", "Alex Newcomer"],
      ["approval-admin", "ADMIN", "Morgan Admin"],
      ["approval-head", "HEAD", "Jordan Head"],
      ["approval-tutor", "TUTOR", "Taylor Tutor"],
      ["approval-viewer", "VIEWER", "Robin Viewer"],
      ["approval-crew", "CREW", "Casey Crew"],
    ].map(([id, role, name]) => ({
      id: id!,
      role: role as Session["role"],
      name,
      email: `${id}@example.test`,
    })),
  });
  await db.term.create({
    data: {
      id: "approval-term",
      name: "Approval Term",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
});
afterAll(() => db.$disconnect());

it("queues coordinator changes without live writes and deduplicates retries", async () => {
  const request = await queued(() =>
    trainee().admin.createRoom({ name: "Training Room" }),
  );
  const again = await queued(() =>
    trainee().admin.createRoom({ name: "Training Room" }),
  );
  expect(again.id).toBe(request.id);
  expect(await db.room.count()).toBe(0);
  expect(await db.approvalRequest.count()).toBe(1);
  expect(await db.auditLog.findMany()).toMatchObject([
    {
      kind: "SUBMISSION",
      userId: "approval-coordinator",
      userName: "Alex Newcomer",
      approvalId: request.id,
    },
  ]);
  expect(
    (await db.notification.findMany()).map((n) => n.userId).sort(),
  ).toEqual(["approval-admin", "approval-head"]);
});

it("validates input and refuses arbitrary operations before queuing", async () => {
  await expect(trainee().admin.createRoom({ name: "" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    parseProposal("admin.setUserRole", {
      userId: "approval-coordinator",
      role: "HEAD",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(parseProposal("__proto__", {})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await db.approvalRequest.count()).toBe(0);
});

it("approves and applies exactly once with separate requester and reviewer evidence", async () => {
  const request = await queued(() =>
    trainee().admin.createRoom({ name: "Training Room" }),
  );
  await head().approval.decide({
    id: request.id,
    approve: true,
    note: "Room booking confirmed.",
  });
  expect(await db.room.count({ where: { name: "Training Room" } })).toBe(1);
  expect(
    await db.approvalRequest.findUnique({ where: { id: request.id } }),
  ).toMatchObject({
    state: "APPROVED",
    reviewerId: "approval-head",
    reviewNote: "Room booking confirmed.",
  });
  const history = await admin().admin.auditLog({ approvalId: request.id });
  expect(history.map((e) => [e.kind, e.userId])).toEqual(
    expect.arrayContaining([
      ["SUBMISSION", "approval-coordinator"],
      ["DECISION", "approval-head"],
      ["ACTION", "approval-head"],
    ]),
  );
  await expect(
    admin().approval.decide({
      id: request.id,
      approve: true,
      note: "Second review",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.room.count()).toBe(1);
});

it("rejects with feedback without applying the proposal", async () => {
  const request = await queued(() =>
    trainee().admin.createRoom({ name: "Training Room" }),
  );
  await admin().approval.decide({
    id: request.id,
    approve: false,
    note: "Check room availability first.",
  });
  expect(await db.room.count()).toBe(0);
  expect((await trainee().approval.list({})).rows[0]).toMatchObject({
    state: "REJECTED",
    reviewNote: "Check room availability first.",
  });
  expect(
    await db.notification.findFirst({
      where: { userId: "approval-coordinator" },
    }),
  ).toMatchObject({ title: "Change rejected" });
});

it("requires review notes and forbids coordinator approval or another user's withdrawal", async () => {
  const request = await queued(() =>
    trainee().admin.createRoom({ name: "Training Room" }),
  );
  await expect(
    trainee().approval.decide({
      id: request.id,
      approve: true,
      note: "Self review",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    admin().approval.decide({ id: request.id, approve: true, note: " " }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    actor("approval-other").approval.cancel({ id: request.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (
      await actor("approval-other").approval.list({
        requesterId: "approval-coordinator",
      })
    ).total,
  ).toBe(0);
  await trainee().approval.cancel({ id: request.id });
  await expect(
    admin().approval.decide({
      id: request.id,
      approve: true,
      note: "Too late",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("blocks self-approval even after the requester is promoted", async () => {
  const request = await queued(() =>
    trainee().admin.createRoom({ name: "Training Room" }),
  );
  await db.user.update({
    where: { id: "approval-coordinator" },
    data: { role: "ADMIN" },
  });
  await expect(
    trainee().approval.decide({
      id: request.id,
      approve: true,
      note: "Now an admin",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("uses current database roles and suspension state instead of stale session claims", async () => {
  await expect(
    actor("approval-coordinator", "HEAD").admin.setUserRole({
      userId: "approval-other",
      role: "ADMIN",
      confirmPassword: "secret",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({
    where: { id: "approval-admin" },
    data: { role: "COORDINATOR" },
  });
  const request = await queued(() =>
    admin().admin.createRoom({ name: "Demoted admin proposal" }),
  );
  await db.user.update({
    where: { id: "approval-admin" },
    data: { suspendedAt: new Date() },
  });
  await expect(
    head().approval.decide({ id: request.id, approve: true, note: "Approve" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    admin().admin.createRoom({ name: "Forbidden" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it.each(["TUTOR", "VIEWER", "CREW"] as const)(
  "refuses management proposals and queue access for %s",
  async (role) => {
    const user = actor(`approval-${role.toLowerCase()}`, role);
    await expect(
      user.admin.createRoom({ name: "Forbidden" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(user.approval.list({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  },
);

it("detects changed target records and a program rollover", async () => {
  const room = await db.room.create({ data: { name: "Original" } });
  const request = await queued(() =>
    trainee().admin.updateRoom({ id: room.id, name: "Proposed" }),
  );
  await admin().admin.updateRoom({ id: room.id, name: "Updated by admin" });
  await expect(
    head().approval.decide({
      id: request.id,
      approve: true,
      note: "Stale review",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const second = await queued(() =>
    trainee().admin.createRoom({ name: "New term room" }),
  );
  await db.term.update({
    where: { id: "approval-term" },
    data: { quarter: "Q2" },
  });
  await expect(
    head().approval.decide({
      id: second.id,
      approve: true,
      note: "Stale term",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("rolls back a failed domain mutation and leaves the request pending", async () => {
  await db.room.create({ data: { name: "Already exists" } });
  const request = await queued(() =>
    trainee().admin.createRoom({ name: "Already exists" }),
  );
  await expect(
    admin().approval.decide({
      id: request.id,
      approve: true,
      note: "Check uniqueness",
    }),
  ).rejects.toThrow();
  expect(
    await db.approvalRequest.findUnique({ where: { id: request.id } }),
  ).toMatchObject({ state: "PENDING", reviewerId: null });
  expect(await db.auditLog.count({ where: { kind: "DECISION" } })).toBe(0);
  expect(databaseScope.getStore()).toBeUndefined();
});

it("serializes competing approvals without double application", async () => {
  const request = await queued(() =>
    trainee().admin.createRoom({ name: "One room" }),
  );
  const results = await Promise.allSettled([
    admin().approval.decide({
      id: request.id,
      approve: true,
      note: "First reviewer",
    }),
    head().approval.decide({
      id: request.id,
      approve: true,
      note: "Second reviewer",
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.room.count()).toBe(1);
  expect(
    await db.auditLog.count({
      where: { kind: "DECISION", approvalId: request.id },
    }),
  ).toBe(1);
});

it("queues translation publishing and detects edits to compound-key targets", async () => {
  const request = await queued(() =>
    trainee().localization.setString({
      locale: "en",
      key: "approvals.title",
      value: "Training approvals",
    }),
  );
  expect(await db.messageOverride.count()).toBe(0);
  await admin().localization.setString({
    locale: "en",
    key: "approvals.title",
    value: "Admin approvals",
  });
  await expect(
    head().approval.decide({
      id: request.id,
      approve: true,
      note: "Stale translation",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("keeps every policy operation tied to an actual mutation", () => {
  const procedures = appRouter._def.procedures as unknown as Record<
    string,
    AnyTRPCProcedure
  >;
  for (const operation of Object.keys(APPROVAL_OPERATIONS))
    expect(procedures[operation]?._def.type, operation).toBe("mutation");
});

it("applies a nested transaction and its helper audit records as one decision", async () => {
  const tutor = await db.tutor.create({
    data: { englishName: "Training Tutor" },
  });
  const student = await db.tutee.create({
    data: { englishName: "Training Student" },
  });
  const slot = await db.timeSlot.create({
    data: {
      label: "Monday training",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  const pairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: "approval-term",
      subject: "Math",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      timeSlotId: slot.id,
    },
  });
  const request = await queued(() =>
    trainee().admin.updatePairing({
      id: pairing.id,
      tutorId: tutor.id,
      timeSlotId: slot.id,
      subject: "Physics",
      tuteeIds: [student.id],
    }),
  );
  await admin().approval.decide({
    id: request.id,
    approve: true,
    note: "Roster checked",
  });
  expect(
    await db.pairing.findUnique({
      where: { id: pairing.id },
      include: { tutees: true },
    }),
  ).toMatchObject({ subject: "Physics", tutees: [{ tuteeId: student.id }] });
  expect(databaseScope.getStore()).toBeUndefined();
});

it("requires approval for a coordinator chair's final interview decision", async () => {
  const tutor = await db.tutor.create({
    data: { englishName: "Trainee Chair" },
  });
  await db.user.update({
    where: { id: "approval-coordinator" },
    data: { tutorId: tutor.id },
  });
  const application = await db.tutorApplication.create({
    data: {
      name: "Interview Applicant",
      email: "applicant@example.test",
      status: "INTERVIEW",
    },
  });
  await db.interviewAssignment.create({
    data: { applicationId: application.id, tutorId: tutor.id, isHead: true },
  });
  const subject = await db.subject.create({
    data: { name: "Interview mathematics" },
  });
  await db.applicationSubjectIntent.create({
    data: { applicationId: application.id, subjectId: subject.id },
  });
  await db.tutorQualification.create({
    data: {
      tutorId: tutor.id,
      subjectId: subject.id,
      approvedById: "approval-admin",
    },
  });
  // A four-person qualified panel ties 2–2. The coordinator chair's choice must survive admin review.
  for (let index = 0; index < 3; index++) {
    const member = await db.tutor.create({
      data: { englishName: "Panel " + index, status: "ACTIVE" },
    });
    await db.user.create({
      data: {
        email: "panel-" + index + "@example.test",
        role: "TUTOR",
        tutorId: member.id,
      },
    });
    await db.interviewAssignment.create({
      data: { applicationId: application.id, tutorId: member.id },
    });
    await db.interviewVote.create({
      data: {
        applicationId: application.id,
        tutorId: member.id,
        accept: index < 2,
      },
    });
  }
  await db.interviewVote.create({
    data: { applicationId: application.id, tutorId: tutor.id, accept: false },
  });
  const request = await queued(() =>
    trainee().tutor.decideInterview({
      applicationId: application.id,
      accept: false,
      comment: "More preparation needed",
      expectedUpdatedAt: application.updatedAt,
    }),
  );
  expect(
    await db.tutorApplication.findUnique({ where: { id: application.id } }),
  ).toMatchObject({ status: "INTERVIEW" });
  await admin().approval.decide({
    id: request.id,
    approve: true,
    note: "Reviewed interview evidence",
  });
  expect(
    await db.tutorApplication.findUnique({ where: { id: application.id } }),
  ).toMatchObject({
    status: "REJECTED",
    decidedByTutorId: tutor.id,
    decisionComment: "More preparation needed",
  });
});

it("filters all actor IDs including deleted users, combined decisions, dates and cursor pages", async () => {
  const date = new Date("2026-09-09T10:00:00Z");
  await db.auditLog.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      id: `history-${String(i).padStart(3, "0")}`,
      userId: "deleted-user",
      userName: "Alex Newcomer",
      kind: "DECISION",
      operation: "admin.reviewCard",
      action: "Reviewed attendance appeal",
      entity: "Card",
      createdAt: date,
    })),
  });
  await db.auditLog.create({
    data: {
      userId: "approval-coordinator",
      userName: "Alex Newcomer",
      action: "Other user",
      entity: "Card",
      createdAt: date,
    },
  });
  const filter = {
    userId: "deleted-user",
    kind: "DECISION" as const,
    operation: "admin.reviewCard",
    entity: "Card",
    search: "ATTENDANCE",
    from: new Date("2026-09-09"),
    until: new Date("2026-09-10"),
  };
  const first = await admin().admin.auditLog(filter);
  const next = await admin().admin.auditLog({
    ...filter,
    cursor: first.at(-1)!.id,
  });
  expect(first).toHaveLength(100);
  expect(next).toHaveLength(5);
  expect(new Set([...first, ...next].map((e) => e.id)).size).toBe(105);
  expect(await admin().admin.auditLog({ ...filter, until: date })).toHaveLength(
    0,
  );
  expect((await admin().admin.auditFilterOptions()).users).toEqual(
    expect.arrayContaining([
      { id: "deleted-user", label: "Alex Newcomer" },
      { id: "approval-coordinator", label: "Alex Newcomer" },
    ]),
  );
});

it("logs participant actions without secrets and masks decision details from viewers", async () => {
  const notification = await db.notification.create({
    data: { userId: "approval-tutor", title: "Private notification" },
  });
  await actor("approval-tutor", "TUTOR").notification.markRead({
    id: notification.id,
  });
  expect(
    await db.auditLog.findFirst({ where: { userId: "approval-tutor" } }),
  ).toMatchObject({
    kind: "ACTION",
    operation: "notification.markRead",
    details: null,
  });
  await db.auditLog.create({
    data: {
      action: "Review",
      entity: "Card",
      details: { note: "Private review note" },
      undoData: { private: true },
    },
  });
  const rows = await actor("approval-viewer", "VIEWER").admin.auditLog({});
  expect(rows.every((r) => r.details === null && r.undoData === null)).toBe(
    true,
  );
});
