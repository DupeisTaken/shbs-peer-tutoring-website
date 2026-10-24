import { TRPCError } from "@trpc/server";
import { accountHistoryIds } from "./account-history";
import type { DomainDb } from "./transactions";

/** A revoked tutor capability does not erase an explicit identity link. Read only personal
 * evidence here; no email matching, profile synchronization or meeting recalculation occurs. */
export async function ownedTutorHistory(db: DomainDb, userId: string) {
  const ownerIds = await accountHistoryIds(db, userId);
  const records = await db.tutor.findMany({
    where: {
      OR: [
        { user: { id: { in: ownerIds } } },
        { retainedOwner: { userId: { in: ownerIds } } },
      ],
    },
    select: { id: true, englishName: true },
    orderBy: { id: "asc" },
  });
  if (!records.length) return [];
  const where = { tutorId: { in: records.map((record) => record.id) } };
  // Aggregate stored evidence once for the owned set. Never infer identity from a
  // name, or recalculate recorded credit from duration/current program settings.
  const [sessions, meetings, amendments, periods] = await Promise.all([
    db.session.groupBy({
      by: ["tutorId"],
      where,
      _count: { _all: true },
      _sum: { shCount: true },
      _min: { date: true },
      _max: { date: true },
    }),
    db.meetingAttendance.groupBy({
      by: ["tutorId"],
      where,
      _count: { _all: true },
    }),
    db.serviceHourAdjustment.groupBy({
      by: ["tutorId"],
      where,
      _count: { _all: true },
    }),
    db.session.groupBy({
      by: ["tutorId", "schoolYear", "quarter"],
      where,
      orderBy: [{ schoolYear: "desc" }, { quarter: "desc" }],
    }),
  ]);
  const sessionsById = new Map(sessions.map((row) => [row.tutorId, row]));
  const meetingsById = new Map(
    meetings.map((row) => [row.tutorId, row._count._all]),
  );
  const amendmentsById = new Map(
    amendments.map((row) => [row.tutorId, row._count._all]),
  );
  return records.map((record) => {
    const summary = sessionsById.get(record.id);
    return {
      ...record,
      sessionCount: summary?._count._all ?? 0,
      meetingCount: meetingsById.get(record.id) ?? 0,
      amendmentCount: amendmentsById.get(record.id) ?? 0,
      firstSessionDate: summary?._min.date ?? null,
      lastSessionDate: summary?._max.date ?? null,
      storedSessionHours: summary?._sum.shCount ?? 0,
      periods: periods
        .filter((row) => row.tutorId === record.id)
        .map((row) => `${row.schoolYear} ${row.quarter}`),
    };
  });
}
export async function personalTutorHistory(
  db: DomainDb,
  userId: string,
  tutorId: string,
  page: number,
  meetingPage = page,
  amendmentPage = page,
) {
  const ownerIds = await accountHistoryIds(db, userId);
  // Detail authorization uses the exact record; it does not load every summary.
  const record = await db.tutor.findFirst({
    where: {
      id: tutorId,
      OR: [
        { user: { id: { in: ownerIds } } },
        { retainedOwner: { userId: { in: ownerIds } } },
      ],
    },
    select: { id: true, englishName: true },
  });
  if (!record)
    throw new TRPCError({ code: "NOT_FOUND", message: "HISTORY_NOT_FOUND" });
  const where = { tutorId };
  const pagination = { skip: page * 50, take: 50 };
  const [
    sessions,
    meetings,
    amendments,
    sessionSummary,
    meetingCount,
    amendmentCount,
    periods,
  ] = await Promise.all([
    db.session.findMany({
      where,
      ...pagination,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      select: {
        id: true,
        date: true,
        schoolYear: true,
        quarter: true,
        startMin: true,
        endMin: true,
        shCount: true,
        tutorStatus: true,
        pairing: { select: { subject: true } },
      },
    }),
    db.meetingAttendance.findMany({
      where,
      skip: meetingPage * 50,
      take: 50,
      orderBy: [{ meeting: { date: "desc" } }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        meeting: { select: { title: true, date: true } },
      },
    }),
    db.serviceHourAdjustment.findMany({
      where,
      skip: amendmentPage * 50,
      take: 50,
      orderBy: [{ schoolYear: "desc" }, { quarter: "desc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        amount: true,
        reason: true,
        schoolYear: true,
        quarter: true,
      },
    }),
    db.session.aggregate({
      where,
      _count: { _all: true },
      _min: { date: true },
      _max: { date: true },
    }),
    db.meetingAttendance.count({ where }),
    db.serviceHourAdjustment.count({ where }),
    db.session.groupBy({
      by: ["schoolYear", "quarter"],
      where,
      orderBy: [{ schoolYear: "desc" }, { quarter: "desc" }],
    }),
  ]);
  const sessionCount = sessionSummary._count._all;
  return {
    record,
    // Detail refreshes must update metadata alongside the evidence rows.
    periods: periods.map((row) => `${row.schoolYear} ${row.quarter}`),
    firstSessionDate: sessionSummary._min.date,
    lastSessionDate: sessionSummary._max.date,
    counts: {
      sessions: sessionCount,
      meetings: meetingCount,
      amendments: amendmentCount,
    },
    sessions,
    meetings,
    amendments,
    sessionMore: sessionCount > (page + 1) * 50,
    meetingMore: meetingCount > (meetingPage + 1) * 50,
    amendmentMore: amendmentCount > (amendmentPage + 1) * 50,
    more:
      Math.max(sessionCount, meetingCount, amendmentCount) > (page + 1) * 50,
  };
}
