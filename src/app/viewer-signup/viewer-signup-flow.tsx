"use client";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, fullPersonName } from "~/lib/person-name";

import { SignupError } from "~/app/_components/signup-error";
import {
  useSignupCaptcha,
  CaptchaError,
} from "~/app/_components/signup-captcha";

import { FieldRequirement } from "~/app/_components/field-requirement";

import { useState } from "react";
import { Button } from "~/app/_components/ui/button";
import { FormActions } from "~/app/_components/ui/patterns";
import { RegistrationProgress } from "~/app/_components/registration-progress";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { ProfilePolicyHint } from "~/app/_components/profile-policy";
import { api } from "~/trpc/react";

type Step = "details" | "code" | "password" | "done";

/**
 * Public viewer self-registration: enter identity + email, verify an emailed code, set a
 * password. Creates a read-only VIEWER login. All validation happens server-side (viewer router).
 */
export function ViewerSignupFlow() {
  const t = useTranslations();
  const flow = useTranslations("registrationFlow");
  const [step, setStep] = useState<Step>("details");

  const [names, setNames] = useState(() => nameDraft());
  const name = fullPersonName(names);
  const [affiliation, setAffiliation] = useState("");
  const [email, setEmail] = useState("");
  const captcha = useSignupCaptcha("viewer.start", email);
  const [code, setCode] = useState("");
  const [completionProof, setCompletionProof] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const start = api.viewer.start.useMutation({
    onSuccess: () => {
      setCompletionProof("");
      setCode("");
      verify.reset();
      complete.reset();
      setStep("code");
    },
  });
  const verify = api.viewer.verify.useMutation({
    onSuccess: (data) => {
      setCompletionProof(data.completionProof);
      setStep("password");
    },
  });
  const complete = api.viewer.complete.useMutation({
    onSuccess: () => setStep("done"),
  });

  const detailsValid =
    name.trim().length > 0 &&
    affiliation.trim().length > 0 &&
    /^[^@\s]+@[^@\s]+$/.test(email.trim());
  const mismatch =
    password.length > 0 && confirm.length > 0 && password !== confirm;

  const busy =
    start.isPending ||
    verify.isPending ||
    complete.isPending ||
    captcha.pending;
  const steps: Step[] = ["details", "code", "password", "done"];
  const titles = [
    flow("identityTitle"),
    flow("verifyTitle"),
    flow("passwordTitle"),
    t("public.viewerSignup.doneTitle"),
  ];
  function returnTo(next: Step) {
    if (busy) return;
    // Details are restaged through viewer.start; a proof for the old identity
    // cannot authorize completion after editing. Password drafts stay local.
    setCompletionProof("");
    setCode("");
    start.reset();
    verify.reset();
    complete.reset();
    setStep(next);
  }

  return (
    <fieldset
      disabled={busy}
      aria-busy={busy}
      aria-label={flow("progressTitle")}
      className="min-w-0 space-y-5"
    >
      <RegistrationProgress
        steps={titles}
        current={steps.indexOf(step)}
        title={titles[steps.indexOf(step)]!}
        busy={busy}
      />
      {/* Step 1 — identity + email */}
      {step === "details" && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (detailsValid)
              void captcha.run((captchaGrant) =>
                start.mutateAsync({
                  ...names,
                  name: name.trim(),
                  affiliation: affiliation.trim(),
                  email: email.trim(),
                  captchaGrant,
                }),
              );
          }}
        >
          <PersonNameFields value={names} onChange={setNames} />
          <ProfilePolicyHint />
          <div>
            <label className="label" htmlFor="obs-aff">
              {t("public.viewerSignup.fields.affiliation")}
              <FieldRequirement state="required" />
            </label>
            <input
              id="obs-aff"
              required
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
              aria-describedby="obs-aff-hint"
              className="input w-full"
            />
            {/* Examples wrap below the field instead of being clipped in a mobile placeholder. */}
            <p
              id="obs-aff-hint"
              className="mt-2 text-xs leading-5 text-slate-500"
            >
              {t("public.viewerSignup.fields.affiliationPlaceholder")}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="obs-email">
              {t("public.viewerSignup.fields.email")}
              <FieldRequirement state="required" />
            </label>
            <input
              id="obs-email"
              required
              autoComplete="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
            />
          </div>
          {captcha.panel}
          {start.error && (
            <p role="alert" className="text-sm text-red-600">
              <CaptchaError error={start.error} />
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={!detailsValid || start.isPending || captcha.pending}
          >
            {start.isPending
              ? t("public.viewerSignup.sending")
              : t("public.viewerSignup.sendCode")}
          </Button>
        </form>
      )}

      {/* Step 2 — email code */}
      {step === "code" && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (/^[0-9A-Z]{5}$/.test(code))
              verify.mutate({ email: email.trim(), code });
          }}
        >
          <p className="text-sm text-slate-700">
            {t("public.viewerSignup.sent", { email })}
          </p>
          <label className="label" htmlFor="obs-code">
            {t("public.viewerSignup.fields.code")}
            <FieldRequirement state="required" />
          </label>
          <input
            id="obs-code"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            required
            maxLength={5}
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^0-9A-Z]/g, "")
                  .slice(0, 5),
              )
            }
            placeholder="XXXXX"
            className="input w-full text-center text-2xl tracking-[0.4em] uppercase"
          />
          {verify.error && (
            <p role="alert" className="text-sm text-red-600">
              <SignupError error={verify.error} />
            </p>
          )}
          {captcha.panel}
          {start.error && (
            <p role="alert" className="text-sm text-red-600">
              <CaptchaError error={start.error} />
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={!/^[0-9A-Z]{5}$/.test(code) || verify.isPending}
          >
            {t("public.viewerSignup.verify")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              void captcha.run((captchaGrant) =>
                start.mutateAsync({
                  ...names,
                  name: name.trim(),
                  affiliation: affiliation.trim(),
                  email: email.trim(),
                  captchaGrant,
                }),
              )
            }
            disabled={start.isPending || captcha.pending}
          >
            {t("public.viewerSignup.resend")}
          </Button>
          <FormActions>
            <Button onClick={() => returnTo("details")}>
              {flow("editIdentity")}
            </Button>
          </FormActions>
          <p className="muted text-xs">{flow("reverifyHelp")}</p>
        </form>
      )}

      {/* Step 3 — password */}
      {step === "password" && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (
              password.length >= 8 &&
              confirm === password &&
              completionProof &&
              !start.isPending &&
              !captcha.pending
            )
              complete.mutate({
                email: email.trim(),
                password,
                completionProof,
              });
          }}
        >
          <p className="rounded-lg bg-slate-50 p-3 text-sm break-words">
            {name} · {email}
          </p>
          <div>
            <label className="label" htmlFor="obs-pass">
              {t("public.viewerSignup.fields.password")}
              <FieldRequirement state="required" />
            </label>
            <input
              id="obs-pass"
              type="password"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
            />
            <p className="muted text-xs">
              {t("public.viewerSignup.passwordHint")}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="obs-confirm">
              {t("public.viewerSignup.fields.confirm")}
              <FieldRequirement state="required" />
            </label>
            <input
              id="obs-confirm"
              type="password"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input w-full"
            />
          </div>
          {mismatch && (
            <p role="alert" className="text-sm text-red-600">
              {t("public.viewerSignup.mismatch")}
            </p>
          )}
          {complete.error && (
            <p role="alert" className="text-sm text-red-600">
              <SignupError error={complete.error} />
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={
              !completionProof ||
              password.length < 8 ||
              confirm !== password ||
              start.isPending ||
              complete.isPending ||
              captcha.pending
            }
          >
            {complete.isPending
              ? t("public.viewerSignup.creating")
              : t("public.viewerSignup.createAccount")}
          </Button>
          {captcha.panel}
          {start.error && (
            <p role="alert" className="text-sm text-red-600">
              <CaptchaError error={start.error} />
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={start.isPending || complete.isPending || captcha.pending}
            onClick={() =>
              void captcha.run((captchaGrant) =>
                start.mutateAsync({
                  ...names,
                  name: name.trim(),
                  affiliation: affiliation.trim(),
                  email: email.trim(),
                  captchaGrant,
                }),
              )
            }
          >
            {t("public.viewerSignup.resend")}
          </Button>
          <FormActions>
            <Button onClick={() => returnTo("details")}>
              {flow("editIdentity")}
            </Button>
          </FormActions>
          <p className="muted text-xs">{flow("reverifyHelp")}</p>
        </form>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-slate-700">
            {t("public.viewerSignup.doneBody")}
          </p>
          <Link href="/signin" className="btn-primary inline-block">
            {t("public.viewerSignup.signIn")}
          </Link>
        </div>
      )}
    </fieldset>
  );
}
