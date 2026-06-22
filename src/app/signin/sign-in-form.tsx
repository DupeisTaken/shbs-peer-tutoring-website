"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { signInAction } from "./actions";

export function SignInForm() {
  const t = useTranslations("auth");
  const [error, formAction, pending] = useActionState(signInAction, undefined);
  const [valid, setValid] = useState(false);

  return (
    <form
      action={formAction}
      onChange={(e) => setValid(e.currentTarget.checkValidity())}
      className="flex w-full flex-col gap-4"
    >
      <label className="space-y-1">
        <span className="label">{t("identifier")}</span>
        <input
          name="identifier"
          type="text"
          required
          autoComplete="username"
          className="input"
        />
      </label>

      <label className="space-y-1">
        <span className="label">{t("password")}</span>
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

      <button type="submit" disabled={pending || !valid} className="btn-primary mt-1 w-full">
        {pending ? t("signingIn") : t("signIn")}
      </button>
    </form>
  );
}
