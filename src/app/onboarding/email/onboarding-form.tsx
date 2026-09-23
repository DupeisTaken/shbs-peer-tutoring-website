"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { completeOnboardingAction } from "./actions";

export function OnboardingForm({ defaultEmail }: { defaultEmail: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(completeOnboardingAction, undefined);
  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <p className="text-sm text-slate-700">{t("auth.onboarding.proofRequired")}</p>
      <label className="space-y-1">
        <span className="label">{t("auth.onboarding.fields.email")}</span>
        <input type="email" readOnly value={defaultEmail} autoComplete="email" className="input" />
      </label>
      {state && <p role={state.sent ? "status" : "alert"} className={state.sent ? "text-sm text-green-700" : "text-sm text-red-600"}>
        {t(state.sent ? "auth.onboarding.linkSent" : "auth.onboarding.linkFailed")}
      </p>}
      <button type="submit" disabled={pending} className="btn-primary mt-1 w-full">
        {pending ? t("account.password.sending") : t("auth.onboarding.sendLink")}
      </button>
    </form>
  );
}
