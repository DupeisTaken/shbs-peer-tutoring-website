import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "../../../generated/prisma";
import { nextRecruitmentRefreshEvidenceSchema } from "~/lib/next-recruitment";
import { crossesSemester, crossesYear, periodLabel } from "~/lib/period";
import { recordAudit } from "~/server/audit/log";
import { lockUsernameNamespace } from "~/server/auth/username";
import { isSerializationFailure } from "~/server/auth/username-snapshot";
import { staleConflict } from "~/server/concurrency";
import { getActivePeriod } from "~/server/period";
import { changeSchoolDeparture } from "~/server/school-departure";
import { inTransaction, type DomainDb } from "~/server/transactions";
import { applyPendingFeatures } from "./features";
import {
  assertNextRecruitmentActor,
  validateNextRecruitmentRefresh,
} from "./next-recruitment";

export const refreshProgramInput = z.object({
  confirm: z
    .string()
    .refine((value) => value.trim().toUpperCase() === "REFRESH", {
      message: "Type REFRESH to confirm.",
    }),
  expectedTermId: z.string(),
  expectedPreparation: nextRecruitmentRefreshEvidenceSchema,
});
export type RefreshProgramInput = z.infer<typeof refreshProgramInput>;

/** Immediate and scheduled activation share the same atomic effects and lock order.
 * Reviewed evidence and current Head authority are rechecked before any period write. */
