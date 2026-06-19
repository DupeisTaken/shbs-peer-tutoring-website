import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const cuid = z.string().min(1);

/**
 * Public tutor-application intake. Submitting does NOT create a login — it records an
 * application for the admin team to review and assign interviewers to. Course choices come
 * from the admin-managed catalog.
 */
export const applicationRouter = createTRPCRouter({
  /** Active courses for the application's course pickers. */
  options: publicProcedure.query(({ ctx }) =>
    ctx.db.course.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ),

  submit: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "Name is required").max(120),
        email: z.string().email(),
        courses: z
          .array(
            z.object({
              courseId: cuid,
              taken: z.boolean(),
              // Grade received / AP score, only meaningful when taken.
              grade: z.string().trim().max(20).optional(),
            }),
          )
          .min(1, "Pick at least one course")
          .max(3, "At most three courses"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const courseIds = input.courses.map((c) => c.courseId);
      if (new Set(courseIds).size !== courseIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate course selected." });
      }

      const valid = await ctx.db.course.findMany({
        where: { id: { in: courseIds }, active: true },
        select: { id: true },
      });
      if (valid.length !== courseIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid course selection." });
      }

      await ctx.db.tutorApplication.create({
        data: {
          name: input.name,
          email: input.email.trim().toLowerCase(),
          status: "PENDING",
          courseIntents: {
            create: input.courses.map((c) => ({
              courseId: c.courseId,
              taken: c.taken,
              grade: c.taken && c.grade?.trim() ? c.grade.trim() : null,
            })),
          },
        },
      });

      return { ok: true };
    }),
});
