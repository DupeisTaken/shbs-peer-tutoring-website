import { optionalPersonNameFields } from "~/lib/person-name";
import { requireSchoolParticipation } from "~/server/school-departure";
import { emailOrigin as publicEmailOrigin } from "~/server/email/urls";
import { signupMetric } from "~/server/signup-admission";
import { preferredLatinNameSchema } from "~/lib/username";
import { normalizeGrade } from "~/lib/academics";
import {
  assertPrimaryName,
  assertOfferedGrade,
} from "~/server/program/profile-policy";
import {
  ensureUserUsername,
  lockUsernameNamespace,
} from "~/server/auth/username";
import { applyAcademicIntake, accountAcademics } from "~/server/academics";
import { lockCatalogue } from "~/server/qualifications";
import { getSignupSettings } from "~/server/program/signup-fields";
import { normalizeTuteeFields, missingTuteeFields } from "~/lib/signup-fields";
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
import { retainStudentOwnership, ownedStudentIds } from "./student-ownership";
import { recruitmentStatus, recruitmentWindow } from "~/lib/recruitment";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { hashPassword } from "~/server/auth/password";
import { registrationCompletionProof } from "~/server/auth/registration";
import { expireStudentRequests } from "./student-request-state";
import { rateLimit } from "~/server/rate-limit";
import { getFeatures } from "~/server/program/features";
import { getPeriodDisplay } from "~/lib/period";

export const surveyInput = z.object({
  ...optionalPersonNameFields,
  englishName: z.string().trim().min(1).max(200),
  preferredLatinName: preferredLatinNameSchema,
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(40).optional(),
  preferredContact: z.string().trim().max(200).default(""),
  gradeLevel: z.string().trim().max(40).optional(),
  firstChoiceId: z.string().min(1),
  secondChoiceId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  slotIds: z.array(z.string().min(1)).max(100).default([]),
  signatureName: z.string().trim().max(120).default(""),
  agreed: z.literal(true),
  policyRevision: z.string().min(1),
});
export const surveyToken = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** The mailbox challenge rotates with the secret link, preserving intake priority. */
export function surveyEmailCode(tokenHash: string) {
  return registrationCompletionProof(
    "invitation",
    "survey-email",
    tokenHash,
    new Date(0),
  )
    .slice(0, 6)
    .toUpperCase();
}

export async function verifySurveyEmail(
  db: DomainDb,
  email: string,
  code: string,
) {
  const row = await inTransaction(db, async (tx) => {
    await lockEntity(tx, `student-survey:${email}`);
    const current = await tx.studentSurvey.findFirst({
      where: { email, state: "OPEN", confirmedAt: null },
      orderBy: { submittedAt: "desc" },
    });
    if (
      !current ||
      current.expiresAt <= new Date() ||
      current.verificationAttempts >= 6 ||
      (current.verificationDueAt && current.verificationDueAt <= new Date())
    )
      return null;
    if (surveyEmailCode(current.tokenHash) !== code.trim().toUpperCase()) {
      await tx.studentSurvey.update({
        where: { id: current.id },
        data: { verificationAttempts: { increment: 1 } },
      });
      return null;
    }
    return current;
  });
  if (!row)
    throw new TRPCError({ code: "BAD_REQUEST", message: "INVITATION_INVALID" });
  return row;
}

export function surveyLimit(key: string, max = 6) {
  if (!rateLimit(`survey:${key}`, { max, windowMs: 15 * 60_000 }).ok)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Please wait before trying again.",
    });
}

