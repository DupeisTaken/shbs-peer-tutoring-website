"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { hashPassword } from "~/server/auth/password";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  enable2fa: z.boolean(),
});

/**
 * Completes first-login onboarding: confirm the contact email, set a real password (auto-
 * provisioned accounts arrive on a shared default), opt into email 2FA (scaffolded), and stamp
 * `User.emailVerifiedAt` + clear `mustChangePassword` so the tutor shell stops routing here.
 */
export async function completeOnboardingAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const emailRaw = formData.get("email");
  const passwordRaw = formData.get("password");
  const confirmRaw = formData.get("confirm");
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  const confirm = typeof confirmRaw === "string" ? confirmRaw : "";

  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirm) return "Passwords don't match.";

  const parsed = schema.safeParse({
    email: (typeof emailRaw === "string" ? emailRaw : "").trim().toLowerCase(),
    password,
    enable2fa: formData.get("enable2fa") === "on",
  });
  if (!parsed.success) return "Please enter a valid email address.";

  // Only honour the 2FA opt-in when the program has email 2FA enabled (the checkbox is hidden
  // otherwise; this also rejects a crafted POST).
  const { EMAIL_2FA } = await getFeatures(db);

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: {
        email: parsed.data.email,
        passwordHash: hashPassword(parsed.data.password),
        mustChangePassword: false,
        twoFactorEnabled: EMAIL_2FA && parsed.data.enable2fa,
        emailVerifiedAt: new Date(),
      },
    });
  } catch {
    return "That email is already in use by another account.";
  }

  redirect("/dashboard");
}
