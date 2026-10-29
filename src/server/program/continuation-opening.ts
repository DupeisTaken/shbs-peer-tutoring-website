import type { Term } from "../../../generated/prisma";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

type OpeningState = Pick<
  Term,
  | "active"
  | "signupEnabled"
  | "signupOpensAt"
  | "signupClosesAt"
  | "signupOpeningStateSince"
  | "signupFirstOpenedAt"
>;
type OpeningPatch = Partial<
  Pick<
    Term,
    | "active"
    | "signupEnabled"
    | "signupOpensAt"
    | "signupClosesAt"
    | "signupPreviewUrl"
    | "tutorSignupOpensAt"
  >
>;

/** Settle elapsed intervals, including a whole window missed during worker downtime.
 * The checkpoint bounds the current configuration; it is never the observation time. */
export function continuationOpeningDue(
  term: OpeningState,
  now: Date,
): Date | null {
  if (
    term.signupFirstOpenedAt ||
    !term.signupOpeningStateSince ||
    !term.active ||
    !term.signupEnabled
  )
    return null;
  const opens = new Date(
    Math.max(
      +term.signupOpeningStateSince,
      +(term.signupOpensAt ?? term.signupOpeningStateSince),
    ),
  );
  return +opens <= +now &&
    (!term.signupClosesAt || +opens < +term.signupClosesAt)
    ? opens
    : null;
}

async function lockedTerm(tx: TransactionDb, termId: string) {
  // Take this barrier before participant/catalogue locks, matching refresh and window edits.
  await lockEntity(tx, "program:period");
  await tx.$queryRaw`SELECT id FROM "Term" WHERE id = ${termId} FOR UPDATE`;
  return tx.term.findUniqueOrThrow({ where: { id: termId } });
}

async function settle(tx: TransactionDb, term: Term, now: Date): Promise<Term> {
  const firstOpening = continuationOpeningDue(term, now);
  if (!firstOpening) return term;
  const updated = await tx.term.update({
    where: { id: term.id },
    data: { signupFirstOpenedAt: firstOpening },
  });
  await tx.auditLog.create({
    data: {
      entity: "Term",
      entityId: term.id,
      operation: "program.recordFirstSignupOpening",
      action: "Recorded first effective tutee signup opening",
      details: {
        firstOpenedAt: firstOpening.toISOString(),
        observedAt: now.toISOString(),
      },
    },
  });
  return updated;
}

/** Call in a transaction; reads and accepted joins receive the same durable anchor. */
export async function settleContinuationOpening(
  tx: TransactionDb,
  termId: string,
  now?: Date,
): Promise<Term> {
  const term = await lockedTerm(tx, termId);
  return settle(tx, term, now ?? new Date());
}

/** Preserve the old interval before changing its gates. Unknown history stays unknown. */
export async function updateContinuationOpening(
  tx: TransactionDb,
  termId: string,
  patch: OpeningPatch,
  now?: Date,
): Promise<Term> {
  const current = await lockedTerm(tx, termId);
  const changedAt = now ?? new Date();
  const before = await settle(tx, current, changedAt);
  const comparable = (value: Date | boolean | null | undefined) =>
    value instanceof Date ? +value : value;
  const gatesChanged = (
    ["active", "signupEnabled", "signupOpensAt", "signupClosesAt"] as const
  ).some(
    (key) =>
      patch[key] !== undefined &&
      comparable(patch[key]) !== comparable(before[key]),
  );
  const updated = await tx.term.update({
    where: { id: termId },
    data: {
      ...patch,
      ...(gatesChanged && before.signupOpeningStateSince
        ? { signupOpeningStateSince: changedAt }
        : {}),
    },
  });
  return settle(tx, updated, changedAt);
}

/** Existing/imported destinations cannot acquire invented activation or opening history. */
export function newContinuationOpening(
  source: Pick<Term, "id" | "schoolYear" | "quarter"> | null,
  destination: Pick<Term, "schoolYear" | "quarter">,
  semesterMode: boolean,
  now: Date,
) {
  const eligible =
    !!source &&
    !semesterMode &&
    source.schoolYear === destination.schoolYear &&
    ((source.quarter === "Q1" && destination.quarter === "Q2") ||
      (source.quarter === "Q3" && destination.quarter === "Q4"));
  return {
    signupOpeningStateSince: now,
    continuationSourceTermId: eligible ? source.id : null,
    continuationQuarterTransition: eligible,
  };
}

/** Observation only; exact opening remains derivable after missed sweeps or restarts. */
export async function settleActiveContinuationOpening(db: DomainDb) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    const term = await tx.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    return term ? settleContinuationOpening(tx, term.id) : null;
  });
}