/** Use the configured origin, never a caller-controlled Host header, for account links. */
function emailOrigin() {
  try {
    return publicEmailOrigin();
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Configure a public HTTPS AUTH_URL before signup opens.",
    });
  }
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
  await lockCatalogue(tx);
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
      category: "PROGRAM",
      signup: true,
      to,
      subject: "Tutoring signup received — confirm your email",
      presentation: {
        code: surveyEmailCode(digest(token)),
        action: {
          label: "Confirm your tutoring request",
          url: `${origin}/tutee/account?token=${token}`,
        },
      },
      text: `Your email verification code is ${surveyEmailCode(digest(token))}. / 您的邮箱验证码是 ${surveyEmailCode(digest(token))}。\n\n${deadline ? `Verify by ${deadline.toISOString()}. Your request will be permanently disqualified and all assignments released after this deadline. Resends do not extend it. 验证截止时间：${deadline.toISOString()}。逾期将永久取消申请资格并解除辅导伙伴安排，重发邮件不会延长期限。\n\n` : ""}Your tutoring survey has been saved. Priority is based on when you first submitted it after signup opened, not when you create your account.\n\nReview your request and confirm this email to receive your account invitation:\n${origin}/tutee/account?token=${token}\n\nYour recipient-delivered invitation signs in an existing account without replacing its password. Review and accept the invitation to complete this request. The confirmation link expires in 24 hours. You can request another link without losing your submission time. If you did not submit this survey, ignore this email.`,
    });
    return true;
  } catch {
    signupMetric("delivery-failed");
    return false;
  }
}

/** Submission and final redemption share account-aware intake restrictions. Recheck after
 * mailbox proof because an address can become a verified alias after the original request. */
async function assertIntakeEligibility(
  tx: TransactionDb,
  intakeTermId: string,
  email: string,
  account: { id: string; email: string } | null,
  excludeSurveyId?: string,
) {
  const block = await tx.studentQuarterBlock.findFirst({
    where: {
      intakeTermId,
      OR: [
        { email },
        ...(account ? [{ userId: account.id }, { email: account.email }] : []),
      ],
    },
  });
  if (block)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "You left the program this quarter and cannot submit another request until a new quarter.",
    });
  if (account) {
    const owned = await ownedStudentIds(tx, account.id);
    if (
      await tx.studentSurvey.count({
        where: {
          intakeTermId,
          state: "OPEN",
          confirmedAt: { not: null },
          tuteeId: { in: owned },
          ...(excludeSurveyId ? { id: { not: excludeSurveyId } } : {}),
        },
      })
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "You already have a current request. Sign in to manage it.",
      });
  }
}

