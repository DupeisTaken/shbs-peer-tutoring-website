import type { AbstractIntlMessages } from "next-intl";

export const semesterWorkflowKeys = [
  "noActive", "abortFinal", "abortHelp", "abortPending", "applyAbort",
  "abortConsequences", "approveAbortConsequences", "legacyWithdrawalHelp",
] as const;

/** Apply the selected locale's semester wording only inside the tutee workspace.
 * Copy-on-write preserves request-wide messages, other portals and configured overrides.
 * This is presentation only: request deadlines and withdrawal rules remain server-owned.
 */
export function tuteePeriodMessages(
  messages: AbstractIntlMessages,
  quarterSystemEnabled: boolean,
): AbstractIntlMessages {
  if (quarterSystemEnabled) return messages;
  const workflow = messages.workflow;
  if (!workflow || typeof workflow === "string") return messages;
  const variants = workflow.semesterCopy;
  if (!variants || typeof variants === "string") return messages;
  const copy = { ...workflow };
  for (const key of semesterWorkflowKeys) {
    const value = variants[key];
    if (typeof value === "string") copy[key] = value;
  }
  return { ...messages, workflow: copy };
}
