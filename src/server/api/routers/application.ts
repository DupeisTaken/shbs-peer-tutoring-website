import { lockCatalogue } from "~/server/qualifications";
import { subjectOrderBy } from "~/lib/course-catalogue";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { currentPolicy } from "~/server/policy-acceptance";
import { getSignupSettings } from "~/server/program/signup-fields";
import {
  fieldMissing,
  subjectFieldKey,
  normalizeTutorSubject,
  missingTutorSubject,
} from "~/lib/signup-fields";
import { inTransaction, lockEntity } from "~/server/transactions";
import { notifyAdmins } from "~/server/notifications/create";

/**
 * Public tutor-application intake. Submitting does NOT create a login — it records an
 * application for the admin team to review and assign interviewers to. Subject choices come
 * from the admin-managed catalog.
 */
export const applicationRouter = createTRPCRouter({
  /** Active subjects for the application's subject pickers (with their level). */
  options: publicProcedure.query(async ({ ctx }) => {
    const [settings, subjects] = await Promise.all([
      getSignupSettings(ctx.db),
      ctx.db.subject.findMany({
        where: { active: true },
        orderBy: [...subjectOrderBy],
        select: {
          id: true,
          name: true,
          level: { select: { name: true, apScored: true } },
        },
      }),
    ]);
    return { fields: settings.tutor, subjects };
  }),

  /**
   * The tutor policy/handbook (admin-editable) shown in the application agreement modal, in the
   * requested UI locale. Falls back to the English version when that language isn't translated.
   */
  policy: publicProcedure
    .input(z.object({ locale: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const policy = await currentPolicy(ctx.db, "tutor-policy");
      const document =
        policy.documents.find((d) => d.locale === input?.locale) ??
        policy.documents.find((d) => d.locale === "en")!;
      return { ...document, revision: policy.revision };
    }),

  submit: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "Name is required").max(120),
        email: z.string().trim().email().max(254),
        agreed: z.literal(true),
        policyRevision: z.string().min(1),
        preferredContact: z.string().trim().max(200).default(""),
        subjects: z
          .array(
            z.object({
              subjectId: z.string(),
              // Took the class — class grade, only meaningful when taken.
              taken: z.boolean().optional(),
              grade: z.string().trim().max(20).optional(),
              // Has an AP score — the score, only meaningful when hasApScore.
              hasApScore: z.boolean().optional(),
              apScore: z.string().trim().max(20).optional(),
              // Self-studied — how they qualify, only meaningful when selfStudied.
              selfStudied: z.boolean().optional(),
              selfStudyNote: z.string().trim().max(500).optional(),
            }),
          )
          .min(1, "Pick at least one subject")
          .max(3, "At most three subjects"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "signup-fields");
        await lockEntity(tx, "policy:tutor-policy");
        const fields = (await getSignupSettings(tx)).tutor;
        const policy = await currentPolicy(tx, "tutor-policy");
        if (
          !policy.documents
            .find((document) => document.locale === "en")
            ?.body.trim()
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "The team must publish the tutor policy before signup opens.",
          });
        if (policy.revision !== input.policyRevision)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The policy changed. Reload and accept the current policy.",
          });
        if (fieldMissing(fields, "preferredContact", input.preferredContact))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Tell us how to reach you. Reload the form if settings changed.",
          });
        // Preserve selection positions until required/hidden additional choices have been checked.
        for (let i = 0; i < 3; i++)
          if (
            fieldMissing(
              fields,
              subjectFieldKey(i),
              input.subjects[i]?.subjectId,
            )
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Complete required subject selections. Reload the form if settings changed.",
            });
        const subjects = input.subjects.filter(
          (row, i) => fields[subjectFieldKey(i)] !== "hidden" && row.subjectId,
        );
        const subjectIds = subjects.map((c) => c.subjectId);
        if (new Set(subjectIds).size !== subjectIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Duplicate subject selected.",
          });
        }

        // Serialize catalogue edits with validating and storing stable subject IDs.
        await lockCatalogue(tx);
        const valid = await tx.subject.findMany({
          where: { id: { in: subjectIds }, active: true },
          select: { id: true, level: { select: { apScored: true } } },
        });
        if (valid.length !== subjectIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid subject selection.",
          });
        }
        // A subject can carry an AP score only if its level is flagged apScored.
        const apEligibleById = new Map(
          valid.map((c) => [c.id, c.level?.apScored ?? false]),
        );

        const normalized = subjects.map((row) => {
          const isAp = apEligibleById.get(row.subjectId) === true;
          const value = normalizeTutorSubject(row, fields, isAp);
          if (missingTutorSubject(value, fields, isAp).length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Complete required qualification answers. Reload the form if settings changed.",
            });
          return value;
        });
        await tx.tutorApplication.create({
          data: {
            name: input.name,
            email: input.email.trim().toLowerCase(),
            preferredContact:
              fields.preferredContact === "hidden"
                ? null
                : input.preferredContact || null,
            policyRevision: policy.revision,
            policySnapshot: policy.documents,
            policyAcceptedAt: new Date(),
            status: "PENDING",
            subjectIntents: {
              create: normalized.map((c) => {
                // AP score only applies to subjects whose level is AP-scored.
                const apEligible = apEligibleById.get(c.subjectId) === true;
                const hasApScore = apEligible && (c.hasApScore ?? false);
                const selfStudyNote =
                  c.selfStudied && c.selfStudyNote?.trim()
                    ? c.selfStudyNote.trim()
                    : null;
                return {
                  subjectId: c.subjectId,
                  taken: c.taken ?? false,
                  grade: c.taken && c.grade?.trim() ? c.grade.trim() : null,
                  hasApScore,
                  apScore:
                    hasApScore && c.apScore?.trim() ? c.apScore.trim() : null,
                  selfStudied: c.selfStudied ?? false,
                  selfStudyNote,
                };
              }),
            },
          },
        });
      });

      // Notify the admin team there's a new application to review / assign interviewers.
      await notifyAdmins({
        title: "New tutor application",
        body: `${input.name} applied to tutor.`,
        link: "/admin/applications",
      });

      return { ok: true };
    }),
});
