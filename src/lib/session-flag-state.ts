/** Display filters use recorded discrepancy decisions, independent of participant status. */
export const SESSION_FLAG_STATES = [
  "PENDING",
  "DISMISSED",
  "WARNED",
  "PENALIZED",
  "ESCALATED",
] as const;
export const SESSION_FLAG_FILTERS = [...SESSION_FLAG_STATES, "ALL"] as const;
export type SessionFlagFilter = (typeof SESSION_FLAG_FILTERS)[number];
