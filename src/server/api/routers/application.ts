import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { localizedPolicy } from "~/server/policy";

const cuid = z.string().min(1);

/**
 * Public tutor-application intake. Submitting does NOT create a login — it records an
 * application for the admin team to review and assign interviewers to. Subject choices come
 * from the admin-managed catalog.
 */
export const applicationRouter = createTRPCRouter({
  /** Active subjects for the application's subject pickers (with their level). */
  options: publicProcedure.query(({ ctx }) =>
    ctx.db.subject.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        level: { select: { name: true, apScored: true } },
      },
    }),
  ),

  /**
   * The tutor policy/handbook (admin-editable) shown in the application agreement modal, in the
   * requested UI locale. Falls back to the English version when that language isn't translated.
   */
  policy: publicProcedure
    .input(z.object({ locale: z.string().optional() }).optional())
    .query(({ ctx, input }) => localizedPolicy(ctx.db, "tutor-policy", input?.locale)),

  submit: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "Name is required").max(120),
        email: z.string().email(),
        preferredContact: z
          .string()
          .trim()
          .min(1, "Tell us how to reach you")
          .max(200),
        subjects: z
          .array(
            z.object({
              subjectId: cuid,
              // Took the class — class grade, only meaningful when taken.
              taken: z.boolean(),
              grade: z.string().trim().max(20).optional(),
              // Has an AP score — the score, only meaningful when hasApScore.
              hasApScore: z.boolean(),
              apScore: z.string().trim().max(20).optional(),
              // Self-studied — how they qualify, only meaningful when selfStudied.
              selfStudied: z.boolean(),
              selfStudyNote: z.string().trim().max(500).optional(),
            }),
          )
          .min(1, "Pick at least one subject")
          .max(3, "At most three subjects"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subjectIds = input.subjects.map((c) => c.subjectId);
      if (new Set(subjectIds).size !== subjectIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate subject selected." });
      }

      const valid = await ctx.db.subject.findMany({
        where: { id: { in: subjectIds }, active: true },
        select: { id: true, level: { select: { apScored: true } } },
      });
      if (valid.length !== subjectIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid subject selection." });
      }
      // A subject can carry an AP score only if its level is flagged apScored.
      const apEligibleById = new Map(valid.map((c) => [c.id, c.level?.apScored ?? false]));

      await ctx.db.tutorApplication.create({
        data: {
          name: input.name,
          email: input.email.trim().toLowerCase(),
          preferredContact: input.preferredContact,
          status: "PENDING",
          subjectIntents: {
            create: input.subjects.map((c) => {
              // AP score only applies to subjects whose level is AP-scored.
              const apEligible = apEligibleById.get(c.subjectId) === true;
              const hasApScore = apEligible && c.hasApScore;
              const selfStudyNote =
                c.selfStudied && c.selfStudyNote?.trim() ? c.selfStudyNote.trim() : null;
              return {
                subjectId: c.subjectId,
                taken: c.taken,
                grade: c.taken && c.grade?.trim() ? c.grade.trim() : null,
                hasApScore,
                apScore: hasApScore && c.apScore?.trim() ? c.apScore.trim() : null,
                selfStudied: c.selfStudied,
                selfStudyNote,
              };
            }),
          },
        },
      });

      return { ok: true };
    }),
});
