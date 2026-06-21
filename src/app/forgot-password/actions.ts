"use server";

import { headers } from "next/headers";

import { issuePasswordReset } from "~/server/auth/password-reset";
import { rateLimit } from "~/server/rate-limit";

/** Best-effort client IP from the proxy headers (Caddy sets x-forwarded-for in production). */
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}

/**
 * Server action behind the forgot-password form. Always returns the same success state
 * (whether or not an account matched) so the form can't be used to enumerate accounts.
 *
 * Throttled to stop abuse now that it sends real email: at most 5 requests per IP / 15 min and
 * 3 per identifier / hour. Over the limit we silently skip issuing (still returning the generic
 * "sent" state) — no email is sent and nothing about account existence is revealed.
 */
export async function forgotPasswordAction(
  _prevState: { sent: boolean } | undefined,
  formData: FormData,
): Promise<{ sent: boolean }> {
  const raw = formData.get("identifier");
  const identifier = typeof raw === "string" ? raw : "";
  const id = identifier.trim().toLowerCase();

  const ip = await clientIp();
  const ipOk = rateLimit(`pwreset:ip:${ip}`, { max: 5, windowMs: 15 * 60_000 }).ok;
  const idOk = id ? rateLimit(`pwreset:id:${id}`, { max: 3, windowMs: 60 * 60_000 }).ok : true;

  if (ipOk && idOk) {
    await issuePasswordReset(identifier);
  }
  return { sent: true };
}
