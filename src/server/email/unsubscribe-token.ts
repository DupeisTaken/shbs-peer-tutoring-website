import { createHmac, timingSafeEqual } from "node:crypto";
import { emailOrigin } from "./urls";

const PURPOSE = "shbs:optional-email-unsubscribe:v1";
export const UNSUBSCRIBE_TTL_SECONDS = 90 * 24 * 60 * 60;
export const MAX_UNSUBSCRIBE_TOKEN_LENGTH = 512;

function signingSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret?.trim())
    throw new Error(
      "Configure AUTH_SECRET for notification unsubscribe links.",
    );
  return secret;
}

function signature(payload: string) {
  // Purpose separation prevents another signed application token from authorizing this action.
  return createHmac("sha256", signingSecret())
    .update(`${PURPOSE}\n${payload}`)
    .digest();
}

/** The bearer token contains only a delivery identifier and expiry, never account/email data. */
export function createUnsubscribeToken(deliveryId: string, now = Date.now()) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(deliveryId))
    throw new Error("Invalid notification delivery identifier.");
  const expires = Math.floor(now / 1000) + UNSUBSCRIBE_TTL_SECONDS;
  const payload = `v1.${deliveryId}.${expires}`;
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyUnsubscribeToken(
  token: string,
  now = Date.now(),
): string | null {
  if (token.length > MAX_UNSUBSCRIBE_TOKEN_LENGTH) return null;
  const match =
    /^(v1\.([a-zA-Z0-9_-]{1,128})\.([0-9]{1,12}))\.([a-zA-Z0-9_-]{43})$/.exec(
      token,
    );
  if (!match) return null;
  const [, payload, id, expiry, encodedSignature] = match;
  const expires = Number(expiry);
  if (expires <= Math.floor(now / 1000)) return null;
  const actual = Buffer.from(encodedSignature!, "base64url");
  const expected = signature(payload!);
  // Require canonical encoding, as Buffer accepts alternate encodings of trailing bits.
  if (
    actual.toString("base64url") !== encodedSignature ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return null;
  return id!;
}

export function notificationUnsubscribeUrl(deliveryId: string) {
  return `${emailOrigin()}/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(deliveryId))}`;
}
