/** Only identity/capabilities partition cached data; expiring timestamps and display
 * names must not remount forms or retain the previous user's query results. */
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
  ]);
}
