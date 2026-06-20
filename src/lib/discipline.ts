/**
 * Tutee disciplinary standing (pure, unit-tested).
 *
 * Policy (tutee + tutor handbooks):
 *   - Yellow and red cards are issued for violations; some are auto-issued from attendance.
 *   - 3 yellow cards = 1 red card.
 *   - 2 red cards = removal from the program (pending final team review).
 *
 * Only cards the team has marked VALID count toward standing; PENDING cards (tutor requests
 * awaiting recheck) and INVALID cards do not. The "3 yellow -> 1 red" escalation is computed
 * here rather than materialized as rows, so a tutee's standing is always a pure function of
 * their card list and can't drift.
 */

export type CardColor = "YELLOW" | "RED";
export type CardReviewStatus = "PENDING" | "VALID" | "INVALID";

export interface CardLike {
  color: CardColor;
  reviewStatus: CardReviewStatus;
}

/** Yellow cards that escalate into one red. */
export const YELLOW_PER_RED = 3;
/** Effective red cards that trigger removal-pending. */
export const REDS_FOR_REMOVAL = 2;

export interface DisciplineStanding {
  /** VALID cards only. */
  validYellow: number;
  validRed: number;
  /** Tutor-requested cards still awaiting team recheck. */
  pendingYellow: number;
  pendingRed: number;
  /** Reds counting escalation: validRed + floor(validYellow / 3). */
  effectiveReds: number;
  /** Leftover valid yellows that haven't yet formed a red. */
  yellowsTowardNextRed: number;
  /** True once effectiveReds reaches the removal threshold. */
  removalPending: boolean;
}

/** Compute a tutee's disciplinary standing from their card list. */
export function disciplineStanding(cards: readonly CardLike[]): DisciplineStanding {
  let validYellow = 0;
  let validRed = 0;
  let pendingYellow = 0;
  let pendingRed = 0;

  for (const card of cards) {
    if (card.reviewStatus === "VALID") {
      if (card.color === "YELLOW") validYellow++;
      else validRed++;
    } else if (card.reviewStatus === "PENDING") {
      if (card.color === "YELLOW") pendingYellow++;
      else pendingRed++;
    }
    // INVALID cards are ignored.
  }

  const effectiveReds = validRed + Math.floor(validYellow / YELLOW_PER_RED);
  const yellowsTowardNextRed = validYellow % YELLOW_PER_RED;

  return {
    validYellow,
    validRed,
    pendingYellow,
    pendingRed,
    effectiveReds,
    yellowsTowardNextRed,
    removalPending: effectiveReds >= REDS_FOR_REMOVAL,
  };
}
