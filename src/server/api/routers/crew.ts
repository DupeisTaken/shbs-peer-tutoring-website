import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  crewProcedure,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { getActivePeriodOrNull } from "~/server/period";
import { syncSessionFlag } from "~/server/crew/flags";
import { notifyAdmins } from "~/server/notifications/create";

/** Service hours credited per completed patrol (policy). */
export const PATROL_HOURS = 0.5;

/** Recall window before a crew opt-out becomes admin-approvable (mirrors the tutor opt-out). */
export const CREW_OPT_OUT_COOLDOWN_DAYS = 7;

const HEADCOUNTS = ["ZERO", "ONE", "TWO", "THREE", "FOUR_PLUS"] as const;

/**
 * Crew patrol router — the roaming team records room headcounts to validate tutor attendance.
 * Gated by `crewProcedure` (any `isCrew` user, incl. tutors who also patrol).
 */
export const crewRouter = createTRPCRouter({
  /** Rooms in patrol order + the caller's crew-hour total, for the patrol portal. */
  patrolConfig: crewProcedure.query(async ({ ctx }) => {
    const [rooms, agg] = await Promise.all([
      ctx.db.room.findMany({
        orderBy: [{ patrolOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
      ctx.db.patrol.aggregate({
        where: { crewUserId: ctx.session.user.id },
        _sum: { hours: true },
        _count: { _all: true },
      }),
    ]);
    return {
      rooms,
      myPatrols: agg._count._all,
      myHours: agg._sum.hours ?? 0,
    };
  }),

  /** The caller's recent patrols (with per-room observations) for their history view. */
  myPatrols: crewProcedure.query(({ ctx }) =>
    ctx.db.patrol.findMany({
      where: { crewUserId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        hours: true,
        note: true,
        observations: {
          orderBy: { observedAt: "asc" },
          select: {
            id: true,
            headcount: true,
            observedAt: true,
            room: { select: { name: true } },
          },
        },
      },
    }),
  ),

  /**
   * Record a completed patrol: one headcount per visited room (with the time observed). Credits
   * 0.5h, then reconciles every session in those rooms against the crew evidence (under-counts
   * raise a SessionFlag for admins). At least one observation is required.
   */
  submitPatrol: crewProcedure
    .input(
      z.object({
        note: z.string().trim().max(500).optional(),
        observations: z
          .array(
            z.object({
              roomId: z.string().cuid(),
              headcount: z.enum(HEADCOUNTS),
              // Client stamps the time each room was checked; defaults to now if omitted.
              observedAt: z.coerce.date().optional(),
            }),
          )
          .min(1, "Record at least one room."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const active = await getActivePeriodOrNull(ctx.db);
      const now = new Date();
      const patrol = await ctx.db.patrol.create({
        data: {
          crewUserId: ctx.session.user.id,
          termId: active?.termId ?? null,
          hours: PATROL_HOURS,
          note: input.note?.trim() ? input.note.trim() : null,
          observations: {
            create: input.observations.map((o) => ({
              roomId: o.roomId,
              headcount: o.headcount,
              observedAt: o.observedAt ?? now,
            })),
          },
        },
        select: { id: true },
      });

      // Reconcile the sessions in the patrolled rooms around the observed times.
      const roomIds = [...new Set(input.observations.map((o) => o.roomId))];
      const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const dayEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const sessions = await ctx.db.session.findMany({
        where: {
          actualRoomId: { in: roomIds },
          online: false,
          date: { gte: dayStart, lte: dayEnd },
        },
        select: { id: true },
      });
      for (const s of sessions) await syncSessionFlag(ctx.db, s.id);

      return { ok: true, id: patrol.id, hours: PATROL_HOURS };
    }),

  /** Public "apply to be crew" form (no login created — like /signup & /tutor-signup). Creates a
   *  PENDING CrewApplication an admin reviews; accepting issues a crew registration code. */
  submitApplication: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().email(),
        gradeLevel: z.number().int().min(6).max(12).nullable().optional(),
        preferredContact: z.string().trim().max(200).optional(),
        message: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.crewApplication.create({
        data: {
          name: input.name,
          email: input.email.toLowerCase(),
          gradeLevel: input.gradeLevel ?? null,
          preferredContact: input.preferredContact?.trim() ? input.preferredContact.trim() : null,
          message: input.message?.trim() ? input.message.trim() : null,
        },
      });
      await notifyAdmins({
        title: "New crew application",
        body: `${input.name} applied to join the crew.`,
        link: "/admin/crew",
      });
      return { ok: true };
    }),

  /** The caller's crew lifecycle state + any pending opt-out/reentry request, for the portal. */
  myStatus: protectedProcedure.query(async ({ ctx }) => {
    const me = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { crewStatus: true },
    });
    const pending = await ctx.db.crewStatusRequest.findFirst({
      where: { userId: ctx.session.user.id, state: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, eligibleAt: true, createdAt: true },
    });
    return { status: me?.crewStatus ?? null, pendingRequest: pending };
  }),

  /** Request to opt out of the crew (ACTIVE members only). Starts a recall cooldown; an admin
   *  approves after it elapses, and the member can recall it meanwhile. */
  requestOptOut: protectedProcedure
    .input(z.object({ reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const me = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { crewStatus: true },
      });
      if (me?.crewStatus !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only active crew can opt out." });
      }
      const open = await ctx.db.crewStatusRequest.findFirst({
        where: { userId: ctx.session.user.id, state: "PENDING" },
        select: { id: true },
      });
      if (open) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already have a pending request." });
      }
      const eligibleAt = new Date(Date.now() + CREW_OPT_OUT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      await ctx.db.crewStatusRequest.create({
        data: {
          userId: ctx.session.user.id,
          kind: "OPT_OUT",
          eligibleAt,
          reason: input.reason?.trim() ? input.reason.trim() : null,
        },
      });
      await notifyAdmins({
        title: "Crew opt-out requested",
        body: "A crew member requested to opt out.",
        link: "/admin/crew",
      });
      return { ok: true };
    }),

  /** Recall a still-pending opt-out request (before an admin approves it). */
  recallOptOut: protectedProcedure.mutation(async ({ ctx }) => {
    const req = await ctx.db.crewStatusRequest.findFirst({
      where: { userId: ctx.session.user.id, kind: "OPT_OUT", state: "PENDING" },
      select: { id: true },
    });
    if (!req) throw new TRPCError({ code: "BAD_REQUEST", message: "No pending opt-out to recall." });
    await ctx.db.crewStatusRequest.update({ where: { id: req.id }, data: { state: "RECALLED" } });
    return { ok: true };
  }),

  /** Request reentry to the crew (OPTED_OUT members only; no cooldown). */
  requestReentry: protectedProcedure.mutation(async ({ ctx }) => {
    const me = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { crewStatus: true },
    });
    if (me?.crewStatus !== "OPTED_OUT") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only opted-out crew can request reentry." });
    }
    const open = await ctx.db.crewStatusRequest.findFirst({
      where: { userId: ctx.session.user.id, state: "PENDING" },
      select: { id: true },
    });
    if (open) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You already have a pending request." });
    }
    await ctx.db.crewStatusRequest.create({
      data: { userId: ctx.session.user.id, kind: "REENTRY" },
    });
    await notifyAdmins({
      title: "Crew reentry requested",
      body: "A crew member requested to rejoin.",
      link: "/admin/crew",
    });
    return { ok: true };
  }),
});
