import { schoolHoursEmailCopy } from "./school-hours-email";

/** Delegates reminder composition to the shared renderer so the reminder note
 * stays inside the accessible dark-surface card and updates the inbox preview. */
export function schoolHoursRecipientEmailCopy(
  input: Parameters<typeof schoolHoursEmailCopy>[0] & { reminder?: boolean },
) {
  return schoolHoursEmailCopy(input);
}