export async function submitSurvey(
  db: DomainDb,
  input: z.infer<typeof surveyInput>,
) {
  surveyLimit(input.email);
  await expireStudentRequests(db);
  if (!isEmailDeliveryAvailable("PROGRAM"))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Email delivery is unavailable. Contact the team.",
    });
  const origin = emailOrigin();
  const token = randomBytes(32).toString("hex");
  const result = await inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `student-survey:${input.email}`);
    await lockEntity(tx, "policy:tutee-policy");
    const term = await activeIntake(tx);
    if (!term || recruitmentStatus(recruitmentWindow(term, "tutee")) !== "open")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Tutee recruitment is currently closed. You can still preview the form.",
      });
    const account = await tx.user.findFirst({
      where: {
        OR: [
          { email: input.email },
          {
            emails: { some: { email: input.email, verifiedAt: { not: null } } },
          },
        ],
      },
      select: {
        id: true,
        profileVersion: true,
        email: true,
        name: true,
        mergedIntoId: true,
      },
    });
    if (account) await requireSchoolParticipation(tx, account.id);
    if (account?.mergedIntoId)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Contact the team about your account.",
      });
    const previous = await tx.studentSurvey.findFirst({
      where: { email: input.email, intakeTermId: term.id, state: "OPEN" },
      orderBy: { submittedAt: "desc" },
    });
    await assertIntakeEligibility(
      tx,
      term.id,
      input.email,
      account,
      previous?.id,
    );
    // Duplicate submissions keep the first payload and timestamp; the email owner can review it.
    if (previous) return { row: previous, duplicate: true };
    // Validate new submissions only; later configuration never revalidates historical payloads.
    await lockEntity(tx, "signup-fields");
    const fields = (await getSignupSettings(tx)).tutee;
    input = normalizeTuteeFields(input, fields);
    await assertPrimaryName(
      tx,
      account?.name ?? input.englishName,
      account?.name,
    );
    await assertOfferedGrade(tx, normalizeGrade(input.gradeLevel).gradeLevel);
    const missing = missingTuteeFields(input, fields);
    if (missing.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Complete required fields: ${missing.join(", ")}. Reload the form if settings changed.`,
      });
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
        payload: {
          ...input,
          slotIds: slots,
          // Server-captured concurrency evidence; clients cannot choose these values.
          academicAccountId: account?.id ?? null,
          academicProfileVersion: account?.profileVersion ?? null,
        },
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
  if (!isEmailDeliveryAvailable("PROGRAM")) return false;
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
        category: "PROGRAM",
        signup: true,
        to: email,
        subject: "Your tutoring request is already confirmed",
        presentation: { action: { label: "Sign in", url: `${origin}/signin` } },
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
        verificationAttempts: 0,
        expiresAt: new Date(Date.now() + 24 * 3600000),
      },
    });
  }
  return sent;
}

export async function validSurvey(
  db: DomainDb,
  token: string,
  tokenIsDigest = false,
) {
  const row = await db.studentSurvey.findUnique({
    where: { tokenHash: tokenIsDigest ? token : digest(token) },
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
  if (user?.mergedIntoId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Contact the team about your account.",
    });
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
  identity?: { tokenIsDigest: true; authenticatedUserId?: string },
) {
  await expireStudentRequests(db);
  const initial = await validSurvey(db, token, identity?.tokenIsDigest);
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `student-survey:${initial.email}`);
    const row = await validSurvey(tx, token, identity?.tokenIsDigest);
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
    await lockUsernameNamespace(tx);
    let user = await tx.user.findFirst({
      where: {
        OR: [
          { email: row.email },
          { emails: { some: { email: row.email, verifiedAt: { not: null } } } },
        ],
      },
    });
    if (identity && user && user.id !== identity.authenticatedUserId)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sign in to the invited account before reviewing access.",
      });
    // Recheck at verification: a link issued before the policy changed cannot create a
    // noncompliant identity. Existing verified identities remain the canonical source.
    await assertPrimaryName(tx, user?.name ?? input.englishName, user?.name);
    await assertOfferedGrade(tx, normalizeGrade(input.gradeLevel).gradeLevel);
    if (user) {
      await lockAccountProfile(tx, user.id);
      await requireSchoolParticipation(tx, user.id);
    }
    await assertIntakeEligibility(
      tx,
      row.intakeTermId,
      row.email,
      user,
      row.id,
    );
    // A retired login also has no password. Do not mistake it for an unfinished invitation.
    // The namespace lock above serializes this decision with account combination.
    if (user?.mergedIntoId || user?.suspendedAt)
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
          firstName: input.firstName,
          lastName: input.lastName,
          preferredName: input.preferredName,
          alternativeNames: input.alternativeNames,
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
        tuteeMember: true,
        ...(user.role === "VIEWER" ? { role: "STUDENT" as const } : {}),
        // Proof of a verified secondary address must not mark the primary address verified.
        emailVerifiedAt:
          user.emailVerifiedAt ??
          (row.email === user.email ? new Date() : null),
      },
    });
    // Verification establishes the explicit link; the existing account remains the identity source.
    // A verified, explicitly linked owner may confirm this intake's academic report only
    // while its server-captured profile version still matches. Old email links cannot undo edits.
    const academicSnapshot = z
      .object({
        academicAccountId: z.string().nullable().optional(),
        academicProfileVersion: z.number().int().nullable().optional(),
      })
      .parse(row.payload);
    const snapshotVersion =
      academicSnapshot.academicAccountId === user.id
        ? (academicSnapshot.academicProfileVersion ?? undefined)
        : undefined;
    await applyAcademicIntake(
      tx,
      user.id,
      input.gradeLevel,
      term?.schoolYear ?? null,
      row.submittedAt,
      "VERIFIED_SURVEY",
      snapshotVersion,
    );
    await updateAccountProfile(tx, user.id);
    const academic = (await accountAcademics(tx, user.id)).academic;
    await ensureUserUsername(user.id, tx, {
      verifiedStudent: true,
      preferredLatinName: input.preferredLatinName,
      graduationYear: academic.confirmedAt
        ? academic.expectedGraduationYear
        : null,
    });
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
      signupSource: "SELF_SERVICE",
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
      // Staff may materialize a verified intake before the account-link step.
      // Preserve every explicit field here; the canonical account can mirror over it later.
      firstName: input.firstName,
      lastName: input.lastName,
      preferredName: input.preferredName,
      alternativeNames: input.alternativeNames,
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
      signupSource: "SELF_SERVICE",
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
