"use client";

import { useActionState } from "react";

import { signInAction } from "./actions";

export function SignInForm() {
  const [error, formAction, pending] = useActionState(signInAction, undefined);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="space-y-1">
        <span className="label">Email</span>
        <input name="email" type="email" required autoComplete="email" className="input" />
      </label>

      <label className="space-y-1">
        <span className="label">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="input"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary mt-1 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
