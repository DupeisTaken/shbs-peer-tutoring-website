import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma";
import {
  getPeriodDisplay,
  quarterSemester,
  semesterQuarters,
  type Quarter,
} from "~/lib/period";
import { getActivePeriodOrNull } from "./period";
import { getFeatures } from "./program/features";

type Db = Pick<PrismaClient, "term" | "tutorMeeting" | "programFeature">;
export const meetingPeriodInput = z.object({
  period: z.union([
    z.literal("current"),
    z.literal("unassigned"),
    z.literal("upcomingOutside"),
    z.string().regex(/^\d{2}-\d{2}:(Q[1-4]|S[12])$/),
  ]),
});

/** Stored ownership determines grouping; a date never moves evidence to another term. */
function periodKey(
  period: { schoolYear: string; quarter: Quarter },
  quarters: boolean,
) {
  return `${period.schoolYear}:${quarters ? period.quarter : quarterSemester(period.quarter)}`;
}

export function recordedMeetingPeriod(
  key: string,
): Prisma.TutorMeetingWhereInput {
  if (key === "unassigned") return { termId: null };
  const [schoolYear, period] = key.split(":");
  return {
    term: {
      schoolYear,
      quarter: {
        in: period?.startsWith("S")
          ? semesterQuarters(period as "S1" | "S2")
          : [period as Quarter],
      },
    },
  };
}

export async function meetingPeriodContext(db: Db) {
  const [active, features] = await Promise.all([
    getActivePeriodOrNull(db),
    getFeatures(db),
  ]);
  const current = active
    ? {
        key: periodKey(active, features.QUARTER_SYSTEM),
        label: getPeriodDisplay(active, features.QUARTER_SYSTEM).label,
      }
    : null;
  return { current, quarters: features.QUARTER_SYSTEM };
}

export async function meetingScope(db: Db, period: string, now = new Date()) {
  if (period !== "current" && period !== "upcomingOutside")
    return recordedMeetingPeriod(period);
  const { current } = await meetingPeriodContext(db);
  const currentWhere = current
    ? recordedMeetingPeriod(current.key)
    : { id: { in: [] } };
  // Include null-term meetings explicitly: SQL NOT of a relation filter can
  // otherwise omit unassigned legacy records.
  return period === "current"
    ? currentWhere
    : outsideMeetingScope(current?.key, now);
}

function outsideMeetingScope(
  currentKey: string | undefined,
  now: Date,
): Prisma.TutorMeetingWhereInput {
  return {
    date: { gte: now },
    ...(currentKey
      ? { OR: [{ termId: null }, { NOT: recordedMeetingPeriod(currentKey) }] }
      : {}),
  };
}

/** Catalog reads counts only. Historical attendance is fetched when its group opens.
 * Tutor history includes personal evidence only; upcoming notices remain available
 * even when no attendance has been recorded yet. */
export async function meetingPeriods(db: Db, tutorId?: string) {
  const now = new Date();
  const { current, quarters } = await meetingPeriodContext(db);
  const eligible: Prisma.TutorMeetingWhereInput = tutorId
    ? {
        OR: [
          { attendances: { some: { tutorId } } },
          { date: { gte: now } },
          ...(current ? [recordedMeetingPeriod(current.key)] : []),
        ],
      }
    : {};
  const [counts, terms, outsideUpcoming] = await Promise.all([
    db.tutorMeeting.groupBy({
      by: ["termId"],
      where: eligible,
      _count: { _all: true },
    }),
    db.term.findMany({ select: { id: true, schoolYear: true, quarter: true } }),
    db.tutorMeeting.count({ where: outsideMeetingScope(current?.key, now) }),
  ]);
  const byId = new Map(terms.map((term) => [term.id, term]));
  const groups = new Map<
    string,
    { key: string; label: string | null; count: number }
  >();
  for (const row of counts) {
    const term = row.termId ? byId.get(row.termId) : null;
    const key = term ? periodKey(term, quarters) : "unassigned";
    const group = groups.get(key) ?? {
      key,
      label: term ? getPeriodDisplay(term, quarters).label : null,
      count: 0,
    };
    group.count += row._count._all;
    groups.set(key, group);
  }
  return {
    current,
    outsideUpcoming,
    history: [...groups.values()]
      .filter((group) => group.key !== current?.key)
      .sort((a, b) =>
        a.key === "unassigned"
          ? 1
          : b.key === "unassigned"
            ? -1
            : b.key.localeCompare(a.key),
      ),
  };
}
