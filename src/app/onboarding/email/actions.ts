"use server";

import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { issuePasswordReset } from "~/server/auth/password-reset";
import { isEmailDeliveryAvailable } from "~/server/email/sender";
import { rateLimit } from "~/server/rate-limit";

export type OnboardingState = { sent: boolean };

/** Legacy accounts finish setup through the existing single-use mailbox-proof flow.
 * Never accept posted email, password or 2FA fields as proof of ownership. In particular,
 * this action cannot overwrite credentials after another browser has recovered the account. */
export async function completeOnboardingAction(
  _prevState: OnboardingState | undefined,
  _formData: FormData,
): Promise<OnboardingState> {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerifiedAt: true, mustChangePassword: true },
  });
  if (!user || (user.emailVerifiedAt && !user.mustChangePassword) || !isEmailDeliveryAvailable())
    return { sent: false };
  // Share the recovery identifier budget and prevent repeated clicks from flooding the mailbox.
  if (!rateLimit(`onboarding:${session.user.id}`, { max: 1, windowMs: 60_000 }).ok ||
      !rateLimit(`pwreset:id:${user.email}`, { max: 3, windowMs: 60 * 60_000 }).ok)
    return { sent: false };
  try {
    await issuePasswordReset(user.email);
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
