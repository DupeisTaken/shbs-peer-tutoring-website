"use client";

import Link from "next/link";
import { useActionState } from "react";

import { forgotPasswordAction } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, undefined);

  if (state?.sent) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-slate-700">
          If an account matches what you entered, we&apos;ve sent password-reset instructions
          to its contact email. Check your inbox.
        </p>
        <p className="muted text-xs">
          Email delivery isn&apos;t configured in this environment yet — see the server logs
          for the reset link during local development.
        </p>
        <Link href="/signin" className="link">
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="space-y-1">
        <span className="label">Username or email</span>
        <input
          name="identifier"
          type="text"
          required
          autoComplete="username"
          className="input"
        />
      </label>

      <button type="submit" disabled={pending} className="btn-primary mt-1 w-full">
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
