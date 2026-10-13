type Source = { kind: "application" | "survey" | "signup"; id: string };
/** Staff links contain a record ID, never the public appeal capability. Each page
 * reveals the authorized record after restoring session-only presentation state. */
export function requestStaffDestination(source: Source) {
  return source.kind === "application"
    ? `/admin/applications#application-${encodeURIComponent(source.id)}`
    : `/admin/requests#request-${source.kind}-${encodeURIComponent(source.id)}`;
}
export function requestBoardTarget(
  hash: string,
): { kind: "survey" | "signup"; id: string } | null {
  const match = /^#request-(survey|signup)-([a-zA-Z0-9_-]{1,128})$/.exec(hash);
  return match
    ? { kind: match[1] as "survey" | "signup", id: match[2]! }
    : null;
}
