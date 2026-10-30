import { createHash } from "node:crypto";
import {
  isSchoolCalendarNotification,
  notificationEvent,
  schoolCalendarNotificationEvents,
  type NotificationEvent,
} from "~/lib/notification-events";
import { programDateKey, programDateTimeInput } from "~/lib/program-time";
import { resolveSchoolCalendarDay } from "~/lib/school-calendar";
import { notificationData } from "./notifications/create";
import { getSchoolCalendarDatedSessionUserIds } from "./school-calendar-session-audience";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";

export type SchoolCalendarNotificationSource = {
  date: string;
  isSchoolDay: boolean;
  timetableWeekday: number | null;
  active: boolean;
  version: number;
  scheduleRevision: number;
};
type CalendarPhase = "changed" | "reset" | "upcoming";
const events = [...schoolCalendarNotificationEvents];
const dateFilter = (date: string) => ({ path: ["schoolDate"], equals: date });

export function schoolCalendarNotificationId(
  date: string,
  revision: number,
  phase: CalendarPhase,
  userId: string,
) {
  // Stable user-scoped IDs make retries and concurrent createMany sweeps harmless;
  // no address or participant identifier is exposed through the delivery context.
  return `school-calendar:${date}:${revision}:${phase}:${createHash("sha256").update(userId).digest("hex")}`;
}

function resolved(source: SchoolCalendarNotificationSource) {
  return resolveSchoolCalendarDay(source.date, [source]);
}
function weekdays(...sources: (SchoolCalendarNotificationSource | null)[]) {
  const dates = sources.filter((s) => s !== null);
  const days = dates.flatMap((source) => {
    const civil = new Date(`${source.date}T00:00:00Z`).getUTCDay() || 7;
    const mapped = resolved(source).effectiveTimetableWeekday;
    return mapped === null ? [civil] : [civil, mapped];
  });
  return [...new Set(days)];
}

/** Only canonical, eligible linked identities are contacted. Prior recipients remain
 * eligible for corrections even if their pairing changed after the earlier notice. */
