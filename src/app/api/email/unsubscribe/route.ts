import {
  getUnsubscribeStatus,
  unsubscribeFromEmail,
} from "~/server/email/unsubscribe";
import { MAX_UNSUBSCRIBE_TOKEN_LENGTH } from "~/server/email/unsubscribe-token";
import { emailOrigin } from "~/server/email/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 2048;
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const invalid = (status = 400) =>
  Response.json({ status: "invalid" }, { status, headers });
const unavailable = () =>
  Response.json({ status: "unavailable" }, { status: 503, headers });

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token || token.length > MAX_UNSUBSCRIBE_TOKEN_LENGTH) return invalid();
  try {
    return Response.json(await getUnsubscribeStatus(token), { headers });
  } catch {
    return unavailable();
  }
}

/** Browser confirmation is intentional: GET and mail-scanner visits never change preferences. */
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== emailOrigin()) return invalid(403);
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return invalid(415);
    // Bound the stream as well as Content-Length, which is absent for chunked requests.
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
      return invalid(413);
    const reader = request.body?.getReader();
    if (!reader) return invalid();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return invalid(413);
      }
      chunks.push(value);
    }
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return invalid();
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return invalid();
    const { token, scope } = input as Record<string, unknown>;
    if (
      typeof token !== "string" ||
      !token ||
      token.length > MAX_UNSUBSCRIBE_TOKEN_LENGTH ||
      (scope !== "category" && scope !== "all")
    )
      return invalid();
    return Response.json(await unsubscribeFromEmail(token, scope), { headers });
  } catch {
    // Do not reflect tokens, addresses, connection errors or secret configuration to callers.
    return unavailable();
  }
}
