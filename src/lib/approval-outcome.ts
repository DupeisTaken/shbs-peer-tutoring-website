/** Management procedures report queued proposals through the existing error
 * envelope. Only this feature adapter interprets it; shared review UI does not. */
export function queuedApprovalId(error: unknown): string | undefined {
  if (typeof error !== "object" || !error || !("data" in error))
    return undefined;
  const data = error.data;
  if (typeof data !== "object" || !data || !("approvalId" in data))
    return undefined;
  return typeof data.approvalId === "string" && data.approvalId
    ? data.approvalId
    : undefined;
}
