import { beforeEach, afterAll, describe, it, expect, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => true,
}));
vi.mock("~/server/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));
import { emailSender } from "~/server/email/sender";
import { db } from "~/server/db";
import { currentPolicy } from "~/server/policy-acceptance";
import {
  submitSurvey,
  confirmSurvey,
  inspectSurvey,
  pendingSurveys,
  resendSurvey,
  surveyInput,
} from "./student-survey";
import { verifyPassword, hashPassword } from "~/server/auth/password";
import { createCallerFactory } from "~/server/api/trpc";
import { tuteeRouter } from "~/server/api/routers/tutee";
import { adminRouter } from "~/server/api/routers/admin";
import { resolveTutorLink } from "~/server/auth/tutor-link";
import { ensureUserUsername } from "~/server/auth/username";
import {
  prepareStudentAction,
  assignStudentRequest,
  editStudentAvailability,
  recallStudentRequest,
  applyStudentAbort,
  applyScheduleRejection,
  resolveStudentReview,
  acceptStudentPolicy,
  studentPolicyStatus,
  studentRequestRows,
} from "./student-workflow";
import {
  expireStudentRequests,
  VERIFICATION_WEEK_MS,
} from "./student-request-state";
import { studentWorkflowRouter } from "./api/routers/student-workflow";

async function ready(
  action: Parameters<typeof prepareStudentAction>[2],
  target: string,
  userId = "manager",
) {
  const ticket = await prepareStudentAction(db, userId, action, target);
  await db.studentActionConfirmation.update({
    where: { id: ticket.id },
    data: { readyAt: new Date(0) },
  });
  return ticket.id;
}
async function assigned(verify = false) {
  await submitSurvey(db, input());
  if (verify) await confirmSurvey(db, lastToken(), password);
  const row = await db.studentSurvey.findFirstOrThrow();
  const tutor = await db.tutor.create({
    data: { englishName: "Tutor One", status: "ACTIVE" },
  });
  const tutorUser = await db.user.create({
    data: { email: "tutor@example.test", role: "TUTOR", tutorId: tutor.id },
  });
  await assignStudentRequest(
    db,
    row.id,
    "manager",
    await ready("ASSIGN", row.id),
    "survey-math",
    tutor.id,
  );
  const survey = await db.studentSurvey.findUniqueOrThrow({
    where: { id: row.id },
  });
  const pairing = await db.pairing.findFirstOrThrow();
  return { row: survey, tutor, tutorUser, pairing };
}

// The mocked sender does not access `this`.
// eslint-disable-next-line @typescript-eslint/unbound-method
const send = vi.mocked(emailSender.send);
const email = "student@example.test";
const password = "StudentTestPassword42";
let revision: string;
const input = () =>
  surveyInput.parse({
    englishName: "Student One",
    email,
    preferredContact: email,
    firstChoiceId: "survey-math",
    slotIds: ["survey-slot"],
    signatureName: "Student One",
    agreed: true,
    policyRevision: revision,
  });
const lastToken = () => {
  const text = send.mock.calls.at(-1)?.[0].text ?? "";
  const token = /token=([a-f0-9]{64})/.exec(text)?.[1];
  if (!token) throw Error("No emailed verification token");
  return token;
};

beforeEach(async () => {
  // This suite owns a dedicated DB; refuse destructive fixture setup on any other database.
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !["/shbs_survey_first_test", "/shbs_shipping_test"].includes(url.pathname)
  )
    throw Error("Requires isolated shbs_survey_first_test database");
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
  await db.term.create({
    data: {
      id: "survey-term",
      name: "Survey Intake",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.subject.create({
    data: { id: "survey-math", name: "Mathematics", active: true },
  });
  await db.timeSlot.create({
    data: {
      id: "survey-slot",
      label: "After School",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
      active: true,
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Student Policy",
      body: "Attend on time and respect your tutor.",
    },
  });
  revision = (await currentPolicy(db, "tutee-policy")).revision;
});
afterAll(() => db.$disconnect());

describe("survey-first enrollment", () => {
  it("keeps a previously delivered link usable after two concurrent failed resends", async () => {
    await submitSurvey(db, input());
    const token = lastToken();
    const original = await db.studentSurvey.findFirstOrThrow();
    send.mockRejectedValue(Error("SMTP down"));
    expect(
      await Promise.all([resendSurvey(db, email), resendSurvey(db, email)]),
    ).toEqual([false, false]);
    expect(await db.studentSurvey.findFirstOrThrow()).toEqual(original);
    await expect(confirmSurvey(db, token, password)).resolves.toEqual({
      ok: true,
    });
  });
  it("cannot resurrect a request confirmed while a resend is being delivered", async () => {
    await submitSurvey(db, input());
    const originalToken = lastToken();
    send.mockImplementationOnce(async () => {
      await confirmSurvey(db, originalToken, password);
    });
    expect(await resendSurvey(db, email)).toBe(true);
    await expect(
      confirmSurvey(db, lastToken(), password),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.tutee.count()).toBe(1);
  });
  it.each(["deactivated", "deleted"])(
    "preserves an unverified request when its slot is %s",
    async (change) => {
      await submitSurvey(db, input());
      const original = await db.studentSurvey.findFirstOrThrow();
      if (change === "deleted")
        await db.timeSlot.delete({ where: { id: "survey-slot" } });
      else
        await db.timeSlot.update({
          where: { id: "survey-slot" },
          data: { active: false },
        });
      await expect(
        confirmSurvey(db, lastToken(), password),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await db.user.count()).toBe(0);
      expect(await db.studentSurvey.findFirstOrThrow()).toEqual(original);
    },
  );
  it("keeps preference rank and availability in the emailed request review", async () => {
    await db.subject.create({
      data: { id: "aaa-science", name: "Science", active: true },
    });
    await submitSurvey(db, { ...input(), secondChoiceId: "aaa-science" });
    expect(await inspectSurvey(db, lastToken())).toMatchObject({
      subjects: ["Mathematics", "Science"],
      preferredContact: email,
      slots: [{ id: "survey-slot", startMin: 960 }],
    });
  });
  it("does not auto-link a public student to a legacy tutor with the same email", async () => {
    const tutor = await db.tutor.create({
      data: { englishName: "Legacy Tutor", email },
    });
    await submitSurvey(db, input());
    await confirmSurvey(db, lastToken(), password);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await resolveTutorLink(db, user.id, email)).toBeNull();
    expect(await ensureUserUsername(user.id)).toBe("");
    await db.user.update({
      where: { id: user.id },
      data: { tutorId: tutor.id },
    });
    expect(await resolveTutorLink(db, user.id, email)).toBe(tutor.id);
  });
  it("protects a linked login email from administrative tutee contact edits", async () => {
    await db.user.create({
      data: { id: "admin", email: "admin-fixture@example.test", role: "ADMIN" },
    });
    await submitSurvey(db, input());
    await confirmSurvey(db, lastToken(), password);
    const tutee = await db.tutee.findFirstOrThrow();
    const caller = createCallerFactory(adminRouter)({
      db,
      headers: new Headers(),
      session: {
        user: { id: "admin" },
        role: "ADMIN",
        tutorId: null,
        expires: "2099-01-01",
      },
    });
    await expect(
      caller.updateTutee({
        id: tutee.id,
        expectedUpdatedAt: tutee.updatedAt,
        englishName: tutee.englishName,
        status: "PENDING",
        email: "changed@example.test",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.updateTutee({
      id: tutee.id,
      expectedUpdatedAt: tutee.updatedAt,
      englishName: "Updated Name",
      status: "PENDING",
    });
    expect((await db.tutee.findFirstOrThrow()).email).toBe(email);
  });
  it("finishes a pre-created passwordless account without changing its role", async () => {
    await db.user.create({
      data: { email, role: "TUTOR", passwordHash: null },
    });
    await submitSurvey(db, input());
    expect(await inspectSurvey(db, lastToken())).toMatchObject({
      needsAccount: true,
    });
    await expect(confirmSurvey(db, lastToken())).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await confirmSurvey(db, lastToken(), password);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe("TUTOR");
    expect(verifyPassword(password, user.passwordHash!)).toBe(true);
  });
  it("sends a sign-in reminder for an already-confirmed duplicate without replacing the survey", async () => {
    await submitSurvey(db, input());
    await confirmSurvey(db, lastToken(), password);
    const first = await db.studentSurvey.findFirstOrThrow();
    await submitSurvey(db, { ...input(), englishName: "Changed name" });
    expect(send.mock.calls.at(-1)?.[0].text).toContain("/signin");
    expect(send.mock.calls.at(-1)?.[0].text).not.toContain("token=");
    expect(await db.studentSurvey.findFirstOrThrow()).toEqual(first);
  });
  it("shows unverified surveys to management without creating an assignable student or account", async () => {
    await submitSurvey(db, input());
    expect(await db.user.count()).toBe(0);
    expect(await db.tutee.count()).toBe(0);
    expect(await pendingSurveys(db)).toMatchObject([
      { email, unverified: true, firstChoice: { name: "Mathematics" } },
    ]);
    expect(send.mock.calls[0]?.[0].text).toContain("/signup/account?token=");
  });
  it("requires a valid login email and explicit policy acceptance", () => {
    expect(surveyInput.safeParse({ ...input(), email: "" }).success).toBe(
      false,
    );
    expect(surveyInput.safeParse({ ...input(), agreed: false }).success).toBe(
      false,
    );
    expect(
      surveyInput.parse({ ...input(), email: " Student@Example.Test " }).email,
    ).toBe(email);
  });
  it("enforces the opening time for direct public submissions", async () => {
    await db.term.update({
      where: { id: "survey-term" },
      data: { signupOpensAt: new Date(Date.now() + 60000) },
    });
    await expect(submitSurvey(db, input())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(await db.studentSurvey.count()).toBe(0);
  });
  it("rejects stale consent and inactive subjects or slots without reserving a timestamp", async () => {
    await expect(
      submitSurvey(db, { ...input(), policyRevision: "old" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      submitSurvey(db, { ...input(), secondChoiceId: "survey-math" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await db.timeSlot.update({
      where: { id: "survey-slot" },
      data: { active: false },
    });
    await expect(submitSurvey(db, input())).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await db.studentSurvey.count()).toBe(0);
  });
  it("preserves the first payload and timestamp across duplicate surveys and link resends", async () => {
    await submitSurvey(db, input());
    const first = await db.studentSurvey.findFirstOrThrow();
    const token = lastToken();
    await submitSurvey(db, { ...input(), englishName: "Changed" });
    await resendSurvey(db, email);
    const latest = await db.studentSurvey.findFirstOrThrow();
    expect(latest.submittedAt).toEqual(first.submittedAt);
    expect(latest.payload).toEqual(first.payload);
    expect(latest.tokenHash).not.toEqual(first.tokenHash);
    await expect(inspectSurvey(db, token)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await db.studentSurvey.count()).toBe(1);
  });
  it("retains a saved survey when mail delivery fails and recovers without losing priority", async () => {
    send.mockRejectedValueOnce(Error("SMTP unavailable"));
    expect(await submitSurvey(db, input())).toMatchObject({
      ok: true,
      emailSent: false,
    });
    const saved = await db.studentSurvey.findFirstOrThrow();
    expect(await resendSurvey(db, email)).toBe(true);
    expect((await db.studentSurvey.findFirstOrThrow()).submittedAt).toEqual(
      saved.submittedAt,
    );
  });
  it("inspecting the email link does not create or confirm an account", async () => {
    await submitSurvey(db, input());
    expect(await inspectSurvey(db, lastToken())).toMatchObject({
      email,
      needsAccount: true,
    });
    expect(await db.user.count()).toBe(0);
    expect((await db.studentSurvey.findFirstOrThrow()).confirmedAt).toBeNull();
  });
  it("creates a verified account and transfers the original submission time and consent", async () => {
    await submitSurvey(db, input());
    const original = await db.studentSurvey.findFirstOrThrow();
    await confirmSurvey(db, lastToken(), password);
    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { student: true },
    });
    expect(user.role).toBe("STUDENT");
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(verifyPassword(password, user.passwordHash!)).toBe(true);
    expect(user.student?.signupSubmittedAt).toEqual(original.submittedAt);
    expect((await db.policyAcceptance.findFirstOrThrow()).snapshot).toEqual(
      original.policySnapshot,
    );
    expect(await pendingSurveys(db)).toEqual([]);
  });
  it("keeps first-come priority when the later student confirms first", async () => {
    await submitSurvey(db, input());
    const firstToken = lastToken();
    await submitSurvey(db, { ...input(), email: "later@example.test" });
    const secondToken = lastToken();
    await confirmSurvey(db, secondToken, password);
    await confirmSurvey(db, firstToken, password);
    const rows = await db.tutee.findMany({
      orderBy: { signupSubmittedAt: "asc" },
    });
    expect(rows.map((r) => r.email)).toEqual([email, "later@example.test"]);
  });
  it("links existing accounts without resetting their password or role", async () => {
    const user = await db.user.create({
      data: {
        email,
        role: "COORDINATOR",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    });
    await submitSurvey(db, input());
    expect(await inspectSurvey(db, lastToken())).toMatchObject({
      needsAccount: false,
    });
    await confirmSurvey(db, lastToken(), "IgnoredNewPassword");
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.passwordHash).toBe(user.passwordHash);
    expect(updated.role).toBe("COORDINATOR");
    expect(updated.studentId).not.toBeNull();
  });
  it("rejects expired links, then permits recovery without resetting the timestamp", async () => {
    await submitSurvey(db, input());
    await db.studentSurvey.updateMany({ data: { expiresAt: new Date(0) } });
    await expect(
      confirmSurvey(db, lastToken(), password),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await resendSurvey(db, email);
    await expect(confirmSurvey(db, lastToken(), password)).resolves.toEqual({
      ok: true,
    });
  });
  it("consumes a link only once even when two confirmations race", async () => {
    await submitSurvey(db, input());
    const token = lastToken();
    const outcomes = await Promise.allSettled([
      confirmSurvey(db, token, password),
      confirmSurvey(db, token, password),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count()).toBe(1);
    expect(await db.tutee.count()).toBe(1);
  });
  it("rejects confirmations for a ended intake before creating an account", async () => {
    await submitSurvey(db, input());
    await db.term.updateMany({ data: { active: false } });
    await expect(
      confirmSurvey(db, lastToken(), password),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.user.count()).toBe(0);
  });
  it("requires a password for a new account and preserves the token for retry", async () => {
    await submitSurvey(db, input());
    await expect(confirmSurvey(db, lastToken())).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await db.studentSurvey.findFirstOrThrow()).confirmedAt).toBeNull();
  });
  it("does not grant public or student callers access to management's unverified queue", async () => {
    await db.user.create({
      data: {
        id: "student",
        email: "student-fixture@example.test",
        role: "STUDENT",
      },
    });
    const caller = createCallerFactory(tuteeRouter);
    await expect(
      caller({ db, headers: new Headers(), session: null }).pendingSurveys(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller({
        db,
        headers: new Headers(),
        session: {
          user: { id: "student" },
          role: "STUDENT",
          tutorId: null,
          expires: "2099-01-01",
        },
      }).pendingSurveys(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("re-enrolls the same identity in a new intake with a fresh priority timestamp", async () => {
    await submitSurvey(db, input());
    await confirmSurvey(db, lastToken(), password);
    const first = await db.tutee.findFirstOrThrow();
    await db.term.updateMany({ data: { active: false } });
    await db.term.create({
      data: {
        id: "next-term",
        name: "Next",
        schoolYear: "26-27",
        quarter: "Q2",
        active: true,
      },
    });
    await submitSurvey(db, input());
    await confirmSurvey(db, lastToken());
    const next = await db.tutee.findFirstOrThrow({
      where: { intakeTermId: "next-term" },
    });
    expect(next.id).not.toBe(first.id);
    expect(next.intakeTermId).toBe("next-term");
    expect(next.signupSubmittedAt!.getTime()).toBeGreaterThan(
      first.signupSubmittedAt!.getTime(),
    );
    expect(await db.user.count()).toBe(1);
  });
});

describe("student request lifecycle", () => {
  it("enforces a user-bound confirmation delay and single use", async () => {
    await submitSurvey(db, input());
    const row = await db.studentSurvey.findFirstOrThrow();
    const tutor = await db.tutor.create({
      data: { englishName: "Tutor", status: "ACTIVE" },
    });
    const ticket = await prepareStudentAction(db, "manager", "ASSIGN", row.id);
    await expect(
      assignStudentRequest(
        db,
        row.id,
        "manager",
        ticket.id,
        "survey-math",
        tutor.id,
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.pairing.count()).toBe(0);
    await db.studentActionConfirmation.update({
      where: { id: ticket.id },
      data: { readyAt: new Date(0) },
    });
    await expect(
      assignStudentRequest(
        db,
        row.id,
        "other-manager",
        ticket.id,
        "survey-math",
        tutor.id,
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await assignStudentRequest(
      db,
      row.id,
      "manager",
      ticket.id,
      "survey-math",
      tutor.id,
    );
    await expect(
      assignStudentRequest(
        db,
        row.id,
        "manager",
        ticket.id,
        "survey-math",
        tutor.id,
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("assigns unverified students, preserves priority, and does not extend the deadline on resend", async () => {
    const { row } = await assigned();
    expect(+row.verificationDueAt! - +row.firstAssignedAt!).toBe(
      VERIFICATION_WEEK_MS,
    );
    expect(row.confirmedAt).toBeNull();
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: row.tuteeId! } }))
        .signupSubmittedAt,
    ).toEqual(row.submittedAt);
    expect(send.mock.calls.at(-1)?.[0].text).toContain(
      row.verificationDueAt!.toISOString(),
    );
    await resendSurvey(db, email);
    expect(
      (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
        .verificationDueAt,
    ).toEqual(row.verificationDueAt);
    await confirmSurvey(db, lastToken(), password);
    expect(await db.tutee.count()).toBe(1);
    expect(await db.pairingTutee.count()).toBe(1);
    expect(
      await expireStudentRequests(db, new Date(+row.verificationDueAt! + 1)),
    ).toBe(0);
  });
  it("expires exactly at the deadline, cannot reactivate, and requires a fresh request", async () => {
    const { row } = await assigned();
    const expiredToken = lastToken();
    expect(
      await expireStudentRequests(db, new Date(+row.verificationDueAt! - 1)),
    ).toBe(0);
    expect(await expireStudentRequests(db, row.verificationDueAt!)).toBe(1);
    expect(await expireStudentRequests(db, row.verificationDueAt!)).toBe(0);
    expect(await db.pairingTutee.count()).toBe(0);
    await expect(
      confirmSurvey(db, expiredToken, password),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      db.studentSurvey.update({
        where: { id: row.id },
        data: { state: "OPEN" },
      }),
    ).rejects.toThrow();
    await expect(
      db.tutee.update({
        where: { id: row.tuteeId! },
        data: { status: "ACTIVE" },
      }),
    ).rejects.toThrow();
    await submitSurvey(db, input());
    const fresh = await db.studentSurvey.findFirstOrThrow({
      where: { state: "OPEN" },
    });
    expect(fresh.id).not.toBe(row.id);
    expect(+fresh.submittedAt).toBeGreaterThan(+row.submittedAt);
    await confirmSurvey(db, lastToken(), password);
    expect(
      (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
        .state,
    ).toBe("DISQUALIFIED");
  });
  it("edits only availability without changing original evidence, priority, or assignment", async () => {
    const { row } = await assigned(true);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await db.timeSlot.create({
      data: {
        id: "other-slot",
        label: "Tuesday",
        dayOfWeek: 2,
        startMin: 960,
        endMin: 1020,
        active: true,
      },
    });
    await editStudentAvailability(db, user.id, row.id, ["other-slot"]);
    const edited = await db.studentSurvey.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(edited.payload).toEqual(row.payload);
    expect(edited.submittedAt).toEqual(row.submittedAt);
    expect(edited.editedAt).not.toBeNull();
    expect(await db.pairingTutee.count()).toBe(1);
    expect((await studentRequestRows(db))[0]?.editedAt).not.toBeNull();
    const caller = createCallerFactory(studentWorkflowRouter)({
      db,
      headers: new Headers(),
      session: {
        user: { id: user.id },
        role: "STUDENT",
        tutorId: null,
        expires: "2099-01-01",
      },
    });
    await expect(
      caller.editAvailability({
        id: row.id,
        slotIds: ["other-slot"],
        firstChoiceId: "changed",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      editStudentAvailability(db, "intruder", row.id, ["survey-slot"]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("starts the same fixed deadline in the generic admin roster editor and preserves it on edits", async () => {
    await db.user.create({
      data: {
        id: "manager",
        email: "manager-fixture@example.test",
        role: "ADMIN",
      },
    });
    await submitSurvey(db, input());
    const row = await db.studentSurvey.findFirstOrThrow();
    const { materializeStudent } = await import("./student-survey");
    const profile = await db.$transaction((tx) => materializeStudent(tx, row));
    const tutor = await db.tutor.create({
      data: { englishName: "Roster Tutor", status: "ACTIVE" },
    });
    const caller = createCallerFactory(adminRouter)({
      db,
      headers: new Headers(),
      session: {
        user: { id: "manager" },
        role: "ADMIN",
        tutorId: null,
        expires: "2099-01-01",
      },
    });
    const pairing = await caller.createPairing({
      tutorId: tutor.id,
      timeSlotId: "survey-slot",
      subject: "Mathematics",
      tuteeIds: [profile.id],
    });
    const stamped = await db.studentSurvey.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(+stamped.verificationDueAt! - +stamped.firstAssignedAt!).toBe(
      VERIFICATION_WEEK_MS,
    );
    await caller.updatePairing({
      id: pairing.id,
      tutorId: tutor.id,
      timeSlotId: "survey-slot",
      subject: "Mathematics",
      tuteeIds: [profile.id],
    });
    expect(
      (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
        .verificationDueAt,
    ).toEqual(stamped.verificationDueAt);
    await expireStudentRequests(db, stamped.verificationDueAt!);
    await expect(
      caller.updatePairing({
        id: pairing.id,
        tutorId: tutor.id,
        timeSlotId: "survey-slot",
        subject: "Mathematics",
        tuteeIds: [profile.id],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("recalls unassigned requests to processed history and notifies management", async () => {
    const manager = await db.user.create({
      data: { email: "manager@example.test", role: "ADMIN" },
    });
    await submitSurvey(db, input());
    await confirmSurvey(db, lastToken(), password);
    const row = await db.studentSurvey.findFirstOrThrow();
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await recallStudentRequest(
      db,
      user.id,
      row.id,
      await ready("RECALL", row.id, user.id),
    );
    expect((await studentRequestRows(db))[0]?.state).toBe("RECALLED");
    expect(
      await db.notification.count({ where: { userId: manager.id } }),
    ).toBeGreaterThan(0);
    await expect(
      recallStudentRequest(
        db,
        user.id,
        row.id,
        await ready("RECALL", row.id, user.id),
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await submitSurvey(db, input());
    expect(await db.studentSurvey.count()).toBe(2);
  });
  it("rejects recall after assignment and leaves assignments intact while an abort awaits review", async () => {
    const { row } = await assigned(true);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await expect(
      recallStudentRequest(
        db,
        user.id,
        row.id,
        await ready("RECALL", row.id, user.id),
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await applyStudentAbort(
      db,
      user.id,
      row.id,
      "Cannot continue",
      await ready("ABORT", row.id, user.id),
    );
    expect(await db.pairingTutee.count()).toBe(1);
    const review = await db.studentRequestReview.findFirstOrThrow();
    await resolveStudentReview(
      db,
      "manager",
      review.id,
      true,
      await ready("APPROVE", review.id),
    );
    expect(await db.pairingTutee.count()).toBe(0);
    expect(
      (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
        .state,
    ).toBe("ABORTED");
    await expect(submitSurvey(db, input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await db.term.updateMany({ data: { active: false } });
    await db.term.create({
      data: { name: "Next", schoolYear: "26-27", quarter: "Q2", active: true },
    });
    await expect(submitSurvey(db, input())).resolves.toMatchObject({
      ok: true,
    });
  });
  it("declining an abort leaves the student eligible and assigned", async () => {
    const { row } = await assigned(true);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await applyStudentAbort(
      db,
      user.id,
      row.id,
      "Reason",
      await ready("ABORT", row.id, user.id),
    );
    const review = await db.studentRequestReview.findFirstOrThrow();
    await resolveStudentReview(
      db,
      "manager",
      review.id,
      false,
      await ready("DENY", review.id),
    );
    expect(await db.pairingTutee.count()).toBe(1);
    expect(await db.studentQuarterBlock.count()).toBe(0);
    expect(
      (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
        .state,
    ).toBe("OPEN");
  });
  it("requires a tutor-owned schedule rejection and releases only that assignment after approval", async () => {
    const { row, tutor, tutorUser, pairing } = await assigned(true);
    // A second subject must survive approval of the first subject's schedule conflict.
    const second = await db.pairing.create({
      data: {
        tutorId: tutor.id,
        termId: row.intakeTermId,
        subject: "Physics",
        dayOfWeek: 2,
        startMin: 930,
        endMin: 990,
        tutees: { create: { tuteeId: row.tuteeId! } },
      },
    });
    const target = pairing.id + ":" + row.tuteeId;
    await expect(
      applyScheduleRejection(
        db,
        tutorUser.id,
        "wrong-tutor",
        row.tuteeId!,
        pairing.id,
        "No common time",
        await ready("SCHEDULE", target, tutorUser.id),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await applyScheduleRejection(
      db,
      tutorUser.id,
      tutor.id,
      row.tuteeId!,
      pairing.id,
      "No common time",
      await ready("SCHEDULE", target, tutorUser.id),
    );
    expect(await db.pairingTutee.count()).toBe(2);
    const review = await db.studentRequestReview.findFirstOrThrow();
    await resolveStudentReview(
      db,
      "manager",
      review.id,
      true,
      await ready("APPROVE", review.id),
    );
    expect(await db.pairingTutee.count()).toBe(1);
    expect(
      await db.pairingTutee.count({ where: { pairingId: second.id } }),
    ).toBe(1);
    const current = await db.studentSurvey.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(current.state).toBe("OPEN");
    expect(current.submittedAt).toEqual(row.submittedAt);
    expect(current.firstAssignedAt).toEqual(row.firstAssignedAt);
    expect(await db.studentQuarterBlock.count()).toBe(0);
  });
  it("supports schedule review for existing students without a survey and rejects duplicate or stale approvals", async () => {
    const { row, tutor, tutorUser, pairing } = await assigned(true);
    await db.studentSurvey.delete({ where: { id: row.id } });
    const target = `${pairing.id}:${row.tuteeId}`;
    const apply = async () =>
      applyScheduleRejection(
        db,
        tutorUser.id,
        tutor.id,
        row.tuteeId!,
        pairing.id,
        "No common time",
        await ready("SCHEDULE", target, tutorUser.id),
      );
    await apply();
    await expect(apply()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    const review = await db.studentRequestReview.findFirstOrThrow();
    expect(review.surveyId).toBeNull();
    expect(review.legacyIntakeTermId).toBe(row.intakeTermId);
    await resolveStudentReview(
      db,
      "manager",
      review.id,
      true,
      await ready("APPROVE", review.id),
    );
    expect(await db.pairingTutee.count()).toBe(0);
    expect(await db.studentQuarterBlock.count()).toBe(0);
    await expect(
      resolveStudentReview(
        db,
        "manager",
        review.id,
        true,
        await ready("APPROVE", review.id),
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("requires the latest policy on login without changing priority or assignments", async () => {
    const { row } = await assigned(true);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await studentPolicyStatus(db, user.id)).toBeNull();
    await db.policyDocument.updateMany({
      data: { body: "Updated student policy" },
    });
    const policy = await studentPolicyStatus(db, user.id);
    expect(policy).not.toBeNull();
    await expect(
      editStudentAvailability(db, user.id, row.id, ["survey-slot"]),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const ticket = await ready("POLICY", policy!.revision, user.id);
    await acceptStudentPolicy(db, user.id, policy!.revision, ticket);
    expect(await studentPolicyStatus(db, user.id)).toBeNull();
    expect(
      (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
        .submittedAt,
    ).toEqual(row.submittedAt);
    expect(await db.pairingTutee.count()).toBe(1);
    expect(
      await db.policyAcceptance.count({ where: { userId: user.id } }),
    ).toBe(2);
  });
  it("blocks students from management workflow data and decisions", async () => {
    await db.user.create({
      data: {
        id: "student",
        email: "student-fixture@example.test",
        role: "STUDENT",
      },
    });
    const caller = createCallerFactory(studentWorkflowRouter)({
      db,
      headers: new Headers(),
      session: {
        user: { id: "student" },
        role: "STUDENT",
        tutorId: null,
        expires: "2099-01-01",
      },
    });
    await expect(caller.adminRequests()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.resolveReview({ id: "review", approve: true, ticket: "ticket" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
