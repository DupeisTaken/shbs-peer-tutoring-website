/** Deliberation time by consequence. Ticket lifetimes and unrelated timers are separate policies. */
export const confirmationDelayMs = {
  RECALL: 2_000,
  ABORT: 3_000,
  SCHEDULE: 2_000,
  APPROVE: 3_000,
  DENY: 2_000,
  POLICY: 5_000,
  ASSIGN: 2_000,
  ASSIGNMENT_OVERRIDE: 2_000,
  // Signup-specific reviews retain their established delay when integrated
  // with the action-specific map; each must yield a valid server readyAt.
  SIGNUP_EDIT: 5_000,
  SIGNUP_UNASSIGN: 5_000,
  SIGNUP_APPEAL: 5_000,
} as const;

export type ConfirmationTicket = {
  id: string;
  readyAt: Date;
  expiresAt: Date;
  serverNow: Date;
};
export type AnchoredConfirmation = {
  ticket: ConfirmationTicket;
  requestStartedAt: number;
  receivedAt: number;
};

/** Never use the client's wall clock for eligibility. Count elapsed monotonic time from
 * receipt of the server snapshot; transit time adds a conservative delay, never early access. */
export function confirmationState(
  anchor: AnchoredConfirmation | null,
  now: number,
) {
  if (!anchor) return { remaining: null, expired: false, eligible: false };
  const serverNow = +anchor.ticket.serverNow;
  const readyAt = +anchor.ticket.readyAt;
  const expiresAt = +anchor.ticket.expiresAt;
  const current = serverNow + Math.max(0, now - anchor.receivedAt);
  const valid =
    [serverNow, readyAt, expiresAt, current].every(Number.isFinite) &&
    expiresAt > readyAt;
  // The complete request round trip is an upper bound on response transit. Use
  // it only for expiry so slow transport cannot knowingly extend server validity.
  const transitUpperBound = Math.max(
    0,
    anchor.receivedAt - anchor.requestStartedAt,
  );
  const expired =
    !valid ||
    !Number.isFinite(transitUpperBound) ||
    current + transitUpperBound >= expiresAt;
  const remaining = valid
    ? Math.max(0, Math.ceil((readyAt - current) / 1_000))
    : null;
  return { remaining, expired, eligible: !expired && remaining === 0 };
}
