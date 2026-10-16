import { createHmac, timingSafeEqual } from "node:crypto";
import { emailOrigin } from "./urls";
const PURPOSE = "shbs:request-invalidity-appeal:v1";
export const REQUEST_APPEAL_TOKEN_MAX = 512;
export const REQUEST_APPEAL_TTL_MS = 90 * 24 * 60 * 60_000;
function sign(payload: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret?.trim())
    throw new Error("Configure AUTH_SECRET for request appeal links.");
  return createHmac("sha256", secret).update(`${PURPOSE}\n${payload}`).digest();
}
/** The token grants only a limited appeal/status capability. Retry keeps the
 * notice ID and its original expiry; no address, request data or account grant. */
export function requestAppealToken(id: string, createdAt: Date) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new Error("Invalid request notice identifier.");
  const payload = `v1.${id}.${Math.floor((createdAt.getTime() + REQUEST_APPEAL_TTL_MS) / 1000)}`;
  return `${payload}.${sign(payload).toString("base64url")}`;
}
export function verifyRequestAppealToken(token: string, now = Date.now()) {
  if (token.length > REQUEST_APPEAL_TOKEN_MAX) return null;
  const match =
    /^(v1\.([a-zA-Z0-9_-]{1,128})\.([0-9]{1,12}))\.([a-zA-Z0-9_-]{43})$/.exec(
      token,
    );
  if (!match || Number(match[3]) * 1000 <= now) return null;
  const actual = Buffer.from(match[4]!, "base64url"),
    expected = sign(match[1]!);
  if (
    actual.toString("base64url") !== match[4] ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return null;
  return match[2]!;
}
export function requestAppealUrl(id: string, createdAt: Date) {
  return `${emailOrigin()}/request-appeal?token=${encodeURIComponent(requestAppealToken(id, createdAt))}`;
}
