import type { Prisma } from "../../../../generated/prisma";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "~/server/api/trpc";
import { inTransaction, lockEntity } from "~/server/transactions";
import { currentPolicy } from "~/server/policy-acceptance";
import { consumeStudentAction } from "~/server/student-workflow";
import { ownedStudentIds } from "~/server/student-ownership";
import { notifyAdmins, notifyUsers } from "~/server/notifications/create";
import { syncPunishmentRemoval } from "~/server/discipline/removal";
import { assertFeatureEnabled } from "~/server/program/features";

const staff = (role: string) => ["HEAD", "ADMIN", "COORDINATOR"].includes(role);
const text = z.string().trim().min(1).max(2000);
const paging = z
  .object({ page: z.number().int().min(0).default(0) })
  .default({ page: 0 });
/** Weekday deadline uses the school's UTC+8 calendar; staff may still correct cards independently. */
export function appealDeadline(
  date: Date,
  overrides: { date: string; isSchoolDay: boolean }[] = [],
) {
  const day = new Date(date.getTime() + 8 * 3600000);
  for (let remaining = 5; remaining > 0;) {
    day.setUTCDate(day.getUTCDate() + 1);
    const override = overrides.find(
      (o) => o.date === day.toISOString().slice(0, 10),
    );
    if (override?.isSchoolDay ?? ![0, 6].includes(day.getUTCDay())) remaining--;
  }
  day.setUTCHours(23, 59, 59, 999);
  return new Date(day.getTime() - 8 * 3600000);
}
export const studentRouter = createTRPCRouter({
  acceptanceRecords: adminProcedure
    .input(paging)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.policyAcceptance.findMany({
        orderBy: { acceptedAt: "desc" },
        take: 20,
        skip: input.page * 20,
      });
      const users = await ctx.db.user.findMany({
        where: { id: { in: rows.map((r) => r.userId) } },
        select: { id: true, name: true },
      });
      return rows.map((r) => ({
        ...r,
        name: users.find((u) => u.id === r.userId)?.name ?? r.signature,
      }));
    }),
  calendar: adminProcedure.query(({ ctx }) =>
    ctx.db.schoolCalendarDay.findMany({ orderBy: { date: "asc" } }),
  ),
  setCalendarDay: adminProcedure
    .input(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        isSchoolDay: z.boolean(),
        note: z.string().trim().max(300),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        if (
          Number.isNaN(Date.parse(input.date)) ||
          new Date(input.date).toISOString().slice(0, 10) !== input.date
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid calendar date.",
          });
        await tx.schoolCalendarDay.upsert({
          where: { date: input.date },
          update: input,
          create: input,
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            entity: "SchoolCalendarDay",
            entityId: input.date,
            action: `School calendar: ${input.isSchoolDay ? "school day" : "holiday"}`,
            details: input,
          },
        });
        return { ok: true };
      }),
    ),

  policy: protectedProcedure
    .input(z.object({ slug: z.enum(["tutee-policy", "tutor-policy"]) }))
    .query(async ({ ctx, input }) => {
      const policy = await currentPolicy(ctx.db, input.slug);
      const accepted = await ctx.db.policyAcceptance.findUnique({
        where: {
          userId_slug_revision: {
            userId: ctx.session.user.id,
            slug: input.slug,
            revision: policy.revision,
          },
        },
      });
      return { ...policy, accepted: !!accepted };
    }),
  acceptPolicy: protectedProcedure
    .input(
      z.object({
        slug: z.enum(["tutee-policy", "tutor-policy"]),
        revision: z.string(),
        signature: z.string().trim().min(1).max(120),
        ticket: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, `policy:${input.slug}`);
        const current = await currentPolicy(tx, input.slug);
        if (current.revision !== input.revision)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Policy changed. Read the latest version.",
          });
        if (input.slug === "tutee-policy")
          await consumeStudentAction(
            tx,
            input.ticket ?? "",
            ctx.session.user.id,
            "POLICY",
            current.revision,
          );
        await tx.policyAcceptance.upsert({
          where: {
            userId_slug_revision: {
              userId: ctx.session.user.id,
              slug: input.slug,
              revision: input.revision,
            },
          },
          update: {},
          create: {
            userId: ctx.session.user.id,
            slug: input.slug,
            revision: input.revision,
            signature: input.signature,
            snapshot: current.documents,
          },
        });
        return { ok: true };
      }),
    ),
  me: protectedProcedure.input(paging).query(async ({ ctx, input }) => {
    const owned = await ownedStudentIds(ctx.db, ctx.session.user.id);
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: { studentId: true, name: true, email: true },
    });
    const student = user.studentId
      ? await ctx.db.tutee.findUnique({
          where: { id: user.studentId },
          select: {
            id: true,
            englishName: true,
            status: true,
            intakeTermId: true,
            pairings: {
              where: { pairing: { term: { active: true } } },
              select: {
                pairing: {
                  select: {
                    subject: true,
                    timeSlotId: true,
                    dayOfWeek: true,
                    startMin: true,
                    endMin: true,
                    room: { select: { name: true } },
                    tutor: { select: { englishName: true } },
                  },
                },
              },
            },
          },
        })
      : null;
    const sessions = owned.length
      ? await ctx.db.sessionTutee.findMany({
          where: { tuteeId: { in: owned } },
          orderBy: { session: { date: "desc" } },
          take: 20,
          skip: input.page * 20,
          select: {
            status: true,
            session: {
              select: {
                id: true,
                date: true,
                pairing: { select: { subject: true } },
              },
            },
          },
        })
      : [];
    const calendar = await ctx.db.schoolCalendarDay.findMany();
    const cards = owned.length
      ? await ctx.db.disciplinaryCard.findMany({
          where: { tuteeId: { in: owned } },
          orderBy: { createdAt: "desc" },
          take: 20,
          skip: input.page * 20,
          select: {
            id: true,
            color: true,
            reason: true,
            reviewStatus: true,
            createdAt: true,
          },
        })
      : [];
    const appeals = owned.length
      ? await ctx.db.studentAppeal.findMany({
          where: { studentId: { in: owned } },
          orderBy: { createdAt: "desc" },
          take: 20,
          skip: input.page * 20,
        })
      : [];
    const feedback = owned.length
      ? await ctx.db.studentFeedback.findMany({
          where: {
            studentId: { in: owned },
            sessionId: { in: sessions.map((s) => s.session.id) },
          },
        })
      : [];
    return {
      user,
      student,
      sessions: sessions.map((s) => ({
        ...s,
        feedback: feedback.find((f) => f.sessionId === s.session.id) ?? null,
      })),
      cards: cards.map((c) => ({
        ...c,
        deadline: appealDeadline(c.createdAt, calendar),
      })),
      appeals,
    };
  }),
  feedbackSettings: protectedProcedure.query(
    async ({ ctx }) =>
      (await ctx.db.studentSettings.findUnique({ where: { id: "program" } }))
        ?.shareFeedbackWithTutors ?? false,
  ),
  setFeedbackSettings: adminProcedure
    .input(z.object({ share: z.boolean() }))
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await tx.studentSettings.upsert({
          where: { id: "program" },
          update: { shareFeedbackWithTutors: input.share },
          create: { shareFeedbackWithTutors: input.share },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            action: `Feedback visibility: ${input.share ? "staff and assigned tutors" : "staff only"}`,
            entity: "StudentSettings",
            entityId: "program",
          },
        });
        return { ok: true };
      }),
    ),
  feedback: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        rating: z.number().int().min(1).max(5),
        body: text,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        const owned = await ownedStudentIds(tx, ctx.session.user.id);
        const attendance = await tx.sessionTutee.findFirst({
          where: { sessionId: input.sessionId, tuteeId: { in: owned } },
        });
        if (!attendance) throw new TRPCError({ code: "FORBIDDEN" });
        const row = await tx.studentFeedback.upsert({
          where: {
            studentId_sessionId: {
              studentId: attendance.tuteeId,
              sessionId: input.sessionId,
            },
          },
          update: { rating: input.rating, body: input.body },
          create: { studentId: attendance.tuteeId, ...input },
        });
        await notifyAdmins(
          { title: "Student feedback received", link: "/student-support" },
          undefined,
          tx,
        );
        return row;
      }),
    ),
  feedbackList: protectedProcedure
    .input(paging)
    .query(async ({ ctx, input }) => {
      const shared =
        (await ctx.db.studentSettings.findUnique({ where: { id: "program" } }))
          ?.shareFeedbackWithTutors ?? false;
      if (!staff(ctx.session.role) && (!shared || !ctx.session.tutorId))
        throw new TRPCError({ code: "FORBIDDEN" });
      const sessions = !staff(ctx.session.role)
        ? await ctx.db.session.findMany({
            where: { tutorId: ctx.session.tutorId! },
            select: { id: true },
          })
        : null;
      const rows = await ctx.db.studentFeedback.findMany({
        where: sessions ? { sessionId: { in: sessions.map((s) => s.id) } } : {},
        orderBy: { updatedAt: "desc" },
        take: 20,
        skip: input.page * 20,
      });
      const [students, lessons] = await Promise.all([
        ctx.db.tutee.findMany({
          where: { id: { in: rows.map((r) => r.studentId) } },
          select: { id: true, englishName: true },
        }),
        ctx.db.session.findMany({
          where: { id: { in: rows.map((r) => r.sessionId) } },
          select: { id: true, pairing: { select: { subject: true } } },
        }),
      ]);
      return rows.map((r) => ({
        ...r,
        studentName:
          students.find((s) => s.id === r.studentId)?.englishName ??
          "Deleted student",
        subject:
          lessons.find((l) => l.id === r.sessionId)?.pairing.subject ??
          "Archived session",
      }));
    }),
  appeal: protectedProcedure
    .input(z.object({ cardId: z.string(), body: text }))
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await assertFeatureEnabled(tx, "DISCIPLINE");
        const owned = await ownedStudentIds(tx, ctx.session.user.id);
        const card = await tx.disciplinaryCard.findUnique({
          where: { id: input.cardId },
        });
        if (!card || !owned.includes(card.tuteeId))
          throw new TRPCError({ code: "FORBIDDEN" });
        if (card.reviewStatus === "INVALID")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This card has already been invalidated.",
          });
        if (
          appealDeadline(
            card.createdAt,
            await tx.schoolCalendarDay.findMany(),
          ) < new Date()
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "The five-school-day appeal window has ended. Contact the team.",
          });
        const existing = await tx.studentAppeal.findFirst({
          where: { cardId: card.id },
          select: { id: true },
        });
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This card already has an appeal.",
          });
        await tx.studentAppeal.create({
          data: { studentId: card.tuteeId, ...input },
        });
        await notifyAdmins(
          { title: "Student card appeal", link: "/student-support" },
          undefined,
          tx,
        );
        return { ok: true };
      }),
    ),
  appeals: adminProcedure
    .input(
      z
        .object({
          page: z.number().int().min(0).default(0),
          state: z.enum(["PENDING", "RESOLVED"]).default("PENDING"),
        })
        .default({ page: 0, state: "PENDING" }),
    )
    .query(async ({ ctx, input }) => {
      const where =
        input.state === "PENDING"
          ? { state: "PENDING" }
          : { state: { in: ["UPHELD", "REJECTED"] } };
      const [rows, total] = await Promise.all([
        ctx.db.studentAppeal.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 20,
          skip: input.page * 20,
        }),
        ctx.db.studentAppeal.count({ where }),
      ]);
      const [students, cards] = await Promise.all([
        ctx.db.tutee.findMany({
          where: { id: { in: rows.map((r) => r.studentId) } },
          select: { id: true, englishName: true },
        }),
        ctx.db.disciplinaryCard.findMany({
          where: { id: { in: rows.map((r) => r.cardId) } },
          select: { id: true, reason: true },
        }),
      ]);
      return {
        rows: rows.map((r) => ({
          ...r,
          studentName:
            students.find((s) => s.id === r.studentId)?.englishName ??
            "Deleted student",
          cardReason: cards.find((c) => c.id === r.cardId)?.reason,
        })),
        total,
      };
    }),
  decideAppeal: adminProcedure
    .input(
      z.object({
        id: z.string(),
        overturn: z.boolean(),
        reason: text,
        expectedUpdatedAt: z.coerce.date(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await assertFeatureEnabled(tx, "DISCIPLINE");
        const appeal = await tx.studentAppeal.findUniqueOrThrow({
          where: { id: input.id },
        });
        const updated = await tx.studentAppeal.updateMany({
          where: {
            id: input.id,
            state: "PENDING",
            updatedAt: input.expectedUpdatedAt,
          },
          data: {
            state: input.overturn ? "UPHELD" : "REJECTED",
            decision: input.reason,
            decidedById: ctx.session.user.id,
          },
        });
        if (!updated.count)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This appeal was already reviewed. Refresh the page.",
          });
        const before = await tx.disciplinaryCard.findUniqueOrThrow({
          where: { id: appeal.cardId },
        });
        if (input.overturn) {
          await tx.disciplinaryCard.update({
            where: { id: appeal.cardId },
            data: {
              reviewStatus: "INVALID",
              reviewNote: input.reason,
              reviewedAt: new Date(),
              reviewedById: ctx.session.user.id,
            },
          });
          await syncPunishmentRemoval(tx, appeal.studentId);
        }
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            entity: "StudentAppeal",
            entityId: appeal.id,
            action: `Appeal ${input.overturn ? "upheld" : "rejected"}: ${input.reason}`,
            details: JSON.parse(
              JSON.stringify({ before, appeal }),
            ) as Prisma.InputJsonValue,
          },
        });
        const historyOwner = await tx.studentProfileOwnership.findUnique({
          where: { tuteeId: appeal.studentId },
        });
        const owner = await tx.user.findUnique({
          where: historyOwner
            ? { id: historyOwner.userId }
            : { studentId: appeal.studentId },
        });
        if (owner)
          await notifyUsers(
            [owner.id],
            { title: "Your appeal was reviewed", link: "/student" },
            tx,
          );
        return { ok: true };
      }),
    ),
});
