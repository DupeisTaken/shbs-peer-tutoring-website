"use client";

import { useActionState } from "react";

import { completeOnboardingAction } from "./actions";

export function OnboardingForm({ defaultEmail }: { defaultEmail: string }) {
  const [error, formAction, pending] = useActionState(
    completeOnboardingAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="space-y-1">
        <span className="label">Contact email</span>
        <input
          name="email"
          type="email"
          required
          defaultValue={defaultEmail}
          autoComplete="email"
          className="input"
        />
        <span className="muted text-xs">
          We&apos;ll send your sign-in verification codes here.
        </span>
      </label>

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
        <span className="muted text-xs">At least 8 characters. Replaces the temporary one.</span>
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

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="enable2fa" defaultChecked className="mt-1" />
        <span>
          Enable email two-factor authentication (recommended). A one-time code will be
          emailed at sign-in once email delivery is configured.
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary mt-1 w-full">
        {pending ? "Saving…" : "Confirm and continue"}
      </button>
    </form>
  );
}