export async function applyProgramRefresh(
  db: DomainDb,
  input: RefreshProgramInput,
  actor: { id: string; name?: string | null },
) {
  return inTransaction(db, async (tx) => {
    const preparation = await validateNextRecruitmentRefresh(
      tx,
      input.expectedPreparation,
    );
    // Graduation later acquires account/identity locks. Take the namespace
    // before any roster row is updated, matching intake's period -> identity
    // order and avoiding a cycle with concurrent name/profile writers.
    try {
      await lockUsernameNamespace(tx);
    } catch (cause) {
      // Review replays may have waited behind an identity writer. No refresh
      // write has run yet; require a fresh review instead of hiding the conflict.
      if (isSerializationFailure(cause))
        throw new TRPCError({
          code: "CONFLICT",
          message: "NEXT_RECRUITMENT_CHANGED",
          cause,
        });
      throw cause;
    }
    await assertNextRecruitmentActor(tx, actor.id);
    const active = await getActivePeriod(tx);
    if (active.termId !== input.expectedTermId) staleConflict();
    const from = { schoolYear: active.schoolYear, quarter: active.quarter };
    // Validation owns the same period lock as preparation/mode writes. Apply
    // exactly the reviewed target, including change-away-and-back revisions.
    const semesterMode = preparation.target.semesterMode;
    const np = {
      schoolYear: preparation.target.destinationSchoolYear,
      quarter: preparation.target.destinationQuarter,
    };
    const name = periodLabel(np, semesterMode);
    const semesterCross = crossesSemester(from, np);
    const yearCross = crossesYear(from, np);
    // A missing row preserves the destination/default opening; a row with
    // null explicitly clears it. Switches, closing bounds and preview URLs
    // remain owned by the normal window editor, including a reused term.
    const openingOverrides = {
      ...(preparation.preparations.tutor
        ? { tutorSignupOpensAt: preparation.preparations.tutor.opensAt }
        : {}),
      ...(preparation.preparations.tutee
        ? { signupOpensAt: preparation.preparations.tutee.opensAt }
        : {}),
    };

    const out = await (async () => {
      // Activate the exact Admin/Head-staged toggles reviewed at this period boundary.
      await applyPendingFeatures(tx);
      await tx.term.updateMany({
        where: { active: true },
        data: { active: false },
      });
      const term = await tx.term.upsert({
        where: {
          schoolYear_quarter: {
            schoolYear: np.schoolYear,
            quarter: np.quarter,
          },
        },
        update: { active: true, ...openingOverrides },
        create: {
          schoolYear: np.schoolYear,
          quarter: np.quarter,
          name,
          active: true,
          ...openingOverrides,
        },
      });
      const tutees = await tx.tutee.updateMany({
        where: { status: { in: ["PENDING", "ACTIVE"] } },
        data: { status: "INACTIVE" },
      });

      // A membership break is not an academic gap. Never increment reported grades.
      // Only a confirmed G12 report for the graduating year may trigger graduation.
      let graduated = 0;
      const aged = 0; // Retained response field for older clients; always zero.
      if (semesterMode ? yearCross : np.quarter === "Q4") {
        const graduating = await tx.tutor.findMany({
          where: {
            status: "ACTIVE",
            gradeLevel: 12,
            gradeSchoolYear: from.schoolYear,
            gradeConfirmedAt: { not: null },
            OR: [
              { user: { is: null } },
              {
                user: {
                  academicProfile: {
                    status: "REPORTED",
                    schoolYear: from.schoolYear,
                    reconfirmRequired: false,
                  },
                },
              },
            ],
          },
          include: { user: { include: { schoolDeparture: true } } },
        });
        const grad = await tx.tutor.updateMany({
          where: {
            status: "ACTIVE",
            gradeLevel: 12,
            gradeSchoolYear: from.schoolYear,
            gradeConfirmedAt: { not: null },
            OR: [
              { user: { is: null } },
              {
                user: {
                  academicProfile: {
                    status: "REPORTED",
                    schoolYear: from.schoolYear,
                    reconfirmRequired: false,
                  },
                },
              },
            ],
          },
          data: { status: "GRADUATED" },
        });
        graduated = grad.count;
        for (const tutor of graduating)
          if (tutor.user)
            await changeSchoolDeparture(
              tx,
              {
                userId: tutor.user.id,
                action: "GRADUATED",
                expectedRevision: tutor.user.schoolDeparture?.revision ?? 0,
                explanation:
                  "Confirmed senior graduation during program refresh",
              },
              actor.id,
              "PROGRAM_REFRESH",
            );
      }
      // Academic staleness is derived from the new active year. Keeping the report
      // untouched preserves history and avoids lock inversion with account-profile writers.

      // Semester rollover: every continuing ACTIVE tutor must re-confirm availability. Set them
      // PENDING — they reactivate (available) or opt out from their own page, and their status
      // syncs straight back to the admin views. (Graduated/opted-out/archived are left as-is.)
      let pending = 0;
      if (semesterCross) {
        const p = await tx.tutor.updateMany({
          where: { status: "ACTIVE" },
          data: { status: "PENDING" },
        });
        pending = p.count;
      }

      return {
        termId: term.id,
        archivedTutees: tutees.count,
        graduated,
        aged,
        pending,
      };
    })();

    await recordAudit(
      {
        userId: actor.id,
        userName: actor.name,
        action:
          `Refreshed program to ${name} — archived ${out.archivedTutees} tutee(s)` +
          (out.graduated ? `, graduated ${out.graduated} tutor(s)` : "") +
          (out.aged ? `, aged up ${out.aged}` : "") +
          (out.pending ? `, ${out.pending} tutor(s) must reactivate` : "") +
          "; switched pairings board to the destination period; prior history retained",
        entity: "Term",
        entityId: out.termId,
        operation: "admin.refresh",
        // Keep the exact reviewed openings, source/mode and time zone as
        // immutable evidence even after the new current window is edited.
        effects: JSON.parse(
          JSON.stringify({
            nextRecruitment: preparation.refreshEvidence,
          }),
        ) as Prisma.InputJsonValue,
      },
      tx,
    );
    return {
      schoolYear: np.schoolYear,
      quarter: np.quarter,
      name,
      crossedSemester: semesterCross,
      crossedYear: yearCross,
      archivedTutees: out.archivedTutees,
      graduatedTutors: out.graduated,
      agedTutors: out.aged,
      pendingTutors: out.pending,
    };
  });
}
