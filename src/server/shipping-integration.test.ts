import { proposeTranslation } from "./translation-drafts";
import { beforeEach, afterAll, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn() },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "./db";
import { createCaller } from "./api/root";
import { emailSender } from "./email/sender";
import { ApprovalQueued } from "./approvals";
import { approvalScope, databaseScope } from "./db-scope";
import { currentPolicy } from "./policy-acceptance";
import { submitSurvey, confirmSurvey, surveyInput } from "./student-survey";
import { prepareStudentAction } from "./student-workflow";
import { requestEmailChange, confirmEmailChange } from "./auth/email-change";
import { resolveTutorLink } from "./auth/tutor-link";

// These tests exercise the merged routers against PostgreSQL, not parallel branch mocks.
const actor = (id: string, role: Session["role"] = "STUDENT") =>
  createCaller({
    db,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
  });
const admin = () => actor("shipping-admin", "ADMIN");
const coordinator = () => actor("shipping-coordinator", "COORDINATOR");
// eslint-disable-next-line @typescript-eslint/unbound-method
const send = vi.mocked(emailSender.send);
let revision: string;
const signup = (email = "shipping-student@example.test") =>
  surveyInput.parse({
    email,
    englishName: "Shipping Student",
    preferredContact: email,
    firstChoiceId: "shipping-subject",
    slotIds: ["shipping-slot"],
    signatureName: "Shipping Student",
    agreed: true,
    policyRevision: revision,
  });
const token = () =>
  /token=([a-f0-9]{64})/.exec(send.mock.calls.at(-1)![0].text)![1]!;
