import {
  lockAccountProfile,
  updateAccountProfile,
} from "~/server/account-profile";
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { currentPolicy } from "~/server/policy-acceptance";
import { retainStudentOwnership } from "./student-ownership";
import { isSignupWindowOpen } from "~/lib/signup-window";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { hashPassword } from "~/server/auth/password";
import { expireStudentRequests } from "./student-request-state";
import { rateLimit } from "~/server/rate-limit";
import { getFeatures } from "~/server/program/features";
import { getPeriodDisplay } from "~/lib/period";

export const surveyInput = z.object({
  englishName: z.string().trim().min(1).max(120),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(40).optional(),
  preferredContact: z.string().trim().min(1).max(200),
  gradeLevel: z.string().trim().max(40).optional(),
  firstChoiceId: z.string().min(1),
  secondChoiceId: z.string().min(1).optional(),
  slotIds: z.array(z.string().min(1)).min(1).max(100),
  signatureName: z.string().trim().min(1).max(120),
  agreed: z.literal(true),
  policyRevision: z.string().min(1),
});
export const surveyToken = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function surveyLimit(key: string, max = 6) {
  if (!rateLimit(`survey:${key}`, { max, windowMs: 15 * 60_000 }).ok)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Please wait before trying again.",
    });
}

/** Use the configured origin, never a caller-controlled Host header, for account links. */
function emailOrigin() {
  const origin =
    process.env.AUTH_URL ??
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  if (!origin)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The team must configure AUTH_URL before signup opens.",
    });
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Configure a public HTTPS AUTH_URL before signup opens.",
    });
  return url.origin;
}

/** Row locks also coordinate with existing management updates that do not use advisory locks. */
async function activeIntake(tx: TransactionDb) {
  await tx.$queryRaw`SELECT id FROM "Term" WHERE active = true FOR SHARE`;
  return tx.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
}

async function validateChoices(
  tx: TransactionDb,
  input: z.infer<typeof surveyInput>,
) {
  // Prevent deletion/deactivation between validation and creating the related records.
  await tx.$queryRaw`SELECT id FROM "Subject" WHERE id = ${input.firstChoiceId} OR id = ${input.secondChoiceId ?? ""} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "TimeSlot" WHERE id = ANY(${input.slotIds}::text[]) ORDER BY id FOR SHARE`;
  const ids = [
    input.firstChoiceId,
    ...(input.secondChoiceId ? [input.secondChoiceId] : []),
  ];
  return (
    new Set(ids).size === ids.length &&
    (await tx.subject.count({ where: { id: { in: ids }, active: true } })) ===
      ids.length &&
    (await tx.timeSlot.count({
      where: { id: { in: input.slotIds }, active: true },
    })) === new Set(input.slotIds).size
  );
}

/** Mail failures must not erase a successfully reserved place. Resending only rotates the token. */
async function deliver(
  to: string,
  token: string,
  origin: string,
  deadline?: Date | null,
) {
  try {
    await emailSender.send({
      to,
      subject: "Tutoring signup received — confirm your email",
      text: `${deadline ? `Verify by ${deadline.toISOString()}. Your request will be permanently disqualified and all assignments released after this deadline. Resends do not extend it. 验证截止时间：${deadline.toISOString()}。逾期将永久取消申请资格并解除导师安排，重发邮件不会延长期限。\n\n` : ""}Your tutoring survey has been saved. Priority is based on when you first submitted it after signup opened, not when you create your account.\n\nReview and confirm your request, then create your student account using this link:\n${origin}/signup/account?token=${token}\n\nAlready have an account? Confirm your request using the same link, then sign in with your existing password. The link expires in 24 hours. You can request another link without losing your submission time. If you did not submit this survey, ignore this email.`,
    });
    return true;
  } catch {
    return false;
  }
}

