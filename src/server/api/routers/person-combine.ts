import { z } from "zod";
import { createTRPCRouter, adminOnlyProcedure } from "../trpc";
import {
  combinePersonRecords,
  personCombineInput,
  personCombineSelection,
  personCombineReceiptResult,
  previewPersonCombine,
} from "~/server/person-combine";

export const personCombineRouter = createTRPCRouter({
  candidates: adminOnlyProcedure
    .input(z.object({ search: z.string().trim().max(100).default("") }))
    .query(async ({ ctx, input }) => {
      // Source search exposes identity labels only. Every source remains selectable,
      // including unfinished credentials, archived roles and accountless groups.
      const contains = { contains: input.search, mode: "insensitive" as const };
      const [users, tutors, tutees] = await Promise.all([
        ctx.db.user.findMany({
          where: {
            OR: [
              { id: contains },
              { name: contains },
              { email: contains },
              { username: contains },
            ],
          },
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            personId: true,
            role: true,
            mergedIntoId: true,
          },
          orderBy: { id: "asc" },
          take: 50,
        }),
        ctx.db.tutor.findMany({
          where: {
            OR: [
              { id: contains },
              { englishName: contains },
              { email: contains },
              { username: contains },
            ],
          },
          select: {
            id: true,
            englishName: true,
            email: true,
            personId: true,
            status: true,
            user: { select: { id: true } },
            retainedOwner: { select: { userId: true } },
          },
          orderBy: { id: "asc" },
          take: 50,
        }),
        ctx.db.tutee.findMany({
          where: {
            OR: [
              { id: contains },
              { englishName: contains },
              { email: contains },
            ],
          },
          select: {
            id: true,
            englishName: true,
            email: true,
            personId: true,
            status: true,
            user: { select: { id: true } },
          },
          orderBy: { id: "asc" },
          take: 50,
        }),
      ]);
      const owners = await ctx.db.studentProfileOwnership.findMany({
        where: { tuteeId: { in: tutees.map((r) => r.id) } },
        select: { tuteeId: true },
      });
      return [
        ...users.map((r) => ({
          ref: { kind: "USER" as const, id: r.id },
          name: r.name ?? r.username ?? r.email,
          email: r.email,
          personId: r.personId,
          status: r.mergedIntoId ? "RETIRED" : r.role,
          hasLogin: !r.mergedIntoId,
        })),
        ...tutors.map((r) => ({
          ref: { kind: "TUTOR" as const, id: r.id },
          name: r.englishName,
          email: r.email,
          personId: r.personId,
          status: r.status,
          hasLogin: !!r.user || !!r.retainedOwner,
        })),
        ...tutees.map((r) => ({
          ref: { kind: "TUTEE" as const, id: r.id },
          name: r.englishName,
          email: r.email,
          personId: r.personId,
          status: r.status,
          hasLogin: !!r.user || owners.some((o) => o.tuteeId === r.id),
        })),
      ];
    }),
  preview: adminOnlyProcedure
    .input(personCombineSelection)
    .query(({ ctx, input }) => previewPersonCombine(ctx.db, input)),
  combine: adminOnlyProcedure
    .input(personCombineInput)
    .mutation(({ ctx, input }) =>
      combinePersonRecords(ctx.db, ctx.session.user.id, input),
    ),
  receipt: adminOnlyProcedure
    .input(z.object({ operationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const receipt = await ctx.db.personCombineReceipt.findUnique({
        where: { id: input.operationId },
      });
      return receipt?.actorId === ctx.session.user.id
        ? personCombineReceiptResult(receipt)
        : null;
    }),
});
