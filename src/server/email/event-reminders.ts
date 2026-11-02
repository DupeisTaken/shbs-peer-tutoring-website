import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "../../../generated/prisma";
import { db } from "~/server/db";
import type { DomainDb } from "~/server/transactions";
import {
  parseProgramDateTime,
  programDateKey,
  programDateTimeInput,
} from "~/lib/program-time";
import { portalAccess } from "~/lib/portal-access";
import { effectiveNotificationPreference } from "~/lib/notification-categories";
import { getFeatures } from "~/server/program/features";

export const REMINDER_LEADS = [1440, 60] as const;
export const REMINDER_LATE_MS = 10 * 60_000;
const PAGE_SIZE = 100;
const kinds = ["interview", "meeting", "tutoring", "tutoring_group"] as const;
type Kind = (typeof kinds)[number];
const contextSchema = z.object({
  kind: z.enum(kinds),
  sourceId: z.string().min(1),
  startsAt: z.iso.datetime(),
  timeZone: z.string(),
  leadMinutes: z.union([z.literal(1440), z.literal(60)]),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  emailDetail: z.object({
    en: z.string().min(1).max(1000),
    zh: z.string().min(1).max(1000),
  }),
});
type ReminderContext = z.infer<typeof contextSchema>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const safeLabel = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 160);
const eventFor = (kind: Kind) =>
  kind === "interview"
    ? "interview_upcoming"
    : kind === "meeting"
      ? "meeting_upcoming"
      : "tutoring_upcoming";

/** A missed threshold gets a short bounded grace period, never a catch-up burst. */
export function reminderIsDue(startsAt: Date, leadMinutes: number, now: Date) {
  const due = startsAt.getTime() - leadMinutes * 60_000;
  return (
    startsAt > now &&
    now.getTime() >= due &&
    now.getTime() <= due + REMINDER_LATE_MS
  );
}

export function reminderKey(
  context: Pick<
    ReminderContext,
    "kind" | "sourceId" | "startsAt" | "leadMinutes"
  >,
  userId: string,
  recipient: string,
) {
  // The same occurrence remains one reminder even if unrelated metadata changes.
  return hash([
    context.kind,
    context.sourceId,
    context.startsAt,
    context.leadMinutes,
    userId,
    recipient,
  ]);
}

const accountInclude = {
  emails: true,
  notificationPreferences: { where: { category: "reminders" } },
  schoolDeparture: true,
  tutor: { select: { status: true } },
} satisfies Prisma.UserInclude;
type Account = Prisma.UserGetPayload<{ include: typeof accountInclude }>;
const accountWhere = {
  AND: [{ OR: [
    { notificationPreferences: { some: { category: "reminders", emailEnabled: true } } },
    { emailEventReminders: true, notificationPreferences: { none: { category: "reminders" } } },
  ] }],
  suspendedAt: null,
  mergedIntoId: null,
  role: { not: "VIEWER" },
  OR: [{ schoolDeparture: null }, { schoolDeparture: { reason: null } }],
} satisfies Prisma.UserWhereInput;
const activeTutor = {
  tutorAccessRevoked: false,
  tutor: { status: "ACTIVE" },
} satisfies Prisma.UserWhereInput;

function addresses(user: Account) {
  if (!effectiveNotificationPreference(user, "reminders", user.notificationPreferences).emailEnabled || !portalAccess(user).canParticipate)
    return [];
  return user.emails
    .filter(
      (address) =>
        address.verifiedAt &&
        (address.email === user.email || user.emailSecondaryRecipients),
    )
    .map((address) => address.email);
}

type Occurrence = {
  fingerprint: string;
  userWhere: Prisma.UserWhereInput;
  label: string;
  labelZh?: string;
  tutorId?: string;
  tutorDetail?: { en: string; zh: string };
};

