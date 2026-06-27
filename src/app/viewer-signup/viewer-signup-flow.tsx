"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type Step = "details" | "code" | "password" | "done";

/**
 * Public viewer self-registration: enter identity + email, verify an emailed code, set a
 * password. Creates a read-only VIEWER login. All validation happens server-side (viewer router).
 */
export function ViewerSignupFlow() {
  const t = useTranslations();
  const [step, setStep] = useState<Step>("details");

  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const start = api.viewer.start.useMutation({ onSuccess: () => setStep("code") });
  const verify = api.viewer.verify.useMutation({ onSuccess: () => setStep("password") });
  const complete = api.viewer.complete.useMutation({ onSuccess: () => setStep("done") });

  const detailsValid =
    name.trim().length > 0 && affiliation.trim().length > 0 && /^[^@\s]+@[^@\s]+$/.test(email.trim());
  const mismatch = password.length > 0 && confirm.length > 0 && password !== confirm;

  return (
    <div className="card space-y-4 p-6">
      {/* Step 1 — identity + email */}
      {step === "details" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (detailsValid)
              start.mutate({ name: name.trim(), affiliation: affiliation.trim(), email: email.trim() });
          }}
        >
          <div>
            <label className="label" htmlFor="obs-name">
              {t("public.viewerSignup.fields.name")}
            </label>
            <input id="obs-name" value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="label" htmlFor="obs-aff">
              {t("public.viewerSignup.fields.affiliation")}
            </label>
            <input
              id="obs-aff"
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
              placeholder={t("public.viewerSignup.fields.affiliationPlaceholder")}
              className="input w-full"
            />
          </div>
          <div>
            <label className="label" htmlFor="obs-email">
              {t("public.viewerSignup.fields.email")}
            </label>
            <input
              id="obs-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
            />
          </div>
          {start.error && <p className="text-sm text-red-600">{start.error.message}</p>}
          <button className="btn-primary w-full" disabled={!detailsValid || start.isPending}>
            {start.isPending ? t("public.viewerSignup.sending") : t("public.viewerSignup.sendCode")}
          </button>
        </form>
      )}

      {/* Step 2 — email code */}
      {step === "code" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^[0-9A-Z]{5}$/.test(code)) verify.mutate({ email: email.trim(), code });
          }}
        >
          <p className="text-sm text-slate-700">{t("public.viewerSignup.sent", { email })}</p>
          <label className="label" htmlFor="obs-code">
            {t("public.viewerSignup.fields.code")}
          </label>
          <input
            id="obs-code"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            maxLength={5}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 5))}
            placeholder="XXXXX"
            className="input w-full text-center text-2xl tracking-[0.4em] uppercase"
          />
          {verify.error && <p className="text-sm text-red-600">{verify.error.message}</p>}
          <button className="btn-primary w-full" disabled={!/^[0-9A-Z]{5}$/.test(code) || verify.isPending}>
            {t("public.viewerSignup.verify")}
          </button>
          <button
            type="button"
            className="link text-sm"
            onClick={() => start.mutate({ name: name.trim(), affiliation: affiliation.trim(), email: email.trim() })}
            disabled={start.isPending}
          >
            {t("public.viewerSignup.resend")}
          </button>
        </form>
      )}

      {/* Step 3 — password */}
      {step === "password" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length >= 8 && !mismatch) complete.mutate({ email: email.trim(), password });
          }}
        >
          <div>
            <label className="label" htmlFor="obs-pass">
              {t("public.viewerSignup.fields.password")}
            </label>
            <input
              id="obs-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
            />
            <p className="muted text-xs">{t("public.viewerSignup.passwordHint")}</p>
          </div>
          <div>
            <label className="label" htmlFor="obs-confirm">
              {t("public.viewerSignup.fields.confirm")}
            </label>
            <input
              id="obs-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input w-full"
            />
          </div>
          {mismatch && <p className="text-sm text-red-600">{t("public.viewerSignup.mismatch")}</p>}
          {complete.error && <p className="text-sm text-red-600">{complete.error.message}</p>}
          <button className="btn-primary w-full" disabled={password.length < 8 || mismatch || complete.isPending}>
            {complete.isPending ? t("public.viewerSignup.creating") : t("public.viewerSignup.createAccount")}
          </button>
        </form>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="space-y-4 text-center">
          <p className="text-lg font-semibold text-slate-900">{t("public.viewerSignup.doneTitle")}</p>
          <p className="text-sm text-slate-700">{t("public.viewerSignup.doneBody")}</p>
          <Link href="/signin" className="btn-primary inline-block">
            {t("public.viewerSignup.signIn")}
          </Link>
        </div>
      )}
    </div>
  );
}
