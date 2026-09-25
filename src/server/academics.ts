import { TRPCError } from "@trpc/server";
import {
  academicInput,
  type currentAcademicInput,
  academicSummary,
  normalizeGrade,
  needsAcademicConfirmationForParticipation,
  type AcademicRecord,
} from "~/lib/academics";
import { lockAccountProfile } from "./account-profile";
import { staleConflict } from "./concurrency";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";
import { assertOfferedGrade } from "./program/profile-policy";
import type { z } from "zod";

export async function accountAcademics(db: DomainDb, userId: string) {
  const [user, term] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { profileVersion: true, academicProfile: true },
    }),
    db.term.findFirst({
      where: { active: true },
      select: { schoolYear: true },
    }),
  ]);
  return {
    academic: academicSummary(user.academicProfile, term?.schoolYear),
    profileVersion: user.profileVersion,
    currentSchoolYear: term?.schoolYear ?? null,
  };
}

/** Public edits use the active program year under the same lock as refresh. History/intake
 * imports retain their original year through confirmAccountAcademics instead. */
export async function confirmCurrentAccountAcademics(
  db: DomainDb, userId: string, input: z.infer<typeof currentAcademicInput>,
  options: { actorId: string; source: string },
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    const term = await tx.term.findFirst({ where: { active: true }, select: { schoolYear: true } });
    if (input.status === "REPORTED" && !term)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PROFILE_NO_CURRENT_YEAR" });
    if (input.expectedSchoolYear !== undefined && input.expectedSchoolYear !== (term?.schoolYear ?? null))
      throw new TRPCError({ code: "CONFLICT", message: "PROFILE_PROGRAM_YEAR_CHANGED" });
    await assertOfferedGrade(tx, input.gradeLevel);
    return confirmAccountAcademics(tx, userId, {
      ...input, schoolYear: input.status === "REPORTED" ? term!.schoolYear : null,
    }, options);
  });
}

/** Account lock/version makes academic, name and identity writes share one edit boundary.
 * Only the currently linked tutor mirrors the canonical grade; enrollment/signed records are history. */
export async function confirmAccountAcademics(
  db: DomainDb,
  userId: string,
  input: z.infer<typeof academicInput>,
  options: { actorId: string; source: string },
) {
  const parsed = academicInput.parse(input);
  return inTransaction(db, async (tx) => {
    await lockAccountProfile(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.profileVersion !== parsed.expectedProfileVersion) staleConflict();
    const data = {
      status: parsed.status,
      gradeLevel: parsed.gradeLevel,
      rawGrade: parsed.rawGrade ?? null,
      schoolYear: parsed.status === "NOT_APPLICABLE" ? null : parsed.schoolYear,
      confirmedAt: new Date(),
      reconfirmRequired: parsed.status === "UNKNOWN",
    };
    await tx.academicProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    await tx.academicConfirmation.create({
      data: {
        userId,
        status: data.status,
        gradeLevel: data.gradeLevel,
        rawGrade: data.rawGrade,
        schoolYear: data.schoolYear,
        confirmedAt: data.confirmedAt,
        actorId: options.actorId,
        source: options.source,
        reason: parsed.reason?.length ? parsed.reason : null,
      },
    });
    const updated = await tx.user.update({
      where: { id: userId },
      data: { gradeLevel: data.gradeLevel, profileVersion: { increment: 1 } },
    });
    if (user.tutorId)
      await tx.tutor.update({
        where: { id: user.tutorId },
        data: {
          gradeLevel: data.gradeLevel,
          gradeSchoolYear: data.schoolYear,
          gradeConfirmedAt: data.confirmedAt,
        },
      });
    return { profileVersion: updated.profileVersion };
  });
}

/** Intake may initialize a missing profile, but never replace a newer confirmation or a
 * different established value. The verified owner resolves conflicts in account settings. */
export async function applyAcademicIntake(
  db: DomainDb,
  userId: string,
  raw: string | number | null | undefined,
  schoolYear: string | null,
  submittedAt: Date,
  source: string,
  expectedProfileVersion?: number,
) {
  if (raw == null || String(raw).trim() === "") return;
  return inTransaction(db, async (tx) => {
    await lockAccountProfile(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: { academicProfile: true },
    });
    const existing = user.academicProfile;
    if (
      expectedProfileVersion !== undefined &&
      user.profileVersion !== expectedProfileVersion
    )
      return;
    const normalized = normalizeGrade(raw);
    if (existing?.confirmedAt && existing.confirmedAt >= submittedAt) return;
    const confirmsLegacyGrade =
      existing?.status === "UNKNOWN" &&
      !existing.confirmedAt &&
      !existing.schoolYear &&
      normalized.gradeLevel !== null &&
      existing.gradeLevel === normalized.gradeLevel;
    if (
      expectedProfileVersion === undefined &&
      existing &&
      !confirmsLegacyGrade &&
      (existing.status === "NOT_APPLICABLE" ||
        existing.gradeLevel !== normalized.gradeLevel ||
        existing.schoolYear !== schoolYear)
    ) {
      await tx.academicProfile.update({
        where: { userId },
        data: { reconfirmRequired: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: { profileVersion: { increment: 1 } },
      });
      return;
    }
    await confirmAccountAcademics(
      tx,
      userId,
      {
        status:
          normalized.gradeLevel !== null && schoolYear ? "REPORTED" : "UNKNOWN",
        gradeLevel: schoolYear ? normalized.gradeLevel : null,
        rawGrade: normalized.rawGrade,
        schoolYear,
        expectedProfileVersion: user.profileVersion,
      },
      { actorId: userId, source },
    );
  });
}

