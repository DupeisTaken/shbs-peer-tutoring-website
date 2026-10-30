import { getPeriodDisplay } from "~/lib/period";
import { recruitmentWindow } from "~/lib/recruitment";
import type { PublicSignupTransition } from "~/lib/public-signup-transition";
import { inTransaction, type DomainDb } from "~/server/transactions";
import { lockNextRecruitment, readNextRecruitment } from "./next-recruitment";
import { readPublicRefreshSchedule } from "./scheduled-refresh";
import { getProgramTimeZone } from "./time-zone";

/** Read the active window and future announcement under the same period barrier.
 * This allowlist deliberately excludes Head identity, approvals and refresh evidence. */
export async function readPublicSignupTransition(
  db: DomainDb,
): Promise<PublicSignupTransition> {
  return inTransaction(db, async (tx) => {
    await lockNextRecruitment(tx);
    const term = await tx.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    const timeZone = await getProgramTimeZone(tx);
    if (!term)
      return {
        serverNow: new Date().toISOString(),
        timeZone,
        current: null,
        next: null,
      };
    const mode = await tx.programFeature.findUnique({
      where: { key: "QUARTER_SYSTEM" },
    });
    const quarterSystem = mode?.enabled ?? true;
    const current = {
      termId: term.id,
      ...getPeriodDisplay(term, quarterSystem),
      window: recruitmentWindow(term, "tutee"),
    };
    let next: PublicSignupTransition["next"] = null;
    // Only the confirmed same-semester handoffs advertise the next quarter.
    // A staged semester-mode change must not be presented as a Q2/Q4 opening.
    if (
      quarterSystem &&
      (mode?.pendingEnabled ?? quarterSystem) &&
      (term.quarter === "Q1" || term.quarter === "Q3")
    ) {
      const snapshot = await readNextRecruitment(tx);
      const prepared = snapshot.preparations.tutee;
      const destination = snapshot.refreshEvidence.destination?.tutee;
      const schedule = await readPublicRefreshSchedule(tx, term.id);
      const matchesSchedule =
        !schedule ||
        (schedule.destinationSchoolYear ===
          snapshot.target.destinationSchoolYear &&
          schedule.destinationQuarter === snapshot.target.destinationQuarter &&
          !schedule.semesterMode);
      const opensAt = prepared
        ? prepared.opensAt
        : (destination?.opensAt ?? null);
      next = {
        label: getPeriodDisplay(
          {
            schoolYear: snapshot.target.destinationSchoolYear,
            quarter: snapshot.target.destinationQuarter,
          },
          true,
        ).label,
        opensAt: opensAt?.toISOString() ?? null,
        closesAt: destination?.closesAt?.toISOString() ?? null,
        enabled: destination?.enabled ?? true,
        previewUrl: destination?.previewUrl ?? null,
        preparationValid: (prepared?.matchesTarget ?? true) && matchesSchedule,
        refresh: schedule
          ? {
              executeAt: schedule.executeAt.toISOString(),
              state: schedule.state,
              valid: schedule.valid,
            }
          : null,
      };
    }
    return { serverNow: new Date().toISOString(), timeZone, current, next };
  });
}
