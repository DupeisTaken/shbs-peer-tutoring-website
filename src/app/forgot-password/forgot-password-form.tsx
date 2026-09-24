"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { forgotPasswordAction } from "./actions";

export function ForgotPasswordForm() {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(forgotPasswordAction, undefined);
  const [valid, setValid] = useState(false);

  if (state?.sent) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-slate-700">{t("auth.forgot.sent")}</p>
        <p className="muted text-xs">{t("auth.forgot.sentEmailNote")}</p>
        <Link href="/signin" className="link">
          {t("auth.forgot.backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onChange={(e) => setValid(e.currentTarget.checkValidity())}
      className="flex w-full flex-col gap-4"
    >
      <label className="space-y-1">
        <span className="label">{t("auth.forgot.fields.identifier")}</span>
        <input
          name="identifier"
          type="text"
          required
          autoComplete="username"
          className="input"
        />
      </label>

      <button type="submit" disabled={pending || !valid} className="btn-primary mt-1 w-full">
        {pending ? t("auth.forgot.sending") : t("auth.forgot.submit")}
      </button>
      {state?.unavailable && (
        <p role="alert" className="text-sm text-red-600">
          {t("auth.forgot.unavailable")}
        </p>
      )}
    </form>
  );
}