export async function submitSurvey(
  db: DomainDb,
  input: z.infer<typeof surveyInput>,
) {
  surveyLimit(input.email);
  await expireStudentRequests(db);
  if (!isEmailDeliveryAvailable())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Email delivery is unavailable. Contact the team.",
    });
  const origin = emailOrigin();
  const token = randomBytes(32).toString("hex");
  const result = await inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockEntity(tx, `student-survey:${input.email}`);
    await lockEntity(tx, "policy:tutee-policy");
    const term = await activeIntake(tx);
    if (!term || !isSignupWindowOpen(term.signupOpensAt))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Tutee signups have not opened yet.",
      });
    const account = await tx.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    const block = await tx.studentQuarterBlock.findFirst({
      where: {
        intakeTermId: term.id,
        OR: [
          { email: input.email },
          ...(account ? [{ userId: account.id }] : []),
        ],
      },
    });
    if (block)
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "You left the program this quarter and cannot submit another request until a new quarter.",
      });
    const previous = await tx.studentSurvey.findFirst({
      where: { email: input.email, intakeTermId: term.id, state: "OPEN" },
      orderBy: { submittedAt: "desc" },
    });
    // A verified account may change its email, but still has just one open request per intake.
    if (!previous && account) {
      const { ownedStudentIds } = await import("./student-ownership");
      const owned = await ownedStudentIds(tx, account.id);
      if (
        await tx.studentSurvey.count({
          where: {
            intakeTermId: term.id,
            state: "OPEN",
            confirmedAt: { not: null },
            tuteeId: { in: owned },
          },
        })
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have a current request. Sign in to manage it.",
        });
    }
    // Duplicate submissions keep the first payload and timestamp; the email owner can review it.
    if (previous) return { row: previous, duplicate: true };
    const policy = await currentPolicy(tx, "tutee-policy");
    if (policy.revision !== input.policyRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The policy changed. Refresh and read the current policy before submitting.",
      });
    const slots = [...new Set(input.slotIds)];
    if (!(await validateChoices(tx, input)))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose distinct active subjects and available time slots.",
      });
    const row = await tx.studentSurvey.create({
      data: {
        email: input.email,
        intakeTermId: term.id,
        submittedAt: new Date(),
        payload: { ...input, slotIds: slots },
        policyRevision: policy.revision,
        policySnapshot: policy.documents,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 24 * 3600000),
      },
    });
    return { row, duplicate: false };
  });
  const emailSent = result.duplicate
    ? await resendSurvey(db, input.email, false)
    : await deliver(input.email, token, origin);
  if (emailSent && !result.duplicate)
    await db.studentSurvey.updateMany({
      where: { id: result.row.id },
      data: { lastLinkSentAt: new Date() },
    });
  return { ok: true, emailSent };
}

export async function resendSurvey(
  db: DomainDb,
  email: string,
  enforceLimit = true,
) {
  if (enforceLimit) surveyLimit(email);
  await expireStudentRequests(db);
  const origin = emailOrigin();
  if (!isEmailDeliveryAvailable()) return false;
  const token = randomBytes(32).toString("hex");
  const updated = await inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockEntity(tx, `student-survey:${email}`);
    const term = await activeIntake(tx);
    if (!term) return "missing";
    const existing = await tx.studentSurvey.findFirst({
      where: { email, intakeTermId: term.id, state: "OPEN" },
      orderBy: { submittedAt: "desc" },
    });
    if (existing?.confirmedAt) return "confirmed";
    return existing ?? "missing";
  });
  if (updated === "confirmed") {
    try {
      await emailSender.send({
        to: email,
        subject: "Your tutoring request is already confirmed",
        text: `Your original tutoring request is already confirmed. Its submission time has not changed. Sign in here:\n${origin}/signin\n\nContact the team if you need to change your request.`,
      });
      return true;
    } catch {
      return false;
    }
  }
  // Give the same public response for unknown addresses to avoid exposing accounts.
  if (updated === "missing") return true;
  const sent = await deliver(email, token, origin, updated.verificationDueAt);
  if (sent) {
    // Publish only successfully delivered replacements. Failed/concurrent retries cannot
    // invalidate the previous link, and confirmation during delivery cannot resurrect it.
    await db.studentSurvey.updateMany({
      where: { id: updated.id, confirmedAt: null, state: "OPEN" },
      data: {
        lastLinkSentAt: new Date(),
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 24 * 3600000),
      },
    });
  }
  return sent;
}

