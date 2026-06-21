"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { resetPasswordAction } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(resetPasswordAction, undefined);

  if (state?.ok) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-slate-700">{t("auth.reset.success")}</p>
        {/* Remind them which username this email signs in with (handy if they forgot it). */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <p className="muted">{t("auth.reset.yourUsername")}</p>
          <p className="mt-0.5 font-semibold text-slate-900">
            {state.username ?? state.email}
          </p>
        </div>
        <Link href="/signin" className="btn-primary inline-block">
          {t("auth.reset.goToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      <label className="space-y-1">
        <span className="label">{t("auth.reset.fields.newPassword")}</span>
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
        <span className="label">{t("auth.reset.fields.confirmPassword")}</span>
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
        {pending ? t("auth.reset.saving") : t("auth.reset.submit")}
      </button>
    </form>
  );
}
