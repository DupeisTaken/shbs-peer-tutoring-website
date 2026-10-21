"use client";
import { CodeInput } from "~/app/_components/ui/code-field";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { isEmailCodeFormat } from "~/lib/registration-code";

import { signInAction } from "./actions";

export function SignInForm({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(signInAction, {
    step: "password",
  });
  const [passwordValid, setPasswordValid] = useState(false);
  const [codeValid, setCodeValid] = useState(false);

  if (state.step === "code") {
    return (
      <form
        action={formAction}
        className="flex w-full flex-col gap-4"
      >
        <input type="hidden" name="step" value="code" />
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <input type="hidden" name="userId" value={state.userId} />
        <input type="hidden" name="email" value={state.email} />

        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-900">
            {t("twoFactor.title")}
          </h2>
          <p className="muted text-sm">
            {t("twoFactor.sent", { email: state.email })}
          </p>
        </div>

        <CodeInput
          purpose="email"
          name="code"
          disabled={pending}
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "signin-code-error" : undefined}
          onValueChange={(code) => setCodeValid(isEmailCodeFormat(code))}
        />

        {state.error && (
          <p
            id="signin-code-error"
            role="alert"
            className="text-sm text-red-600"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || !codeValid}
          className="btn-primary mt-1 w-full"
        >
          {pending ? t("twoFactor.verifying") : t("twoFactor.verify")}
        </button>

        <a
          href={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="link text-center text-sm"
        >
          {t("twoFactor.differentAccount")}
        </a>
      </form>
    );
  }

  return (
    <form
      action={formAction}
      onChange={(e) => setPasswordValid(e.currentTarget.checkValidity())}
      className="flex w-full flex-col gap-4"
    >
      <input type="hidden" name="step" value="password" />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
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

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !passwordValid}
        className="btn-primary mt-1 w-full"
      >
        {pending ? t("signingIn") : t("signIn")}
      </button>
    </form>
  );
}
