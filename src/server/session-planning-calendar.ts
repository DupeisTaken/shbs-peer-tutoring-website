import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  renderSessionCalendar,
  type SessionCalendarEvent,
} from "~/lib/session-calendar";
import { portalAccess } from "~/lib/portal-access";
import { emailOrigin } from "~/server/email/urls";
import { ownedStudentIds } from "~/server/student-ownership";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const forbidden = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "A current participant account is required.",
  });

async function calendarAudience(database: DomainDb, userId: string) {
  const user = await database.user.findUnique({
    where: { id: userId },
    include: { schoolDeparture: true, tutor: { select: { status: true } } },
  });
  if (!user || !portalAccess(user).canParticipate) return null;
  const tutorId =
    user.tutorId && !user.tutorAccessRevoked && user.tutor?.status === "ACTIVE"
      ? user.tutorId
      : null;
  const owned = user.tuteeMember ? await ownedStudentIds(database, userId) : [];
  const students = owned.length
    ? await database.tutee.findMany({
        // A released continuation remains a pending participant. Its existing private
        // calendar must receive cancellation tombstones instead of retaining old events.
        where: { id: { in: owned }, status: { in: ["ACTIVE", "PENDING"] } },
        select: { id: true },
      })
    : [];
  const tuteeIds = students.map((student) => student.id);
  return tutorId || tuteeIds.length ? { tutorId, tuteeIds } : null;
}

/** Tokens are account capabilities with no write authority. Plaintext is returned once;
 * a lost URL is recovered by rotation, never by retaining a retrievable credential. */
export async function rotateSessionCalendarToken(
  database: DomainDb,
  userId: string,
) {
  const origin = emailOrigin();
  return inTransaction(database, async (tx) => {
    await lockEntity(tx, `session-calendar:${userId}`);
    if (!(await calendarAudience(tx, userId))) throw forbidden();
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await tx.sessionCalendarToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    const created = await tx.sessionCalendarToken.create({
      data: { userId, tokenHash: hashToken(token) },
    });
    await tx.auditLog.create({
      data: {
        userId,
        operation: "sessionPlanning.rotateCalendar",
        entity: "SessionCalendarToken",
        action: "Rotated private tutoring calendar subscription",
        details: { createdAt: created.createdAt.toISOString() },
      },
    });
    return {
      url: `${origin}/api/session-calendar/${token}`,
      createdAt: created.createdAt,
    };
  });
}

export async function revokeSessionCalendarTokens(
  database: DomainDb,
  userId: string,
) {
  return inTransaction(database, async (tx) => {
    await lockEntity(tx, `session-calendar:${userId}`);
    // A signed-in owner can revoke even after participant access has ended.
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, mergedIntoId: true },
    });
    if (!user || user.mergedIntoId) throw forbidden();
    const result = await tx.sessionCalendarToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        userId,
        operation: "sessionPlanning.revokeCalendar",
        entity: "SessionCalendarToken",
        action: "Revoked private tutoring calendar subscriptions",
        details: { revoked: result.count },
      },
    });
    return { revoked: result.count };
  });
}

export async function sessionCalendarStatus(
  database: DomainDb,
  userId: string,
) {
  const token = await database.sessionCalendarToken.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return {
    active: !!token,
    createdAt: token?.createdAt ?? null,
    available: !!(await calendarAudience(database, userId)),
  };
}

/** Fetch is read-only. It never publishes plans, settles proposals or submits consent.
 * Every request rechecks live account and participant ownership, even for a valid token. */
export async function sessionCalendarFeed(
  database: DomainDb,
  token: string,
  now = new Date(),
): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const observed = await database.sessionCalendarToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { userId: true },
  });
  if (!observed) return null;
  return inTransaction(database, async (tx) => {
    await lockEntity(tx, `session-calendar:${observed.userId}`);
    const capability = await tx.sessionCalendarToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!capability || capability.revokedAt) return null;
    const audience = await calendarAudience(tx, capability.userId);
    if (!audience) return null;
    // Keep recent cancellations long enough for slow subscription refresh. Do not
    // truncate a large feed silently: dropping events can erase cached commitments.
    const since = new Date(now.getTime() - 120 * 86_400_000);
    const cohorts = audience.tutorId
      ? await tx.sessionPlanCohort.findMany({
          where: {
            plan: { tutorId: audience.tutorId },
            status: { in: ["SCHEDULED", "RECORDED", "CANCELLED"] },
            OR: [
              { startsAt: { gte: since } },
              { status: "CANCELLED", updatedAt: { gte: since } },
            ],
          },
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          take: 5001,
        })
      : [];
    const participants = audience.tuteeIds.length
      ? await tx.sessionPlanParticipant.findMany({
          where: {
            tuteeId: { in: audience.tuteeIds },
            status: { in: ["SCHEDULED", "CANCELLED"] },
            cohort: {
              OR: [
                { startsAt: { gte: since } },
                { status: "CANCELLED", updatedAt: { gte: since } },
              ],
            },
          },
          include: { cohort: true },
          orderBy: { id: "asc" },
          take: 5001,
        })
      : [];
    if (cohorts.length > 5000 || participants.length > 5000)
      throw new Error("Calendar feed exceeds the bounded publication limit.");
    const roomIds = [
      ...new Set(
        [
          ...cohorts.map((cohort) => cohort.roomId),
          ...participants.map((participant) => participant.cohort?.roomId),
        ].filter((id): id is string => !!id),
      ),
    ];
    const rooms = roomIds.length
      ? await tx.room.findMany({
          where: { id: { in: roomIds } },
          select: { id: true, name: true },
        })
      : [];
    const locations = new Map(rooms.map((room) => [room.id, room.name]));
    const events: SessionCalendarEvent[] = cohorts.map((cohort) => ({
      uid: `cohort-${cohort.id}@shbs-session`,
      revision: cohort.version,
      startsAt: cohort.startsAt,
      endsAt: cohort.endsAt,
      updatedAt: cohort.updatedAt,
      cancelled: cohort.status === "CANCELLED",
      location: cohort.online
        ? "Online / 线上"
        : locations.get(cohort.roomId ?? ""),
    }));
    for (const participant of participants) {
      const cohort = participant.cohort;
      if (
        !cohort ||
        !["SCHEDULED", "RECORDED", "CANCELLED"].includes(cohort.status)
      )
        continue;
      events.push({
        uid: `commitment-${participant.id}@shbs-session`,
        revision: participant.version,
        startsAt: cohort.startsAt,
        endsAt: cohort.endsAt,
        updatedAt: new Date(
          Math.max(participant.updatedAt.getTime(), cohort.updatedAt.getTime()),
        ),
        cancelled:
          participant.status === "CANCELLED" || cohort.status === "CANCELLED",
        location: cohort.online
          ? "Online / 线上"
          : locations.get(cohort.roomId ?? ""),
      });
    }
    return renderSessionCalendar(events);
  });
}