async function tutoringAllowed(
  client: DomainDb,
  startsAt: Date,
  timeZone: string,
) {
  const date = programDateKey(startsAt, timeZone);
  const day = await client.schoolCalendarDay.findUnique({
    where: { date },
    select: { isSchoolDay: true },
  });
  if (day?.isSchoolDay === false) return false;
  // These notices suppress reminder email only; attendance/appeal policy is unchanged.
  return !(await client.programCalendarDay.count({
    where: { active: true, date: { lte: date }, endDate: { gte: date } },
  }));
}

/** Derive a future occurrence from current authoritative records, never Session
 * attendance. This same resolver runs before queuing and immediately before mail. */
async function occurrence(
  client: DomainDb,
  kind: Kind,
  sourceId: string,
  startsAt: Date,
  timeZone: string,
): Promise<Occurrence | null> {
  if (kind === "interview" || kind === "meeting") {
    const features = await getFeatures(client);
    if (!(kind === "interview" ? features.INTERVIEWS : features.MEETINGS))
      return null;
  }
  if (kind === "interview") {
    const row = await client.tutorApplication.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        name: true,
        status: true,
        interviewAt: true,
        invalidatedAt: true,
        interviewCompletedAt: true,
        requestedTutorId: true,
        interviewers: { select: { tutorId: true } },
      },
    });
    if (
      row?.status !== "INTERVIEW" ||
      row.invalidatedAt ||
      row.interviewCompletedAt ||
      row.interviewAt?.getTime() !== startsAt.getTime()
    )
      return null;
    const tutors = [
      ...new Set([
        ...row.interviewers.map((item) => item.tutorId),
        ...(row.requestedTutorId ? [row.requestedTutorId] : []),
      ]),
    ].sort();
    return {
      label: safeLabel(row.name),
      fingerprint: hash([
        kind,
        row.id,
        row.name,
        startsAt.toISOString(),
        timeZone,
        tutors,
      ]),
      userWhere: { ...activeTutor, tutorId: { in: tutors } },
    };
  }
  if (kind === "meeting") {
    const row = await client.tutorMeeting.findUnique({
      where: { id: sourceId },
      select: { id: true, title: true, date: true },
    });
    if (row?.date.getTime() !== startsAt.getTime()) return null;
    return {
      label: safeLabel(row.title),
      fingerprint: hash([
        kind,
        row.id,
        row.title,
        startsAt.toISOString(),
        timeZone,
      ]),
      userWhere: {
        ...activeTutor,
        tutor: {
          status: "ACTIVE",
          meetingAttendances: {
            none: { meetingId: sourceId, status: "EXCUSED_ABSENT" },
          },
        },
      },
    };
  }
  if (!(await tutoringAllowed(client, startsAt, timeZone))) return null;
  const pairings = await client.pairing.findMany({
    where:
      kind === "tutoring_group"
        ? { groupId: sourceId }
        : { id: sourceId, groupId: null },
    orderBy: { id: "asc" },
    include: {
      term: true,
      tutor: { select: { status: true, englishName: true } },
      room: { select: { name: true } },
      tutees: {
        include: {
          tutee: {
            select: {
              id: true,
              englishName: true,
              status: true,
              user: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!pairings.length) return null;
  const wall = programDateTimeInput(startsAt, timeZone);
  const date = wall.slice(0, 10);
  const calendarDay = new Date(`${date}T12:00:00Z`).getUTCDay();
  const weekday = calendarDay === 0 ? 7 : calendarDay;
  const minute = Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
  const first = pairings[0]!;
  // A malformed/partly edited group is not an authoritative shared occurrence.
  if (
    pairings.some(
      (row) =>
        !row.scheduleConfirmed ||
        !row.term.active ||
        row.tutor.status !== "ACTIVE" ||
        row.tutorId !== first.tutorId ||
        row.termId !== first.termId ||
        row.dayOfWeek !== weekday ||
        row.startMin !== minute ||
        row.endMin !== first.endMin ||
        (row.term.startDate ? startsAt < row.term.startDate : false) ||
        (row.term.endDate ? startsAt > row.term.endDate : false),
    )
  )
    return null;
  try {
    if (parseProgramDateTime(wall, timeZone).getTime() !== startsAt.getTime())
      return null;
  } catch {
    return null;
  }
  const students = [
    ...new Set(
      pairings.flatMap((row) =>
        row.tutees
          .filter((item) => item.tutee.status === "ACTIVE")
          .map((item) => item.tuteeId),
      ),
    ),
  ].sort();
  if (!students.length) return null;
  // Attendance stores the school-date label as a UTC date, not the occurrence
  // instant. Missing attendance is unknown; only explicit absence/rescheduling
  // on this assignment/date/overlapping block suppresses the whole reminder.
  const dayStart = new Date(`${date}T00:00:00Z`);
  if (
    await client.session.count({
      where: {
        pairingId: { in: pairings.map((row) => row.id) },
        tutorId: first.tutorId,
        date: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) },
        startMin: { lt: first.endMin },
        endMin: { gt: first.startMin },
        OR: [
          { tutorStatus: { in: ["TUTOR_ABSENT", "RESCHEDULED"] } },
          {
            tutees: {
              some: {
                tuteeId: { in: students },
                status: { in: ["EXCUSED_ABSENT", "UNEXCUSED_ABSENT"] },
              },
            },
          },
        ],
      },
    })
  )
    return null;
  const owners = await client.studentProfileOwnership.findMany({
    where: { tuteeId: { in: students } },
    select: { userId: true },
  });
  const currentOwners = pairings.flatMap((row) =>
    row.tutees
      .filter((item) => students.includes(item.tuteeId))
      .flatMap((item) => (item.tutee.user ? [item.tutee.user.id] : [])),
  );
  const subjects = [
    ...new Set(pairings.map((row) => safeLabel(row.subject).slice(0, 80))),
  ];
  const subjectLabel =
    subjects.slice(0, 3).join(" / ") +
    (subjects.length > 3 ? ` (+${subjects.length - 3})` : "");
  const tutorName = safeLabel(first.tutor.englishName).slice(0, 80);
  const room = first.room ? safeLabel(first.room.name).slice(0, 80) : "";
  const studentNames = [
    ...new Set(
      pairings.flatMap((row) =>
        row.tutees
          .filter((item) => students.includes(item.tuteeId))
          .map((item) => safeLabel(item.tutee.englishName).slice(0, 80)),
      ),
    ),
  ];
  const studentLabel =
    studentNames.slice(0, 3).join(", ") +
    (studentNames.length > 3 ? ` (+${studentNames.length - 3})` : "");
  const label = `Tutor ${tutorName}; ${subjectLabel}${room ? `; Room ${room}` : ""}`;
  const labelZh = `辅导伙伴 ${tutorName}；${subjectLabel}${room ? `；教室 ${room}` : ""}`;
  const tutorDetail = {
    en: `${label}; Tutees: ${studentLabel}`,
    zh: `${labelZh}；学习伙伴：${studentLabel}`,
  };
  return {
    label,
    labelZh,
    tutorId: first.tutorId,
    tutorDetail,
    fingerprint: hash([
      kind,
      sourceId,
      startsAt.toISOString(),
      timeZone,
      pairings.map((row) => [
        row.id,
        row.tutorId,
        row.termId,
        row.subject,
        row.endMin,
        row.roomId,
      ]),
      students,
      label,
      labelZh,
      tutorDetail,
    ]),
    userWhere: {
      OR: [
        { ...activeTutor, tutorId: first.tutorId },
        {
          tuteeMember: true,
          id: {
            in: [
              ...new Set([
                ...owners.map((owner) => owner.userId),
                ...currentOwners,
              ]),
            ],
          },
        },
      ],
    },
  };
}

function recipientLabel(current: Occurrence, user: Account) {
  return current.tutorDetail &&
    current.tutorId === user.tutorId &&
    !user.tutorAccessRevoked
    ? current.tutorDetail
    : { en: current.label, zh: current.labelZh ?? current.label };
}

function detail(
  kind: Kind,
  label: { en: string; zh: string },
  leadMinutes: number,
) {
  const lead =
    leadMinutes === 1440
      ? { en: "24-hour reminder", zh: "提前 24 小时提醒" }
      : { en: "1-hour reminder", zh: "提前 1 小时提醒" };
  const type =
    kind === "interview"
      ? { en: "Interview", zh: "面试" }
      : kind === "meeting"
        ? { en: "Meeting", zh: "会议" }
        : { en: "Tutoring", zh: "辅导" };
  return {
    en: `${lead.en} — ${type.en}: ${label.en}. Review the exact scheduled time below.`,
    zh: `${lead.zh} — ${type.zh}：${label.zh}。请查看下方的确切预定时间。`,
  };
}

async function enqueueOccurrence(
  client: DomainDb,
  kind: Kind,
  sourceId: string,
  startsAt: Date,
  timeZone: string,
  now: Date,
) {
  const due = REMINDER_LEADS.filter((lead) =>
    reminderIsDue(startsAt, lead, now),
  );
  if (!due.length) return 0;
  const current = await occurrence(client, kind, sourceId, startsAt, timeZone);
  if (!current) return 0;
  let cursor: string | undefined;
  let queued = 0;
  do {
    const users = await client.user.findMany({
      where: { AND: [accountWhere, current.userWhere] },
      include: accountInclude,
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const user of users) {
      const deliveries = due.flatMap((leadMinutes) => {
        const context: ReminderContext = {
          kind,
          sourceId,
          startsAt: startsAt.toISOString(),
          timeZone,
          leadMinutes,
          fingerprint: current.fingerprint,
          emailDetail: detail(kind, recipientLabel(current, user), leadMinutes),
        };
        return addresses(user).map((recipient) => ({
          userId: user.id,
          recipient,
          category: "reminder",
          preferenceTopic: "reminders",
          event: eventFor(kind),
          context,
          reminderKey: reminderKey(context, user.id, recipient),
          destination:
            kind.startsWith("tutoring") &&
            !(
              user.tutorId === current.tutorId &&
              !user.tutorAccessRevoked &&
              user.tutor?.status === "ACTIVE"
            )
              ? "/student"
              : "/dashboard",
          availableAt: now,
        }));
      });
      if (deliveries.length)
        queued += (
          await client.emailDelivery.createMany({
            data: deliveries,
            skipDuplicates: true,
          })
        ).count;
      for (const delivery of deliveries) {
        // Refresh obsolete unsent snapshots at the same occurrence, but never
        // mutate a leased/in-flight or accepted message and never resend SENT.
        queued += (
          await client.emailDelivery.updateMany({
            where: {
              reminderKey: delivery.reminderKey,
              status: { in: ["PENDING", "SKIPPED"] },
              leaseUntil: null,
              NOT: {
                context: {
                  path: ["fingerprint"],
                  equals: delivery.context.fingerprint,
                },
              },
            },
            data: {
              context: delivery.context,
              destination: delivery.destination,
              status: "PENDING",
              completedAt: null,
              availableAt: now,
              attempts: 0,
              lastError: null,
            },
          })
        ).count;
      }
    }
    cursor = users.length === PAGE_SIZE ? users.at(-1)!.id : undefined;
  } while (cursor);
  return queued;
}

/** Cursor pages are consumed serially. Date windows bound the scan to currently
 * due thresholds; there is no fixed first-page limit that starves later records. */
export async function queueEventReminders(
  client: DomainDb = db,
  now = new Date(),
) {
  const settings = await client.programSettings.findUnique({
    where: { id: "program" },
  });
  if (!settings?.emailNotificationsEnabled) return 0;
  const timeZone = settings.timeZone;
  const windows = REMINDER_LEADS.map((lead) => ({
    gte: new Date(now.getTime() + lead * 60_000 - REMINDER_LATE_MS),
    lte: new Date(now.getTime() + lead * 60_000),
  }));
  let queued = 0;
  for (const kind of ["interview", "meeting"] as const) {
    let cursor: string | undefined;
    do {
      const paging = {
        orderBy: { id: "asc" as const },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      };
      const rows =
        kind === "interview"
          ? (
              await client.tutorApplication.findMany({
                ...paging,
                where: {
                  status: "INTERVIEW",
                  invalidatedAt: null,
                  interviewCompletedAt: null,
                  OR: windows.map((range) => ({ interviewAt: range })),
                },
                select: { id: true, interviewAt: true },
              })
            ).map((row) => ({ id: row.id, date: row.interviewAt! }))
          : await client.tutorMeeting.findMany({
              ...paging,
              where: { OR: windows.map((range) => ({ date: range })) },
              select: { id: true, date: true },
            });
      for (const row of rows)
        queued += await enqueueOccurrence(
          client,
          kind,
          row.id,
          row.date,
          timeZone,
          now,
        );
      cursor = rows.length === PAGE_SIZE ? rows.at(-1)!.id : undefined;
    } while (cursor);
  }
  // Enumerate only local dates touching either due window, including midnight/DST.
  const dates = new Set<string>();
  for (const range of windows) {
    dates.add(programDateKey(range.gte, timeZone));
    dates.add(programDateKey(range.lte, timeZone));
  }
  const seen = new Set<string>();
  for (const date of dates) {
    const calendarDay = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekday = calendarDay === 0 ? 7 : calendarDay;
    let cursor: string | undefined;
    do {
      const rows = await client.pairing.findMany({
        where: {
          scheduleConfirmed: true,
          term: { active: true },
          dayOfWeek: weekday,
        },
        select: { id: true, groupId: true, startMin: true },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) {
        const key = `${date}:${row.groupId ?? row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (
          !Number.isInteger(row.startMin) ||
          row.startMin < 0 ||
          row.startMin >= 1440
        )
          continue;
        let startsAt: Date;
        try {
          startsAt = parseProgramDateTime(
            `${date}T${String(Math.floor(row.startMin / 60)).padStart(2, "0")}:${String(row.startMin % 60).padStart(2, "0")}`,
            timeZone,
          );
        } catch {
          continue;
        }
        queued += await enqueueOccurrence(
          client,
          row.groupId ? "tutoring_group" : "tutoring",
          row.groupId ?? row.id,
          startsAt,
          timeZone,
          now,
        );
      }
      cursor = rows.length === PAGE_SIZE ? rows.at(-1)!.id : undefined;
    } while (cursor);
  }
  return queued;
}

/** Revalidate source, recipient, preference, address and exact immutable queue
 * snapshot immediately before SMTP. Already in-flight mail cannot be recalled. */
export async function validateEventReminder(
  client: DomainDb,
  row: {
    userId: string | null;
    recipient: string;
    event: string;
    context: unknown;
    reminderKey?: string | null;
  },
  now = new Date(),
) {
  const parsed = contextSchema.safeParse(row.context);
  if (!parsed.success || !row.userId) return false;
  const context = parsed.data;
  if (
    row.event !== eventFor(context.kind) ||
    row.reminderKey !== reminderKey(context, row.userId, row.recipient) ||
    !reminderIsDue(new Date(context.startsAt), context.leadMinutes, now)
  )
    return false;
  const settings = await client.programSettings.findUnique({
    where: { id: "program" },
  });
  if (
    !settings?.emailNotificationsEnabled ||
    settings.timeZone !== context.timeZone
  )
    return false;
  const current = await occurrence(
    client,
    context.kind,
    context.sourceId,
    new Date(context.startsAt),
    context.timeZone,
  );
  if (current?.fingerprint !== context.fingerprint) return false;
  const user = await client.user.findFirst({
    where: { AND: [{ id: row.userId }, accountWhere, current.userWhere] },
    include: accountInclude,
  });
  return (
    !!user &&
    addresses(user).includes(row.recipient) &&
    JSON.stringify(context.emailDetail) ===
      JSON.stringify(
        detail(
          context.kind,
          recipientLabel(current, user),
          context.leadMinutes,
        ),
      )
  );
}
