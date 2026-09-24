/** Editing is an explicit assignment; management review never grants that assignment. */
export function translationAccess(
  account:
    | {
        role?: string | null;
        canTranslate?: boolean | null;
      }
    | null
    | undefined,
) {
  const role = account?.role;
  const edit = role !== "VIEWER" && account?.canTranslate === true;
  const publish = role === "ADMIN" || role === "HEAD";
  const request = role === "COORDINATOR";
  return { edit, publish, request, enter: edit || publish || request };
}
