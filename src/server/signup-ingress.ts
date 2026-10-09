import { TRPC_BATCH_OPTIONS } from "~/lib/trpc-batch";
import {
  SignupRetry,
  signupBurst,
  signupNetwork,
  type SignupLane,
} from "./signup-admission";

export function signupLane(path: string): SignupLane | null {
  if (
    [
      "tutee.requestSignup",
      "tutee.submitSurvey",
      "tutee.resendSurvey",
      "viewer.start",
      "crew.submitApplication",
      "crew.requestStatus",
      "program.verifySignupCaptcha",
    ].includes(path)
  )
    return "mail";
  if (
    [
      "tutee.confirmSurvey",
      "tutee.inspectSurvey",
      "viewer.verify",
      "viewer.complete",
      "crew.verifyApplication",
    ].includes(path)
  )
    return "complete";
  if (
    [
      "tutee.signupOptions",
      "tutee.surveyPolicy",
      "tutee.policy",
      "program.profilePolicy",
      "program.features",
      "program.captchaPublic",
      "crew.applicationStatus",
    ].includes(path)
  )
    return "read";
  return null;
}

// Kept ahead of tRPC parsing and auth(). The process cap also bounds slow/chunked bodies.
let inFlight = 0;
export async function signupIngress(
  req: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  const reject = (status: number, message: string, retry = 60) => {
    // Match tRPC's SuperJSON error envelope so browser clients retain translated codes.
    const error = { error: { json: { message, code: status === 429 ? -32029 : -32600,
      data: { code: status === 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST", httpStatus: status, retryAfterSeconds: retry } } } };
    return Response.json(
      new URL(req.url).searchParams.get("batch") === "1" && req.headers.get("trpc-accept") !== "application/jsonl" && req.headers.get("accept") !== "application/jsonl" ? [error] : error,
      {
        status,
        headers: { "Retry-After": String(retry), "Cache-Control": "no-store" },
      },
    );
  };
  if (inFlight >= 32) return reject(429, "SIGNUP_RETRY", 5);
  inFlight++;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = new URL(req.url);
    if (url.search.length > 32_768) return reject(413, "Request too large");
    const paths = decodeURIComponent(
      url.pathname.split("/api/trpc/")[1] ?? "",
    ).split(",");
    if (paths.length > TRPC_BATCH_OPTIONS.maxItems) return reject(413, "Too many batched operations");
    const lanes = paths.map(signupLane);
    const publicRequest = lanes.some(Boolean);
    // Count every public operation, including malformed JSON/input, and mixed batches.
    for (const lane of lanes)
      if (lane) signupBurst(lane, signupNetwork(req.headers));
    // Record-transfer accepts 5 MiB plus JSON escaping/base64 overhead.
    const maxBytes = publicRequest ? 32_768 : 32 * 1_048_576;
    if (Number(req.headers.get("content-length")) > maxBytes)
      return reject(413, "Request too large");
    let guarded = req;
    if (req.body) {
      reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("body-timeout")), 5000);
      });
      while (true) {
        const result = await Promise.race([reader.read(), deadline]);
        if (result.done) break;
        size += result.value.byteLength;
        if (size > maxBytes) {
          void reader.cancel().catch(() => undefined);
          return reject(413, "Request too large");
        }
        chunks.push(result.value);
      }
      clearTimeout(timer);
      // Next can proxy its Request; Undici's copy constructor reads private state
      // through that proxy and fails. Rebuild from the public HTTP properties.
      guarded = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        signal: req.signal,
        body: Buffer.concat(chunks),
      });
    }
    return await handle(guarded);
  } catch (error) {
    void reader?.cancel().catch(() => undefined);
    const cause: unknown = error instanceof Error ? error.cause : null;
    if (cause instanceof SignupRetry)
      return reject(429, "SIGNUP_RETRY", cause.retryAfterSeconds);
    if (error instanceof Error && error.message === "body-timeout")
      return reject(408, "Request timed out");
    if (error instanceof URIError) return reject(400, "Invalid path");
    throw error;
  } finally {
    clearTimeout(timer);
    inFlight--;
  }
}
