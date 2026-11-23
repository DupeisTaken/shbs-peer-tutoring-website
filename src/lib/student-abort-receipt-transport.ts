export const studentAbortReceiptPath = "studentWorkflow.abortReceipt";

/** Only this unbatched read may use POST query transport. Its proof stays in the
 * body while tRPC still enforces query authorization and writes no mutation audit. */
export function isStudentAbortReceiptPost(
  request: Pick<Request, "method" | "url">,
) {
  const url = new URL(request.url);
  return (
    request.method === "POST" &&
    url.pathname === `/api/trpc/${studentAbortReceiptPath}` &&
    url.searchParams.get("batch") !== "1"
  );
}
