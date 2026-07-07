import { db } from "~/server/db";
import { rateLimit } from "~/server/rate-limit";
import { verifyPassword } from "./password";

export const SIGNIN_WINDOW_MS = 15 * 60_000;
export const SIGNIN_MAX_PER_IP = 10;
export const SIGNIN_MAX_PER_IDENTIFIER = 10;

export type SigninPasswordResult =
  | {
      ok: true;
      user: {
        id: string;
        name: string | null;
        email: string;
        twoFactorEnabled: boolean;
      };
    }
  | { ok: false; reason: "invalid" | "rate_limited" };

/** Best-effort client IP from proxy headers. */
export function clientIpFromRequest(request: Request | undefined): string {
  const xff = request?.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request?.headers.get("x-real-ip")?.trim() ?? "unknown";
}

/**
 * Verify a username/email + password pair with the same brute-force guards used by Auth.js.
 * The result deliberately does not distinguish unknown identifiers from bad passwords.
 */
export async function verifySigninPassword(
  identifierInput: string,
  password: string,
  ip: string,
): Promise<SigninPasswordResult> {
  const identifier = identifierInput.trim().toLowerCase();
  if (!identifier || !password) return { ok: false, reason: "invalid" };

  const withinLimit =
    rateLimit(`signin:ip:${ip}`, {
      max: SIGNIN_MAX_PER_IP,
      windowMs: SIGNIN_WINDOW_MS,
    }).ok &&
    rateLimit(`signin:id:${identifier}`, {
      max: SIGNIN_MAX_PER_IDENTIFIER,
      windowMs: SIGNIN_WINDOW_MS,
    }).ok;
  if (!withinLimit) return { ok: false, reason: "rate_limited" };

  const user = await db.user.findFirst({
    where: {
      OR: [{ email: identifier }, { username: identifier }, { tutor: { username: identifier } }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      twoFactorEnabled: true,
    },
  });
  if (!user?.passwordHash) return { ok: false, reason: "invalid" };
  if (!verifyPassword(password, user.passwordHash)) return { ok: false, reason: "invalid" };

  return {
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
    },
  };
}
