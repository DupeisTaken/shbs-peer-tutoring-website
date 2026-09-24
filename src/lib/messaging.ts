export const MESSAGE_GROUPS = [
  "MANAGEMENT",
  "CURRENT_TUTORS",
  "PAST_TUTORS",
  "SAME_GROUP",
  "ALL_USERS",
] as const;
export type MessageGroup = (typeof MESSAGE_GROUPS)[number];
export const MESSAGE_ROLES = [
  "STUDENT",
  "TUTOR",
  "CREW",
  "VIEWER",
  "COORDINATOR",
  "ADMIN",
  "HEAD",
] as const;
export const MAX_MESSAGE_RECIPIENTS = 20;
export const isMessageManager = (role: string) =>
  ["HEAD", "ADMIN", "COORDINATOR"].includes(role);
export const isMessageSupervisor = (role: string) =>
  ["HEAD", "ADMIN"].includes(role);
export function defaultMessageGroups(role: string): MessageGroup[] {
  return isMessageManager(role) ? ["ALL_USERS"] : ["MANAGEMENT"];
}
/** Stable public destinations also resolve old notification links using the current role. */
export function messageDestination(role: string) {
  return isMessageManager(role)
    ? "/admin/messages"
    : role === "STUDENT"
      ? "/student?view=messages"
      : "/messages";
}
