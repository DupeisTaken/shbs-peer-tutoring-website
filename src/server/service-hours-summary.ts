import type { Quarter } from "~/lib/period";
import type { DomainDb } from "~/server/transactions";

export type ServiceHoursScope =
  { month: string } | { schoolYear: string; quarter: { in: Quarter[] } };

/** Aggregate recorded credit independently of today's membership and UI filters.
 * A month uses its stored UTC bucket; a program period uses its recorded stamps. */
export async function serviceHoursSummary(
  db: Pick<
    DomainDb,
    "tutor" | "session" | "serviceHourAdjustment" | "sessionTutee"
  >,
  scope: ServiceHoursScope,
) {
  const [tutors, sessionAgg, adjustments, attendance] = await Promise.all([
    db.tutor.findMany({
      // Keep distinct same-name records deterministic across refreshes and reports.
      orderBy: [{ englishName: "asc" }, { id: "asc" }],
      select: { id: true, englishName: true, status: true },
    }),
    db.session.groupBy({
      by: ["tutorId"],
      where: scope,
      _sum: { shCount: true },
      _count: { _all: true },
    }),
    db.serviceHourAdjustment.groupBy({
      by: ["tutorId", "type"],
      where: scope,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.sessionTutee.groupBy({
      by: ["status"],
      where: { session: scope },
      _count: { _all: true },
    }),
  ]);

  const earnedBy = new Map(
    sessionAgg.map((row) => [row.tutorId, row._sum.shCount ?? 0]),
  );
  const sessionsBy = new Map(
    sessionAgg.map((row) => [row.tutorId, row._count._all]),
  );
  const punishBy = new Map<string, number>();
  const extraBy = new Map<string, number>();
  const adjustmentCounts = new Map<string, number>();
  for (const adjustment of adjustments) {
    const target = adjustment.type === "PUNISHMENT" ? punishBy : extraBy;
    target.set(
      adjustment.tutorId,
      (target.get(adjustment.tutorId) ?? 0) + (adjustment._sum.amount ?? 0),
    );
    adjustmentCounts.set(
      adjustment.tutorId,
      (adjustmentCounts.get(adjustment.tutorId) ?? 0) + adjustment._count._all,
    );
  }

  const rows = tutors.map((tutor) => {
    const earned = earnedBy.get(tutor.id) ?? 0;
    const punishments = punishBy.get(tutor.id) ?? 0;
    const extras = extraBy.get(tutor.id) ?? 0;
    return {
      tutorId: tutor.id,
      englishName: tutor.englishName,
      active: tutor.status === "ACTIVE",
      earned,
      extras,
      punishments,
      total: earned - punishments + extras,
      sessions: sessionsBy.get(tutor.id) ?? 0,
      // Net zero can still contain attendance, offsetting adjustments or a
      // retained zero-valued adjustment. Evidence counts drive activity filters.
      adjustmentCount: adjustmentCounts.get(tutor.id) ?? 0,
    };
  });

  const attendanceTotals = { present: 0, excused: 0, unexcused: 0 };
  for (const group of attendance) {
    if (group.status === "PRESENT")
      attendanceTotals.present = group._count._all;
    else if (group.status === "EXCUSED_ABSENT")
      attendanceTotals.excused = group._count._all;
    else attendanceTotals.unexcused = group._count._all;
  }
  const hours = rows.reduce(
    (totals, row) => ({
      earned: totals.earned + row.earned,
      extras: totals.extras + row.extras,
      punishments: totals.punishments + row.punishments,
      total: totals.total + row.total,
      sessions: totals.sessions + row.sessions,
    }),
    { earned: 0, extras: 0, punishments: 0, total: 0, sessions: 0 },
  );
  return { rows, totals: { ...hours, ...attendanceTotals } };
}