async function eligibleUsers(tx: TransactionDb, userIds: string[]) {
  if (!userIds.length) return [];
  const users = await tx.user.findMany({
    where: {
      id: { in: [...new Set(userIds)] },
      role: { not: "VIEWER" },
      suspendedAt: null,
      mergedIntoId: null,
      OR: [
        { schoolDeparture: { is: null } },
        { schoolDeparture: { is: { reason: null } } },
      ],
    },
    select: {
      id: true,
      tutorId: true,
      studentId: true,
      tutorAccessRevoked: true,
      tuteeMember: true,
      tutor: { select: { status: true } },
      student: { select: { status: true } },
    },
  });
  const ownerships = await tx.studentProfileOwnership.findMany({
    where: { userId: { in: users.map((user) => user.id) } },
    select: { userId: true, tuteeId: true },
  });
  const activeStudents = await tx.tutee.findMany({
    where: {
      id: { in: ownerships.map((owner) => owner.tuteeId) },
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const activeIds = new Set(activeStudents.map((student) => student.id));
  const retainedOwners = new Set(
    ownerships
      .filter((owner) => activeIds.has(owner.tuteeId))
      .map((owner) => owner.userId),
  );
  return users.filter(
    (user) =>
      (!user.tutorAccessRevoked && user.tutor?.status === "ACTIVE") ||
      (user.tuteeMember &&
        (user.student?.status === "ACTIVE" || retainedOwners.has(user.id))),
  );
}

export async function schoolCalendarAudience(
  tx: TransactionDb,
  date: string,
  affectedWeekdays: number[],
  priorUserIds: string[] = [],
  now = new Date(),
) {
  const pairings = await tx.pairing.findMany({
    where: {
      term: { active: true },
      scheduleConfirmed: true,
      dayOfWeek: { in: affectedWeekdays },
      tutor: { status: "ACTIVE" },
      tutees: { some: { tutee: { status: "ACTIVE" } } },
    },
    select: {
      tutorId: true,
      tutees: {
        where: { tutee: { status: "ACTIVE" } },
        select: { tuteeId: true },
      },
    },
  });
  const tuteeIds = [
    ...new Set(
      pairings.flatMap((pairing) => pairing.tutees.map((link) => link.tuteeId)),
    ),
  ];
  const [linked, owners, dated] = await Promise.all([
    tx.user.findMany({
      where: {
        OR: [
          { tutorId: { in: pairings.map((pairing) => pairing.tutorId) } },
          { studentId: { in: tuteeIds } },
        ],
      },
      select: { id: true },
    }),
    tx.studentProfileOwnership.findMany({
      where: { tuteeId: { in: tuteeIds } },
      select: { userId: true },
    }),
    getSchoolCalendarDatedSessionUserIds(tx, date, now),
  ]);
  return eligibleUsers(tx, [
    ...linked.map((user) => user.id),
    ...owners.map((owner) => owner.userId),
    ...dated,
    ...priorUserIds,
  ]);
}

async function createNotices(
  tx: TransactionDb,
  source: SchoolCalendarNotificationSource,
  phase: CalendarPhase,
  users: Awaited<ReturnType<typeof eligibleUsers>>,
  timeZone: string,
  now: Date,
) {
  if (!users.length) return;
  const state = resolved(source);
  const event: NotificationEvent = `school_calendar_${phase}`;
  // Both callers hold the source date lock. Account combination reparents real
  // receipts without changing their original IDs, so check semantic ownership
  // before relying on the deterministic ID for a new recipient identity.
  const existing = await tx.notification.findMany({
    where: {
      userId: { in: users.map((user) => user.id) },
      event,
      AND: [
        { context: dateFilter(source.date) },
        {
          context: {
            path: ["calendarRevision"],
            equals: source.scheduleRevision,
          },
        },
      ],
    },
    select: { userId: true },
  });
  const notified = new Set(existing.map((row) => row.userId));
  const recipients = users.filter((user) => !notified.has(user.id));
  if (!recipients.length) return;
  const data = notificationData(event, {
    schoolDate: source.date,
    isSchoolDay: state.isSchoolDay,
    timetableWeekday: state.effectiveTimetableWeekday,
    calendarRevision: source.scheduleRevision,
    timeZone,
  });
  await tx.notification.createMany({
    skipDuplicates: true,
    data: recipients.map((user) => ({
      id: schoolCalendarNotificationId(
        source.date,
        source.scheduleRevision,
        phase,
        user.id,
      ),
      userId: user.id,
      createdAt: now,
      ...data,
      link:
        user.tutorId &&
        !user.tutorAccessRevoked &&
        user.tutor?.status === "ACTIVE"
          ? `/dashboard#school-calendar/${source.date}`
          : `/student#school-calendar/${source.date}`,
    })),
  });
}

/** Runs inside the source's locked write transaction: no mail is sent here. */
export async function notifySchoolCalendarChange(
  tx: TransactionDb,
  change: {
    before: SchoolCalendarNotificationSource | null;
    after: SchoolCalendarNotificationSource;
  },
  now = new Date(),
) {
  const { before, after } = change;
  const settings = await tx.programSettings.findUnique({
    where: { id: "program" },
    select: { timeZone: true },
  });
  const timeZone = settings?.timeZone ?? "Asia/Shanghai";
  // Invalidate obsolete mail only. Existing in-app/sent rows remain timestamped evidence.
  await tx.emailDelivery.updateMany({
    where: {
      event: { in: events },
      status: { in: ["PENDING", "FAILED"] },
      AND: [
        { context: dateFilter(after.date) },
        {
          NOT: {
            context: {
              path: ["calendarRevision"],
              equals: after.scheduleRevision,
            },
          },
        },
      ],
    },
    data: { status: "SKIPPED", completedAt: now, leaseUntil: null },
  });
  if (after.date < programDateKey(now, timeZone)) return;
  const previous = await tx.notification.findMany({
    where: { event: { in: events }, context: dateFilter(after.date) },
    select: { userId: true },
  });
  const users = await schoolCalendarAudience(
    tx,
    after.date,
    weekdays(before, after),
    previous.map((row) => row.userId),
    now,
  );
  await createNotices(
    tx,
    after,
    after.active ? "changed" : "reset",
    users,
    timeZone,
    now,
  );
}

/** Prior day 18:00 through actual day 12:00, using school wall time rather than
 * subtracting 24 hours across DST. Later same-day edits still notify immediately. */
export function schoolCalendarReminderDue(
  date: string,
  now: Date,
  timeZone: string,
) {
  const wall = programDateTimeInput(now, timeZone);
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return (
    wall >= `${previous.toISOString().slice(0, 10)}T18:00` &&
    wall < `${date}T12:00`
  );
}

export async function remindUpcomingSchoolCalendar(
  db: DomainDb,
  now = new Date(),
) {
  const settings = await db.programSettings.findUnique({
    where: { id: "program" },
    select: { timeZone: true },
  });
  const timeZone = settings?.timeZone ?? "Asia/Shanghai";
  const today = programDateKey(now, timeZone);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const rows = await db.schoolCalendarDay.findMany({
    where: {
      active: true,
      date: { in: [today, tomorrow.toISOString().slice(0, 10)] },
    },
    orderBy: { date: "asc" },
  });
  for (const candidate of rows) {
    await inTransaction(db, async (tx) => {
      await lockEntity(tx, `school-calendar:${candidate.date}`);
      const source = await tx.schoolCalendarDay.findUnique({
        where: { date: candidate.date },
      });
      if (
        !source?.active ||
        !schoolCalendarReminderDue(source.date, now, timeZone)
      )
        return;
      const prior = await tx.notification.findMany({
        where: {
          event: "school_calendar_changed",
          AND: [
            { context: dateFilter(source.date) },
            {
              context: {
                path: ["calendarRevision"],
                equals: source.scheduleRevision,
              },
            },
          ],
        },
        select: { userId: true, createdAt: true },
      });
      const users = await schoolCalendarAudience(
        tx,
        source.date,
        weekdays(source),
        prior.map((row) => row.userId),
        now,
      );
      // A newly applied change inside this same advance window already is the
      // participant's reminder. Keep its real receipt and avoid a second phase;
      // earlier announcements still receive their distinct advance reminder.
      const recentlyAnnounced = new Set(
        prior
          .filter(
            (row) =>
              row.createdAt <= now &&
              schoolCalendarReminderDue(source.date, row.createdAt, timeZone),
          )
          .map((row) => row.userId),
      );
      await createNotices(
        tx,
        source,
        "upcoming",
        users.filter((user) => !recentlyAnnounced.has(user.id)),
        timeZone,
        now,
      );
    });
  }
}

/** Ordinary optional-mail delivery must recheck the source and linked identities;
 * a calendar edit after admission cannot recall already accepted SMTP transport. */
export async function schoolCalendarEmailEligible(
  db: DomainDb,
  row: { event: string; context: unknown; userId: string | null },
  now = new Date(),
) {
  if (!isSchoolCalendarNotification(row.event)) return true;
  const context = notificationEvent(
    row.event as NotificationEvent,
    row.context,
  ).context;
  if (!row.userId || typeof context.schoolDate !== "string") return false;
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `school-calendar:${context.schoolDate}`);
    const source = await tx.schoolCalendarDay.findUnique({
      where: { date: context.schoolDate as string },
    });
    if (
      !source ||
      source.scheduleRevision !== context.calendarRevision ||
      (row.event === "school_calendar_reset" ? source.active : !source.active)
    )
      return false;
    const state = resolved(source);
    if (
      state.isSchoolDay !== context.isSchoolDay ||
      state.effectiveTimetableWeekday !== context.timetableWeekday
    )
      return false;
    const settings = await tx.programSettings.findUnique({
      where: { id: "program" },
      select: { timeZone: true },
    });
    const timeZone = settings?.timeZone ?? "Asia/Shanghai";
    if (source.date < programDateKey(now, timeZone)) return false;
    if (
      row.event === "school_calendar_upcoming" &&
      !schoolCalendarReminderDue(source.date, now, timeZone)
    )
      return false;
    return (await eligibleUsers(tx, [row.userId!])).length === 1;
  });
}
