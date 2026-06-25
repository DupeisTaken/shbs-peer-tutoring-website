"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type Step = "code" | "email" | "emailCode" | "profile" | "done";

/**
 * Multi-step self-registration: redeem a 6-digit security key, verify email with a second emailed
 * code, then set name / grade / password. All validation + account creation happen server-side
 * (registration router); this component only drives the wizard.
 */
export function RegisterFlow() {
  const t = useTranslations();
  const [step, setStep] = useState<Step>("code");

  // Collected across steps.
  const [code, setCode] = useState("");
  const [boundEmail, setBoundEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [grade, setGrade] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [username, setUsername] = useState("");

  const check = api.registration.check.useMutation({
    onSuccess: (data) => {
      setBoundEmail(data.boundEmail);
      if (data.boundEmail) setEmail(data.boundEmail);
      if (data.firstName) setFirstName(data.firstName);
      if (data.lastName) setLastName(data.lastName);
      if (data.alternativeNames) setAltNames(data.alternativeNames);
      if (data.gradeLevel != null) setGrade(String(data.gradeLevel));
      setStep(data.emailVerified ? "profile" : "email");
    },
  });
  const sendCode = api.registration.sendEmailCode.useMutation({
    onSuccess: () => setStep("emailCode"),
  });
  const verifyEmail = api.registration.verifyEmail.useMutation({
    onSuccess: () => setStep("profile"),
  });
  const complete = api.registration.complete.useMutation({
    onSuccess: (data) => {
      setUsername(data.username);
      setStep("done");
    },
  });

  const passwordMismatch = password.length > 0 && confirm.length > 0 && password !== confirm;

  return (
    <div className="space-y-4">
      {/* Step 1 — security key */}
      {step === "code" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^[0-9A-Z]{5}$/.test(code)) check.mutate({ code });
          }}
        >
          <label className="label" htmlFor="reg-code">
            {t("auth.register.step.code.label")}
          </label>
          <input
            id="reg-code"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            maxLength={5}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 5))}
            placeholder="XXXXX"
            className="input w-full text-center text-2xl tracking-[0.4em] uppercase"
          />
          <p className="muted text-xs">{t("auth.register.step.code.help")}</p>
          {check.error && <p className="text-sm text-red-600">{check.error.message}</p>}
          <button
            className="btn-primary w-full"
            disabled={!/^[0-9A-Z]{5}$/.test(code) || check.isPending}
          >
            {t("auth.register.step.code.submit")}
          </button>
        </form>
      )}

      {/* Step 2 — email entry */}
      {step === "email" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) sendCode.mutate({ code, email: email.trim() });
          }}
        >
          <label className="label" htmlFor="reg-email">
            {t("auth.register.step.email.label")}
          </label>
          <input
            id="reg-email"
            type="email"
            value={email}
            readOnly={!!boundEmail}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.register.step.email.placeholder")}
            className="input w-full"
          />
          {boundEmail && <p className="muted text-xs">{t("auth.register.step.email.bound")}</p>}
          {sendCode.error && <p className="text-sm text-red-600">{sendCode.error.message}</p>}
          <button className="btn-primary w-full" disabled={!email.trim() || sendCode.isPending}>
            {t("auth.register.step.email.send")}
          </button>
        </form>
      )}

      {/* Step 2b — email code */}
      {step === "emailCode" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{5}$/.test(emailCode)) verifyEmail.mutate({ code, emailCode });
          }}
        >
          <p className="text-sm text-slate-700">
            {t("auth.register.step.email.sent", { email })}
          </p>
          <label className="label" htmlFor="reg-emailcode">
            {t("auth.register.step.email.codeLabel")}
          </label>
          <input
            id="reg-emailcode"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={5}
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
            placeholder="00000"
            className="input w-full text-center text-2xl tracking-[0.4em]"
          />
          {verifyEmail.error && <p className="text-sm text-red-600">{verifyEmail.error.message}</p>}
          <button
            className="btn-primary w-full"
            disabled={!/^\d{5}$/.test(emailCode) || verifyEmail.isPending}
          >
            {t("auth.register.step.email.verify")}
          </button>
          <button
            type="button"
            className="link text-sm"
            onClick={() => sendCode.mutate({ code, email: email.trim() })}
            disabled={sendCode.isPending}
          >
            {t("auth.register.step.email.resend")}
          </button>
        </form>
      )}

      {/* Step 3 — profile + password */}
      {step === "profile" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (firstName.trim() && lastName.trim() && password.length >= 8 && !passwordMismatch) {
              complete.mutate({
                code,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                alternativeNames: altNames.trim() || undefined,
                gradeLevel: grade.trim() ? Number(grade) : null,
                password,
              });
            }
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="reg-first">
                {t("auth.register.step.profile.firstName")}
              </label>
              <input
                id="reg-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="label" htmlFor="reg-last">
                {t("auth.register.step.profile.lastName")}
              </label>
              <input
                id="reg-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="input w-full"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="reg-alt">
              {t("auth.register.step.profile.altNames")}
            </label>
            <input
              id="reg-alt"
              lang="zh"
              value={altNames}
              onChange={(e) => setAltNames(e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="label" htmlFor="reg-grade">
              {t("auth.register.step.profile.grade")}
            </label>
            <input
              id="reg-grade"
              type="number"
              min={6}
              max={12}
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="label" htmlFor="reg-pass">
              {t("auth.register.step.profile.password")}
            </label>
            <input
              id="reg-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
            />
            <p className="muted text-xs">{t("auth.register.step.profile.passwordHint")}</p>
          </div>
          <div>
            <label className="label" htmlFor="reg-confirm">
              {t("auth.register.step.profile.confirm")}
            </label>
            <input
              id="reg-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input w-full"
            />
          </div>
          {passwordMismatch && (
            <p className="text-sm text-red-600">{t("auth.register.step.profile.mismatch")}</p>
          )}
          {complete.error && <p className="text-sm text-red-600">{complete.error.message}</p>}
          <button
            className="btn-primary w-full"
            disabled={
              !firstName.trim() ||
              !lastName.trim() ||
              password.length < 8 ||
              passwordMismatch ||
              complete.isPending
            }
          >
            {t("auth.register.step.profile.submit")}
          </button>
        </form>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="space-y-4 text-center">
          <p className="text-lg font-semibold text-slate-900">{t("auth.register.done.title")}</p>
          <p className="text-sm text-slate-700">
            {t("auth.register.done.body", { username })}
          </p>
          <Link href="/signin" className="btn-primary inline-block">
            {t("auth.register.done.signIn")}
          </Link>
        </div>
      )}
    </div>
  );
}