async function validSurvey(db: DomainDb, token: string) {
  const row = await db.studentSurvey.findUnique({
    where: { tokenHash: digest(token) },
  });
  if (
    row?.state !== "OPEN" ||
    row.confirmedAt ||
    row.expiresAt <= new Date() ||
    (row.verificationDueAt && row.verificationDueAt <= new Date())
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This link has expired or was already used. Request another link, or sign in if you already confirmed.",
    });
  return row;
}

export async function inspectSurvey(db: DomainDb, token: string) {
  await expireStudentRequests(db);
  const row = await validSurvey(db, token);
  const user = await db.user.findUnique({ where: { email: row.email } });
  const input = surveyInput.parse(row.payload);
  // Confirmation describes the intake actually submitted, even after the active period changes.
  const [intake, features] = await Promise.all([
    db.term.findUnique({ where: { id: row.intakeTermId } }),
    getFeatures(db),
  ]);
  const subjects = await db.subject.findMany({
    where: {
      id: {
        in: [
          input.firstChoiceId,
          ...(input.secondChoiceId ? [input.secondChoiceId] : []),
        ],
      },
    },
    select: { id: true, name: true },
  });
  const slots = await db.timeSlot.findMany({
    where: { id: { in: input.slotIds } },
    orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
    select: {
      id: true,
      label: true,
      dayOfWeek: true,
      startMin: true,
      endMin: true,
    },
  });
  return {
    email: row.email,
    period: intake ? getPeriodDisplay(intake, features.QUARTER_SYSTEM) : null,
    name: input.englishName,
    submittedAt: row.submittedAt,
    verificationDueAt: row.verificationDueAt,
    needsAccount: !user?.passwordHash,
    subjects: [
      input.firstChoiceId,
      ...(input.secondChoiceId ? [input.secondChoiceId] : []),
    ].map(
      (id) => subjects.find((s) => s.id === id)?.name ?? "Unavailable subject",
    ),
    preferredContact: input.preferredContact,
    slots,
  };
}

/** Confirmation atomically claims the survey and links identity; GET/email scanners never consume it. */
export async function confirmSurvey(
  db: DomainDb,
  token: string,
  password?: string,
) {
  await expireStudentRequests(db);
  const initial = await validSurvey(db, token);
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockEntity(tx, `student-survey:${initial.email}`);
    const row = await validSurvey(tx, token);
    const term = await activeIntake(tx);
    if (term?.id !== row.intakeTermId)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This intake has ended. Submit a new survey for the current intake.",
      });
    const input = surveyInput.parse(row.payload);
    if (!row.tuteeId && !(await validateChoices(tx, input)))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "A selected subject or time slot is no longer available. Contact the team; your original submission time is saved.",
      });
    let user = await tx.user.findUnique({ where: { email: row.email } });
    if (user) await lockAccountProfile(tx, user.id);
    if (user?.suspendedAt)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Contact the team about your account.",
      });
    if (!user) {
      if (!password)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a password to create your account.",
        });
      user = await tx.user.create({
        data: {
          email: row.email,
          name: input.englishName,
          passwordHash: hashPassword(password),
          emailVerifiedAt: new Date(),
          role: "STUDENT",
        },
      });
    } else if (!user.passwordHash) {
      // Invited/pre-created accounts still need a password; preserve their existing role.
      if (!password)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a password to finish setting up your account.",
        });
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(password),
          emailVerifiedAt: new Date(),
          mustChangePassword: false,
        },
      });
    }
    const student = await materializeStudent(tx, row);
    if (user.studentId)
      await retainStudentOwnership(tx, user.id, user.studentId);
    await retainStudentOwnership(tx, user.id, student.id);
    await tx.user.update({
      where: { id: user.id },
      data: {
        studentId: student.id,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    // Verification establishes the explicit link; the existing account remains the identity source.
    await updateAccountProfile(tx, user.id);
    await tx.policyAcceptance.upsert({
      where: {
        userId_slug_revision: {
          userId: user.id,
          slug: "tutee-policy",
          revision: row.policyRevision,
        },
      },
      update: {},
      create: {
        userId: user.id,
        slug: "tutee-policy",
        revision: row.policyRevision,
        snapshot: row.policySnapshot as Prisma.InputJsonValue,
        signature: input.signatureName,
        acceptedAt: row.submittedAt,
      },
    });
    await tx.studentSurvey.update({
      where: { id: row.id },
      data: { confirmedAt: new Date() },
    });
    return { ok: true };
  });
}

