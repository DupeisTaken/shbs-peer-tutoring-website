import {
  appealBody,
  requestAppealStatus,
  submitRequestAppeal,
} from "~/server/email/request-appeal";
import {
  REQUEST_APPEAL_TOKEN_MAX,
  verifyRequestAppealToken,
} from "~/server/email/request-appeal-token";
import { emailOrigin } from "~/server/email/urls";
import { rateLimit } from "~/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 12_000;
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const invalid = (status = 400) =>
  Response.json({ status: "invalid" }, { status, headers });
const unavailable = () =>
  Response.json({ status: "unavailable" }, { status: 503, headers });
function admit(token: string) {
  if (!token || token.length > REQUEST_APPEAL_TOKEN_MAX)
    return { status: "invalid" as const };
  const id = verifyRequestAppealToken(token);
  if (!id) return { status: "invalid" as const };
  // Process-local bursts bound database reads; one immutable appeal per flag is
  // the durable cross-replica accepted-write limit. Invalid tokens allocate no key.
  const global = rateLimit("request-appeal:global", {
    max: 600,
    windowMs: 60_000,
  });
  const local = global.ok
    ? rateLimit(`request-appeal:${id}`, { max: 30, windowMs: 60_000 })
    : global;
  return local.ok
    ? { status: "ready" as const }
    : {
        status: "throttled" as const,
        retryAfter: Math.max(1, Math.ceil(local.retryAfterMs / 1000)),
      };
}
function refused(admission: ReturnType<typeof admit>) {
  return admission.status === "throttled"
    ? Response.json(
        { status: "throttled" },
        {
          status: 429,
          headers: { ...headers, "Retry-After": String(admission.retryAfter) },
        },
      )
    : invalid();
}
/** Mail-scanner GETs only read a narrow capability projection. */
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const admission = admit(token);
    if (admission.status !== "ready") return refused(admission);
    return Response.json(await requestAppealStatus(token), { headers });
  } catch {
    return unavailable();
  }
}
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
    const { token, body } = input as Record<string, unknown>;
    if (typeof token !== "string") return invalid();
    const admission = admit(token);
    if (admission.status !== "ready") return refused(admission);
    const parsed = appealBody.safeParse(body);
    if (!parsed.success) return invalid();
    return Response.json(await submitRequestAppeal(token, parsed.data), {
      headers,
    });
  } catch {
    return unavailable();
  }
}
