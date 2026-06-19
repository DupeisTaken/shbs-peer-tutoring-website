"use client";

import { useActionState } from "react";

import { signInAction } from "./actions";

export function SignInForm() {
  const [error, formAction, pending] = useActionState(signInAction, undefined);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1 text-left text-sm">
        <span className="text-white/70">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-white outline-none focus:border-white/40"
        />
      </label>

      <label className="flex flex-col gap-1 text-left text-sm">
        <span className="text-white/70">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-white outline-none focus:border-white/40"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-full bg-white/15 px-8 py-3 font-semibold transition hover:bg-white/25 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
