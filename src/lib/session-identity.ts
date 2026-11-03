/** Server-owned access/credential generations partition private cached data, even
 * when a corrected account keeps the same role. Display changes do not remount forms. */
export function sessionIdentity(session: unknown): string {
  if (!session || typeof session !== "object" || !("user" in session))
    return "anonymous";
  const user = session.user;
  if (
    !user ||
    typeof user !== "object" ||
    !("id" in user) ||
    typeof user.id !== "string"
  )
    return "anonymous";
  return JSON.stringify([
    user.id,
    "role" in session ? session.role : null,
    "tutorId" in session ? session.tutorId : null,
    "sessionVersion" in session ? session.sessionVersion : null,
    "historyAccessRevision" in session ? session.historyAccessRevision : 0,
  ]);
}
