import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { APP_TITLE } from "~/lib/branding";
import { OnboardingForm } from "./onboarding-form";

export const metadata = {
  title: `Confirm your email · ${APP_TITLE}`,
};

/**
 * First-login gate. A signed-in tutor whose `emailVerifiedAt` is null lands here (routed
 * from the tutor shell) to confirm their contact email and 2FA preference before reaching
 * the dashboard. If they've already onboarded, send them on.
 */
export default async function OnboardingEmailPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerifiedAt: true },
  });

  const isElevated = session.role === "ADMIN" || session.role === "COORDINATOR";
  if (user?.emailVerifiedAt) redirect(isElevated ? "/admin" : "/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <span className="badge-slate mb-3">Welcome to {APP_TITLE}</span>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Confirm your email
        </h1>
        <p className="muted mt-1">
          One quick step before your dashboard — confirm where we can reach you and set up
          two-factor sign-in.
        </p>
        <div className="card mt-6 p-6 text-left">
          <OnboardingForm defaultEmail={user?.email ?? ""} />
        </div>
      </div>
    </main>
  );
}
