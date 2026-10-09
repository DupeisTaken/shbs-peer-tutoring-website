import { accountHistoryIds } from "~/server/account-history";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { programDateKey } from "~/lib/program-time";
import { requestMembership, recallMembership } from "~/server/membership";
import { createHash } from "node:crypto";
import { inTransaction, lockEntity } from "~/server/transactions";
import { lockAttendanceSchedule } from "~/server/attendance-schedule";
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
import { assertObservedTimes } from "~/server/crew/observation-time";
import { eligiblePatrolCredit, lockPatrolCreditOwner, reservePatrolEvidence, PATROL_HOURS } from "~/server/crew/patrol-credit";
import { captchaGrantInput } from "~/lib/captcha";
import { withProtectedSignup } from "~/server/captcha";
import { withSignupAdmission, signupMetric } from "~/server/signup-admission";
import {
  crewApplicationInput,
  stageCrewVerification,
  verifyCrewApplication,
  crewApplicationStatus,
} from "~/server/crew/signup";

/** Service hours credited per completed patrol (policy). */
export { PATROL_HOURS } from "~/server/crew/patrol-credit";

/** Recall window before a crew opt-out becomes admin-approvable (mirrors the tutor opt-out). */
export const CREW_OPT_OUT_COOLDOWN_DAYS = 7;

const HEADCOUNTS = ["ZERO", "ONE", "TWO", "THREE", "FOUR_PLUS"] as const;

async function crewMail<T>(work: () => Promise<T>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof TRPCError) throw error;
    signupMetric("delivery-failed");
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "SIGNUP_MAIL_FAILED" });
  }
}

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
        where: { crewUserId: { in: await accountHistoryIds(ctx.db, ctx.session.user.id) } },
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
  myPatrols: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.patrol.findMany({
      where: { crewUserId: { in: await accountHistoryIds(ctx.db, ctx.session.user.id) } },
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
   * up to 0.5h subject to the shared credit budget, then reconciles sessions against evidence (under-counts
   * raise a SessionFlag for admins). At least one observation is required.
   */
  submitPatrol: crewProcedure
    .input(
      z.object({
        submissionKey: z.string().uuid(),
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
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockAttendanceSchedule(tx);
        const ownerIds = await lockPatrolCreditOwner(tx, ctx.session.user.id);
        await lockEntity(tx, `patrol-submit:${input.submissionKey}`);
        const payloadHash = createHash("sha256")
          .update(
            JSON.stringify({
              ...input,
              observations: [...input.observations].sort((a, b) =>
                a.roomId.localeCompare(b.roomId),
              ),
            }),
          )
          .digest("hex");
        const previous = await tx.patrol.findUnique({
          where: { submissionKey: input.submissionKey },
        });
        if (previous) {
          if (
            previous.crewUserId !== ctx.session.user.id ||
            previous.submissionPayloadHash !== payloadHash
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "That patrol submission already exists with different observations.",
            });
          return { ok: true, id: previous.id, hours: previous.hours };
        }
        if (
          new Set(input.observations.map((o) => o.roomId)).size !==
          input.observations.length
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Record each room once per patrol.",
          });
        const active = await getActivePeriodOrNull(tx);
        const now = new Date();
        assertObservedTimes(input.observations, now);
        const observations = input.observations.map((o) => ({ ...o, observedAt: o.observedAt ?? now }));
        const credited = await eligiblePatrolCredit(tx, ownerIds, observations, now);
        const hours = credited ? PATROL_HOURS : 0;
        const patrol = await tx.patrol.create({
          data: {
            submissionKey: input.submissionKey,
            submissionPayloadHash: payloadHash,
            crewUserId: ctx.session.user.id,
            termId: active?.termId ?? null,
            hours,
            creditAwardedAt: credited ? now : null,
            note: input.note?.trim() ? input.note.trim() : null,
            observations: {
              create: observations.map((o) => ({
                roomId: o.roomId,
                headcount: o.headcount,
                observedAt: o.observedAt,
              })),
            },
          },
          select: { id: true },
        });
        if (credited)
          await reservePatrolEvidence(tx, { id: patrol.id, crewUserId: ctx.session.user.id }, observations);

        // Reconcile the sessions in the patrolled rooms around the observed times.
        const roomIds = [...new Set(input.observations.map((o) => o.roomId))];
        const timeZone = await getProgramTimeZone(tx);
        const dates = input.observations.map((o) =>
          Date.parse(
            programDateKey(o.observedAt ?? now, timeZone) + "T00:00:00Z",
          ),
        );
        const dayStart = new Date(Math.min(...dates));
        const dayEnd = new Date(Math.max(...dates));
        const sessions = await tx.session.findMany({
          where: {
            actualRoomId: { in: roomIds },
            online: false,
            date: { gte: dayStart, lte: dayEnd },
          },
          select: { id: true },
        });
        for (const s of sessions) await syncSessionFlag(tx, s.id);

        return { ok: true, id: patrol.id, hours };
      }),
    ),

  /** Stage a draft and mailbox challenge; unverified drafts never enter the review queue. */
  submitApplication: publicProcedure
    .input(crewApplicationInput.extend({ captchaGrant: captchaGrantInput }))
    .mutation(async ({ ctx, input }) =>
      withProtectedSignup(ctx.db, ctx.headers, "crew.submit", input.email, input.captchaGrant,
        () => crewMail(() => stageCrewVerification(ctx.db, input.email, input))),
    ),

  /** Generic mail response, including absent applications. Explicit resends preserve
   * the current draft; an initial status lookup never submits an unverified draft. */
  requestStatus: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(254), captchaGrant: captchaGrantInput, resend: z.boolean().optional() }))
    .mutation(({ ctx, input }) => withProtectedSignup(
      ctx.db, ctx.headers, "crew.status", input.email, input.captchaGrant,
      () => crewMail(() => stageCrewVerification(ctx.db, input.email, undefined, input.resend)),
    )),

  verifyApplication: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(254), code: z.string().min(1).max(30) }))
    .mutation(({ ctx, input }) => withSignupAdmission(
      ctx.db, ctx.headers, "complete", input.email,
      () => verifyCrewApplication(ctx.db, input, ctx.headers),
    )),

  /** Mutation because the proved explicit refresh can recover the recipient receipt. */
  applicationStatus: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(254), statusProof: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(({ ctx, input }) => withSignupAdmission(
      ctx.db, ctx.headers, "read", input.email,
      () => crewApplicationStatus(ctx.db, input),
    )),

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
    .mutation(({ ctx, input }) =>
      requestMembership(
        ctx.db,
        { kind: "crew", id: ctx.session.user.id },
        "OPT_OUT",
        input.reason,
      ),
    ),

  /** Recall a still-pending opt-out request (before an admin approves it). */
  recallOptOut: protectedProcedure.mutation(({ ctx }) =>
    recallMembership(ctx.db, { kind: "crew", id: ctx.session.user.id }),
  ),

  /** Request reentry to the crew (OPTED_OUT members only; no cooldown). */
  requestReentry: protectedProcedure.mutation(({ ctx }) =>
    requestMembership(
      ctx.db,
      { kind: "crew", id: ctx.session.user.id },
      "REENTRY",
    ),
  ),
});