/** Compatibility list for unmaterialized surveys; the workflow board also includes assigned ones. */
export async function pendingSurveys(db: DomainDb) {
  const term = await db.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!term) return [];
  const [rows, subjects, slots] = await Promise.all([
    db.studentSurvey.findMany({
      where: {
        intakeTermId: term.id,
        confirmedAt: null,
        state: "OPEN",
        tuteeId: null,
      },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    }),
    db.subject.findMany({ select: { id: true, name: true } }),
    db.timeSlot.findMany({
      select: {
        id: true,
        label: true,
        dayOfWeek: true,
        startMin: true,
        endMin: true,
      },
    }),
  ]);
  return rows.map((row) => {
    const input = surveyInput.parse(row.payload);
    return {
      id: `survey:${row.id}`,
      englishName: input.englishName,
      email: row.email,
      gradeLevel: input.gradeLevel ?? null,
      phone: input.phone ?? null,
      preferredContact: input.preferredContact,
      createdAt: row.submittedAt,
      signupSubmittedAt: row.submittedAt,
      updatedAt: row.submittedAt,
      status: "PENDING" as const,
      unverified: true,
      firstChoice: subjects.find((s) => s.id === input.firstChoiceId) ?? null,
      secondChoice: subjects.find((s) => s.id === input.secondChoiceId) ?? null,
      availabilities: slots
        .filter((s) => input.slotIds.includes(s.id))
        .map((slot) => ({ slot })),
      signedRulebook: true,
      signatureName: input.signatureName,
      bannedMatch: null,
    };
  });
}

/** Create an assignable profile without granting login access; token confirmation claims this exact profile. */
export async function materializeStudent(
  tx: TransactionDb,
  row: {
    id: string;
    tuteeId: string | null;
    payload: Prisma.JsonValue;
    email: string;
    submittedAt: Date;
    intakeTermId: string;
  },
) {
  if (row.tuteeId)
    return tx.tutee.findUniqueOrThrow({ where: { id: row.tuteeId } });
  const input = surveyInput.parse(row.payload);
  if (!(await validateChoices(tx, input)))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The requested subjects or time slots are no longer available. Contact the team.",
    });
  const student = await tx.tutee.create({
    data: {
      englishName: input.englishName,
      email: row.email,
      phone: input.phone ?? null,
      preferredContact: input.preferredContact,
      gradeLevel: input.gradeLevel ?? null,
      firstChoiceId: input.firstChoiceId,
      secondChoiceId: input.secondChoiceId ?? null,
      status: "PENDING",
      signedRulebook: true,
      signatureName: input.signatureName,
      signedAt: row.submittedAt,
      signupSubmittedAt: row.submittedAt,
      intakeTermId: row.intakeTermId,
      availabilities: { create: input.slotIds.map((slotId) => ({ slotId })) },
    },
  });
  await tx.studentSurvey.update({
    where: { id: row.id },
    data: { tuteeId: student.id },
  });
  return student;
}
