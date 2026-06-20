"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "~/server/auth";
import { db } from "~/server/db";

const schema = z.object({
  email: z.string().email(),
  enable2fa: z.boolean(),
});

/**
 * Completes first-login onboarding: confirm the contact email sign-in codes go to, opt
 * into email 2FA (scaffolded — no codes are actually sent yet), and stamp
 * `User.emailVerifiedAt` so the tutor shell stops routing here. Then on to the dashboard.
 */
export async function completeOnboardingAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const emailRaw = formData.get("email");
  const parsed = schema.safeParse({
    email: (typeof emailRaw === "string" ? emailRaw : "").trim().toLowerCase(),
    enable2fa: formData.get("enable2fa") === "on",
  });
  if (!parsed.success) return "Please enter a valid email address.";

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: {
        email: parsed.data.email,
        twoFactorEnabled: parsed.data.enable2fa,
        emailVerifiedAt: new Date(),
      },
    });
  } catch {
    return "That email is already in use by another account.";
  }

  redirect("/dashboard");
}
