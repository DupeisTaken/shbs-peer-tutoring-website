"use client";

import Link from "next/link";
import { useActionState } from "react";

import { resetPasswordAction } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, undefined);

  if (state?.ok) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-slate-700">Your password has been reset. You can sign in now.</p>
        <Link href="/signin" className="btn-primary inline-block">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      <label className="space-y-1">
        <span className="label">New password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
        />
      </label>

      <label className="space-y-1">
        <span className="label">Confirm new password</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
        />
      </label>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary mt-1 w-full">
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
