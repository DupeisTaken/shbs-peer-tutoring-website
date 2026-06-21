import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const cuid = z.string().min(1);

/** Trim a string and collapse empty/whitespace-only values to null. */
function blankToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * Public-facing tutee signup. Anyone (no login) can submit the form; the record is
 * created with status PENDING for an admin to review and assign to a tutor. Course
 * choices and available time slots are drawn from the admin-managed catalogs.
 */
export const tuteeRouter = createTRPCRouter({
  /** Options needed to render the public signup form: active courses + active time slots. */
  signupOptions: publicProcedure.query(async ({ ctx }) => {
    const [courses, slots] = await Promise.all([
      ctx.db.course.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      ctx.db.timeSlot.findMany({
        where: { active: true },
        orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
        select: { id: true, label: true, dayOfWeek: true, startMin: true, endMin: true },
      }),
    ]);
    return { courses, slots };
  }),

  /** The tutee policy/handbook (admin-editable) shown in the signup agreement modal. */
  policy: publicProcedure.query(({ ctx }) =>
    ctx.db.policyDocument.findUnique({
      where: { slug: "tutee-policy" },
      select: { title: true, body: true },
    }),
  ),

  /** Submit a public signup request. Creates a PENDING tutee with course choices,
   *  availability and a typed rulebook signature. */
  requestSignup: publicProcedure
    .input(
      z.object({
        englishName: z.string().trim().min(1, "Name is required").max(120),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().trim().max(40).optional(),
        preferredContact: z
          .string()
          .trim()
          .min(1, "Tell us how to reach you")
          .max(200),
        gradeLevel: z.string().trim().max(40).optional(),
        firstChoiceId: cuid,
        secondChoiceId: cuid.optional().or(z.literal("")),
        slotIds: z.array(cuid).min(1, "Select at least one available time slot"),
        signatureName: z.string().trim().min(1, "Signature is required").max(120),
        agreed: z.literal(true, {
          errorMap: () => ({ message: "You must agree to the rulebook." }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const secondChoiceId =
        input.secondChoiceId === "" ? undefined : input.secondChoiceId;
      if (secondChoiceId && secondChoiceId === input.firstChoiceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "First and second course choices must be different.",
        });
      }

      // Validate the referenced courses exist and are active.
      const courseIds = [input.firstChoiceId, ...(secondChoiceId ? [secondChoiceId] : [])];
      const courses = await ctx.db.course.findMany({
        where: { id: { in: courseIds }, active: true },
        select: { id: true },
      });
      if (courses.length !== courseIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid course selection." });
      }

      // Validate the selected slots exist and are active.
      const slotIds = [...new Set(input.slotIds)];
      const slots = await ctx.db.timeSlot.findMany({
        where: { id: { in: slotIds }, active: true },
        select: { id: true },
      });
      if (slots.length !== slotIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid time slot selection." });
      }

      await ctx.db.tutee.create({
        data: {
          englishName: input.englishName,
          email: blankToNull(input.email)?.toLowerCase() ?? null,
          phone: blankToNull(input.phone),
          preferredContact: input.preferredContact,
          gradeLevel: blankToNull(input.gradeLevel),
          status: "PENDING",
          firstChoiceId: input.firstChoiceId,
          secondChoiceId: secondChoiceId ?? null,
          signedRulebook: true,
          signatureName: input.signatureName,
          signedAt: new Date(),
          availabilities: { create: slotIds.map((slotId) => ({ slotId })) },
        },
      });

      return { ok: true };
    }),
});
