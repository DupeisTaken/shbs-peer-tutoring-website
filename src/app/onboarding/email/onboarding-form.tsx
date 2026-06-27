"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { completeOnboardingAction } from "./actions";

export function OnboardingForm({
  defaultEmail,
  email2fa,
}: {
  defaultEmail: string;
  email2fa: boolean;
}) {
  const t = useTranslations();
  const [error, formAction, pending] = useActionState(
    completeOnboardingAction,
    undefined,
  );
  const [valid, setValid] = useState(false);

  return (
    <form
      action={formAction}
      onChange={(e) => setValid(e.currentTarget.checkValidity())}
      className="flex w-full flex-col gap-4"
    >
      <label className="space-y-1">
        <span className="label">{t("auth.onboarding.fields.email")}</span>
        <input
          name="email"
          type="email"
          required
          defaultValue={defaultEmail}
          autoComplete="email"
          className="input"
        />
        <span className="muted text-xs">{t("auth.onboarding.help.email")}</span>
      </label>

      <label className="space-y-1">
        <span className="label">{t("auth.onboarding.fields.newPassword")}</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
        />
        <span className="muted text-xs">{t("auth.onboarding.help.newPassword")}</span>
      </label>

      <label className="space-y-1">
        <span className="label">{t("auth.onboarding.fields.confirmPassword")}</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
        />
      </label>

      {email2fa && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="enable2fa" defaultChecked className="mt-1" />
          <span>{t("auth.onboarding.enable2fa")}</span>
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending || !valid} className="btn-primary mt-1 w-full">
        {pending ? t("auth.onboarding.saving") : t("auth.onboarding.submit")}
      </button>
    </form>
  );
}