async function ready(
  userId: string,
  action: Parameters<typeof prepareStudentAction>[2],
  target: string,
) {
  const ticket = await prepareStudentAction(db, userId, action, target);
  await db.studentActionConfirmation.update({
    where: { id: ticket.id },
    data: { readyAt: new Date(0) },
  });
  return ticket.id;
}
async function queued(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({
      where: { id: (cause as ApprovalQueued).approvalId },
    });
  }
  throw Error("Expected queued review");
}
async function confirmed() {
  await submitSurvey(db, signup());
  await confirmSurvey(db, token(), "ShippingStudentPassword42");
  const user = await db.user.findUniqueOrThrow({
    where: { email: signup().email },
  });
  const survey = await db.studentSurvey.findFirstOrThrow();
  return { user, survey, student: actor(user.id) };
}
beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw Error("Requires dedicated shipping test database");
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
  send.mockReset().mockResolvedValue(undefined);
  await db.user.createMany({
    data: [
      {
        id: "shipping-admin",
        email: "shipping-admin@example.test",
        role: "ADMIN",
      },
      {
        id: "shipping-coordinator",
        email: "shipping-coordinator@example.test",
        role: "COORDINATOR",
      },
    ],
  });
  await db.term.create({
    data: {
      id: "shipping-term",
      name: "Shipping Intake",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.subject.create({
    data: { id: "shipping-subject", name: "Mathematics" },
  });
  await db.timeSlot.create({
    data: {
      id: "shipping-slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
    },
  });
  await db.tutor.create({
    data: {
      id: "shipping-tutor",
      englishName: "Shipping Tutor",
      status: "ACTIVE",
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Tutee policy",
      body: "Attend and respect one another.",
    },
  });
  revision = (await currentPolicy(db, "tutee-policy")).revision;
});
afterAll(() => db.$disconnect());

it("consumes the coordinator ticket at submission and a fresh reviewer ticket at application, with email after commit", async () => {
  await submitSurvey(db, signup());
  const survey = await db.studentSurvey.findFirstOrThrow();
  const ticket = await ready("shipping-coordinator", "ASSIGN", survey.id);
  const request = await queued(
    coordinator().studentWorkflow.assign({
      id: survey.id,
      subjectId: "shipping-subject",
      tutorId: "shipping-tutor",
      ticket,
    }),
  );
  expect(await db.pairing.count()).toBe(0);
  expect(
    (
      await db.studentActionConfirmation.findUniqueOrThrow({
        where: { id: ticket },
      })
    ).usedAt,
  ).not.toBeNull();
  await expect(
    admin().approval.decide({ id: request.id, approve: true, note: "Checked" }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    admin().approval.decide({
      id: request.id,
      approve: true,
      note: "Checked",
      ticket,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const fresh = await prepareStudentAction(
    db,
    "shipping-admin",
    "ASSIGN",
    survey.id,
  );
  await expect(
    admin().approval.decide({
      id: request.id,
      approve: true,
      note: "Checked",
      ticket: fresh.id,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  send.mockImplementation(async () => {
    expect(approvalScope.getStore()).toBeUndefined();
    expect(databaseScope.getStore()).toBeUndefined();
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).state,
    ).toBe("APPROVED");
  });
  const result = await admin().approval.decide({
    id: request.id,
    approve: true,
    note: "Checked",
    ticket: await ready("shipping-admin", "ASSIGN", survey.id),
  });
  expect(result.emailSent).toBe(true);
  expect(await db.pairing.count()).toBe(1);
  expect(
    (await db.studentSurvey.findUniqueOrThrow({ where: { id: survey.id } }))
      .submittedAt,
  ).toEqual(survey.submittedAt);
});

it("keeps approval pending, assignment absent, and reviewer ticket usable when decision audit fails", async () => {
  await submitSurvey(db, signup());
  const survey = await db.studentSurvey.findFirstOrThrow();
  const request = await queued(
    coordinator().studentWorkflow.assign({
      id: survey.id,
      subjectId: "shipping-subject",
      tutorId: "shipping-tutor",
      ticket: await ready("shipping-coordinator", "ASSIGN", survey.id),
    }),
  );
  const ticket = await ready("shipping-admin", "ASSIGN", survey.id);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION shipping_fail_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'DECISION' THEN RAISE EXCEPTION 'Injected decision audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER shipping_fail_decision BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION shipping_fail_decision()`,
  );
  const sends = send.mock.calls.length;
  try {
    await expect(
      admin().approval.decide({
        id: request.id,
        approve: true,
        note: "Checked",
        ticket,
      }),
    ).rejects.toBeDefined();
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER shipping_fail_decision ON "AuditLog"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION shipping_fail_decision()`);
  }
  expect(await db.pairing.count()).toBe(0);
  expect(send.mock.calls.length).toBe(sends);
  expect(
    (
      await db.studentActionConfirmation.findUniqueOrThrow({
        where: { id: ticket },
      })
    ).usedAt,
  ).toBeNull();
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .state,
  ).toBe("PENDING");
});

it("keeps history, feedback and appeals after a new intake profile and verified email change", async () => {
  const { user, survey, student } = await confirmed();
  const pairing = await db.pairing.create({
    data: {
      tutorId: "shipping-tutor",
      termId: "shipping-term",
      subject: "Mathematics",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
    },
  });
  const session = await db.session.create({
    data: {
      pairingId: pairing.id,
      tutorId: "shipping-tutor",
      date: new Date(),
      startMin: 930,
      endMin: 990,
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
      month: "2026-09",
      schoolYear: "26-27",
      quarter: "Q1",
      tutees: { create: { tuteeId: survey.tuteeId!, status: "PRESENT" } },
    },
  });
  const card = await db.disciplinaryCard.create({
    data: {
      tuteeId: survey.tuteeId!,
      color: "YELLOW",
      source: "TUTOR",
      reason: "Reviewable card",
    },
  });
  await db.term.update({
    where: { id: "shipping-term" },
    data: { active: false },
  });
  await db.term.create({
    data: {
      id: "shipping-next",
      name: "Next intake",
      schoolYear: "26-27",
      quarter: "Q2",
      active: true,
    },
  });
  await submitSurvey(db, signup());
  await confirmSurvey(db, token());
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).studentId,
  ).not.toBe(survey.tuteeId);
  await requestEmailChange(
    user.id,
    "changed-shipping@example.test",
    "ShippingStudentPassword42",
  );
  const code = /code is ([A-Z0-9]{5})/.exec(
    send.mock.calls.at(-1)![0].text,
  )![1]!;
  expect(await confirmEmailChange(user.id, code)).toBe(true);
  expect(
    (await student.student.me({ page: 0 })).sessions.map((s) => s.session.id),
  ).toContain(session.id);
  await student.student.feedback({
    sessionId: session.id,
    rating: 5,
    body: "Feedback on the previous intake",
  });
  await student.student.appeal({
    cardId: card.id,
    body: "Please review this card",
  });
  expect(await db.studentFeedback.count()).toBe(1);
  expect(await db.studentAppeal.count()).toBe(1);
  const mine = await student.studentWorkflow.mine();
  expect(mine).toHaveLength(1);
  await student.studentWorkflow.editAvailability({
    id: mine[0]!.id,
    slotIds: ["shipping-slot"],
  });
  await expect(
    submitSurvey(db, signup("changed-shipping@example.test")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await db.user.create({
    data: { id: "outsider", email: "outsider@example.test", role: "STUDENT" },
  });
  expect(
    (await actor("outsider").student.me({ page: 0 })).sessions,
  ).toHaveLength(0);
  await expect(
    actor("outsider").student.feedback({
      sessionId: session.id,
      rating: 1,
      body: "Not mine",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("preserves quarter withdrawal restrictions after a verified account email change", async () => {
  const { user, survey, student } = await confirmed();
  await admin().studentWorkflow.assign({
    id: survey.id,
    subjectId: "shipping-subject",
    tutorId: "shipping-tutor",
    ticket: await ready("shipping-admin", "ASSIGN", survey.id),
  });
  await student.studentWorkflow.applyAbort({
    id: survey.id,
    reason: "Leaving this quarter",
    ticket: await ready(user.id, "ABORT", survey.id),
  });
  const review = await db.studentRequestReview.findFirstOrThrow();
  const proposal = await queued(
    coordinator().studentWorkflow.resolveReview({
      id: review.id,
      approve: true,
      ticket: await ready("shipping-coordinator", "APPROVE", review.id),
    }),
  );
  expect(await db.pairingTutee.count()).toBe(1);
  await admin().approval.decide({
    id: proposal.id,
    approve: true,
    note: "Withdrawal confirmed",
    ticket: await ready("shipping-admin", "APPROVE", review.id),
  });
  expect(await db.pairingTutee.count()).toBe(0);
  await requestEmailChange(
    user.id,
    "withdrawn-new@example.test",
    "ShippingStudentPassword42",
  );
  expect(
    await confirmEmailChange(
      user.id,
      /code is ([A-Z0-9]{5})/.exec(send.mock.calls.at(-1)![0].text)![1]!,
    ),
  ).toBe(true);
  await expect(
    submitSurvey(db, signup("withdrawn-new@example.test")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("does not let the legacy consent endpoint bypass the student policy timer", async () => {
  const { student, user } = await confirmed();
  await admin().admin.upsertPolicy({
    slug: "tutee-policy",
    locale: "en",
    title: "Updated policy",
    body: "Updated participation rules",
  });
  const policy = await currentPolicy(db, "tutee-policy");
  await expect(
    student.student.acceptPolicy({
      slug: "tutee-policy",
      revision: policy.revision,
      signature: "Student",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await student.student.acceptPolicy({
    slug: "tutee-policy",
    revision: policy.revision,
    signature: "Student",
    ticket: await ready(user.id, "POLICY", policy.revision),
  });
  expect(
    (await student.student.policy({ slug: "tutee-policy" })).accepted,
  ).toBe(true);
});

it("requires just one admin approval for a coordinator's translation review and rejects a changed destination", async () => {
  await proposeTranslation(
    db,
    { role: "VIEWER", user: { id: "translator" } },
    "localization.setString",
    { locale: "en", key: "approvals.title", value: "Reviewed translations" },
  );
  const draft = await db.translationDraft.findFirstOrThrow({
    orderBy: { createdAt: "desc" },
  });
  const request = await queued(
    coordinator().translationReview.decide({
      id: draft.id,
      approve: true,
      expectedUpdatedAt: draft.updatedAt,
    }),
  );
  expect(await db.messageOverride.count()).toBe(0);
  await admin().approval.decide({
    id: request.id,
    approve: true,
    note: "Translation checked",
  });
  expect(await db.approvalRequest.count()).toBe(1);
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .state,
  ).toBe("APPROVED");
  expect((await db.messageOverride.findFirstOrThrow()).value).toBe(
    "Reviewed translations",
  );
  await proposeTranslation(
    db,
    { role: "VIEWER", user: { id: "translator" } },
    "localization.setString",
    { locale: "en", key: "approvals.title", value: "Older proposal" },
  );
  const next = await db.translationDraft.findFirstOrThrow({
    orderBy: { createdAt: "desc" },
  });
  const stale = await queued(
    coordinator().translationReview.decide({
      id: next.id,
      approve: true,
      expectedUpdatedAt: next.updatedAt,
    }),
  );
  await admin().localization.setString({
    locale: "en",
    key: "approvals.title",
    value: "New live text",
  });
  await expect(
    admin().approval.decide({ id: stale.id, approve: true, note: "Stale" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("queues calendar and feedback visibility changes without applying them early", async () => {
  const calendar = await queued(
    coordinator().student.setCalendarDay({
      date: "2026-10-01",
      isSchoolDay: false,
      note: "Holiday",
    }),
  );
  const feedback = await queued(
    coordinator().student.setFeedbackSettings({ share: true }),
  );
  expect(await db.schoolCalendarDay.count()).toBe(0);
  expect(await db.studentSettings.count()).toBe(0);
  await admin().approval.decide({
    id: calendar.id,
    approve: true,
    note: "School calendar checked",
  });
  await admin().approval.decide({
    id: feedback.id,
    approve: true,
    note: "Visibility checked",
  });
  expect(await db.schoolCalendarDay.count()).toBe(1);
  expect(
    (await db.studentSettings.findFirstOrThrow()).shareFeedbackWithTutors,
  ).toBe(true);
});

it.each(["VIEWER", "STUDENT"] as const)(
  "a verified public %s account cannot claim a matching legacy tutor",
  async (role) => {
    await db.tutor.update({
      where: { id: "shipping-tutor" },
      data: { email: "public@example.test" },
    });
    await db.user.create({
      data: {
        id: "public-account",
        email: "public@example.test",
        role,
        emailVerifiedAt: new Date(),
      },
    });
    expect(
      await resolveTutorLink(db, "public-account", "public@example.test"),
    ).toBeNull();
    await db.user.update({
      where: { id: "public-account" },
      data: { tutorId: "shipping-tutor" },
    });
    expect(
      await resolveTutorLink(db, "public-account", "public@example.test"),
    ).toBe("shipping-tutor");
  },
);

it("queues a historical correction and applies it atomically under the reviewer's identity", async () => {
  const { survey } = await confirmed();
  const pairing = await db.pairing.create({
    data: {
      tutorId: "shipping-tutor",
      termId: "shipping-term",
      subject: "Mathematics",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
    },
  });
  const session = await db.session.create({
    data: {
      pairingId: pairing.id,
      tutorId: "shipping-tutor",
      date: new Date("2026-09-01"),
      startMin: 930,
      endMin: 990,
      durationMin: 60,
      shFactor: 2,
      shCount: 2,
      month: "2026-09",
      schoolYear: "26-27",
      quarter: "Q1",
      tutees: { create: { tuteeId: survey.tuteeId!, status: "PRESENT" } },
    },
  });
  const request = await queued(
    coordinator().corrections.correctAttendance({
      id: session.id,
      expectedUpdatedAt: session.updatedAt,
      reason: "Corrected finish time",
      date: session.date,
      startMin: 930,
      endMin: 1020,
      tutorStatus: "PRESENT",
      tutorAbsentReason: null,
      comments: null,
      online: true,
      actualRoomId: null,
      ratingPreparedness: 4,
      ratingParticipation: 4,
      ratingUnderstanding: 4,
      ratingBehavior: 4,
      ratingProgress: 4,
      tutees: [
        { tuteeId: survey.tuteeId!, status: "PRESENT", absenceReason: null },
      ],
    }),
  );
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: session.id } })).endMin,
  ).toBe(990);
  await admin().approval.decide({
    id: request.id,
    approve: true,
    note: "Attendance evidence checked",
  });
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: session.id } })).endMin,
  ).toBe(1020);
  expect(
    await db.auditLog.count({
      where: {
        userId: "shipping-admin",
        approvalId: request.id,
        operation: "corrections.correctAttendance",
      },
    }),
  ).toBeGreaterThan(0);
});
