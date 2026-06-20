import Link from "next/link";

import { APP_TITLE } from "~/lib/branding";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = {
  title: `Forgot password · ${APP_TITLE}`,
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Reset your password
        </h1>
        <p className="muted mt-1">
          Enter your username or email and we&apos;ll send a reset link.
        </p>
        <div className="card mt-6 p-6 text-left">
          <ForgotPasswordForm />
        </div>
        <p className="mt-6">
          <Link href="/signin" className="link">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