/** Legacy data has no trustworthy reference year. Never turn migration time into confirmation. */
export function legacyAcademic(
  raw: string | number | null | undefined,
): AcademicRecord {
  const value = normalizeGrade(raw);
  return {
    status: "UNKNOWN",
    ...value,
    schoolYear: null,
    confirmedAt: null,
    reconfirmRequired: true,
  };
}

export async function requireAcademicConfirmation(
  db: DomainDb,
  userId: string,
) {
  const { academic } = await accountAcademics(db, userId);
  if (needsAcademicConfirmationForParticipation(academic))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ACADEMIC_CONFIRMATION_REQUIRED",
    });
}

/** Registration may update legacy roster fields before deciding whether intake evidence is
 * current. Restore mirrors even when the canonical report wins a conflict or input is omitted. */
export async function synchronizeAcademicMirrors(db: DomainDb, userId: string) {
  return inTransaction(db, async (tx) => {
    await lockAccountProfile(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: { academicProfile: true },
    });
    const profile = user.academicProfile;
    if (!profile) return;
    await tx.user.update({
      where: { id: userId },
      data: { gradeLevel: profile.gradeLevel },
    });
    if (user.tutorId)
      await tx.tutor.update({
        where: { id: user.tutorId },
        data: {
          gradeLevel: profile.gradeLevel,
          gradeSchoolYear: profile.schoolYear,
          gradeConfirmedAt: profile.confirmedAt,
        },
      });
  });
}

/** Linking imports evidence only from explicit account/roster links. It never uses name/email
 * similarity and never overrides an already established canonical report. */
export async function initializeAccountAcademics(db: DomainDb, userId: string) {
  return inTransaction(db, async (tx) => {
    await lockAccountProfile(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        academicProfile: true,
        tutor: {
          select: {
            gradeLevel: true,
            gradeSchoolYear: true,
            gradeConfirmedAt: true,
          },
        },
        student: { select: { gradeLevel: true } },
      },
    });
    const profile = user.academicProfile;
    const emptyLegacy =
      profile?.status === "UNKNOWN" &&
      profile.gradeLevel === null &&
      profile.rawGrade === null &&
      profile.schoolYear === null &&
      profile.confirmedAt === null;
    if (!profile || emptyLegacy) {
      const sources = [
        user.gradeLevel,
        user.tutor?.gradeLevel,
        user.student?.gradeLevel,
      ].filter((value) => value != null && String(value).trim() !== "");
      const normalized = sources.map(normalizeGrade);
      const consistent = normalized.every(
        (value) =>
          value.gradeLevel === normalized[0]?.gradeLevel &&
          (value.gradeLevel !== null ||
            value.rawGrade === normalized[0]?.rawGrade),
      );
      const legacy = legacyAcademic(
        consistent ? sources[0] : sources.join("; "),
      );
      const confirmed =
        consistent &&
        legacy.gradeLevel !== null &&
        user.tutor?.gradeSchoolYear &&
        user.tutor.gradeConfirmedAt;
      const imported: AcademicRecord = {
        ...legacy,
        ...(confirmed
          ? {
              status: "REPORTED",
              schoolYear: user.tutor!.gradeSchoolYear,
              confirmedAt: user.tutor!.gradeConfirmedAt,
              reconfirmRequired: false,
            }
          : {}),
      };
      await tx.academicProfile.upsert({
        where: { userId },
        create: { userId, ...imported },
        update: imported,
      });
      await tx.user.update({
        where: { id: userId },
        data: { profileVersion: { increment: 1 } },
      });
    } else if (
      user.tutor?.gradeLevel !== null &&
      user.tutor?.gradeLevel !== undefined &&
      (user.tutor.gradeLevel !== profile.gradeLevel ||
        (user.tutor.gradeSchoolYear &&
          user.tutor.gradeSchoolYear !== profile.schoolYear))
    ) {
      // Keep the old provisional report as audit evidence before restoring canonical mirrors.
      await tx.auditLog.create({
        data: {
          entity: "AcademicProfile",
          entityId: userId,
          operation: "academic.linkConflict",
          action: "Preserved conflicting roster academic evidence",
          details: {
            gradeLevel: user.tutor.gradeLevel,
            schoolYear: user.tutor.gradeSchoolYear,
            confirmedAt: user.tutor.gradeConfirmedAt?.toISOString() ?? null,
          },
        },
      });
      await tx.academicProfile.update({
        where: { userId },
        data: { reconfirmRequired: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: { profileVersion: { increment: 1 } },
      });
    }
    await synchronizeAcademicMirrors(tx, userId);
  });
}
