import { TRPCError } from "@trpc/server";
import { accountHistoryIds } from "./account-history";
import type { DomainDb } from "./transactions";

/** A revoked tutor capability does not erase an explicit identity link. Read only personal
 * evidence here; no email matching, profile synchronization or meeting recalculation occurs. */
export async function ownedTutorHistory(db: DomainDb, userId: string) {
  return db.tutor.findMany({
    where: { user: { id: { in: await accountHistoryIds(db, userId) } } },
    select: { id: true, englishName: true },
    orderBy: { id: "asc" },
  });
}
export async function personalTutorHistory(
  db: DomainDb,
  userId: string,
  tutorId: string,
  page: number,
) {
  if (!(await ownedTutorHistory(db, userId)).some((row) => row.id === tutorId))
    throw new TRPCError({ code: "NOT_FOUND", message: "HISTORY_NOT_FOUND" });
  const where = { tutorId };
  const pagination = { skip: page * 50, take: 50 };
  const [
    sessions,
    meetings,
    amendments,
    sessionCount,
    meetingCount,
    amendmentCount,
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
      ...pagination,
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        meeting: { select: { title: true, date: true } },
      },
    }),
    db.serviceHourAdjustment.findMany({
      where,
      ...pagination,
      orderBy: { id: "asc" },
      select: {
        id: true,
        type: true,
        amount: true,
        reason: true,
        schoolYear: true,
        quarter: true,
      },
    }),
    db.session.count({ where }),
    db.meetingAttendance.count({ where }),
    db.serviceHourAdjustment.count({ where }),
  ]);
  return {
    sessions,
    meetings,
    amendments,
    more:
      Math.max(sessionCount, meetingCount, amendmentCount) > (page + 1) * 50,
  };
}
