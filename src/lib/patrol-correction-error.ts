export const PATROL_CHANGED_MESSAGE =
  "Patrol changed. Reload before correcting it.";

/** Both display owners translate this exact refusal during render, retaining the wire text
 * in state so a language change updates existing feedback. Other errors keep their fallback. */
export function localizedPatrolCorrectionError(
  message: string | undefined,
  translate: (key: "patrolChanged") => string,
): string | undefined {
  return message === PATROL_CHANGED_MESSAGE
    ? translate("patrolChanged")
    : undefined;
}
