"use client";
import { isEmailCodeFormat } from "~/lib/registration-code";
import { CodeInput } from "~/app/_components/ui/code-field";
import {
  ConfiguredPersonNameFields as PersonNameFields,
  useNameFieldPresentation,
} from "~/app/_components/person-name-fields";
import { nameDraft, fullPersonName } from "~/lib/person-name";

import { SignupError } from "~/app/_components/signup-error";
import {
  useSignupCaptcha,
  CaptchaError,
} from "~/app/_components/signup-captcha";

import { FieldRequirement } from "~/app/_components/field-requirement";

import { useRef, useState } from "react";
import { Button } from "~/app/_components/ui/button";
import { FormActions } from "~/app/_components/ui/patterns";
import { RegistrationProgress } from "~/app/_components/registration-progress";
import {
  InvitationReceipt,
  type InvitationReceiptData,
} from "../register/invitation-receipt";
import { useTranslations } from "next-intl";

import { ProfilePolicyHint } from "~/app/_components/profile-policy";
import { api } from "~/trpc/react";

type Step = "details" | "code";

/**
 * Public identity request and mailbox verification. A separate recipient invitation then
 * enters the shared account flow; an established account receives sign-in only.
 */
export function ViewerSignupFlow(_props: { signedIn?: boolean }) {
  const t = useTranslations();
  const flow = useTranslations("registrationFlow");
  const [step, setStep] = useState<Step>("details");

  const [names, setNames] = useState(() => nameDraft());
  const {
    ready: namePolicyReady,
    hasLatinFields,
    observe: observeNamePolicy,
  } = useNameFieldPresentation();
  const name = fullPersonName(names);
  const [affiliation, setAffiliation] = useState("");
  const [email, setEmail] = useState("");
  const captcha = useSignupCaptcha("viewer.start", email);
  const [code, setCode] = useState("");
  const [invitationId, setInvitationId] = useState("");
  const [receipt, setReceipt] = useState<InvitationReceiptData | null>(null);
  const verifying = useRef(false);

  const start = api.viewer.start.useMutation({
    onSuccess: () => {
      setInvitationId("");
      setReceipt(null);
      setCode("");
      verify.reset();
      setStep("code");
    },
  });
  const verify = api.viewer.verify.useMutation({
    onSuccess: (data) => {
      setInvitationId(data.invitationId);
      setReceipt(data);
    },
    onSettled: () => {
      verifying.current = false;
    },
  });

  const detailsValid =
    namePolicyReady &&
    affiliation.trim().length > 0 &&
    /^[^@\s]+@[^@\s]+$/.test(email.trim());

  const busy = start.isPending || verify.isPending || captcha.pending;
  const steps: Step[] = ["details", "code"];
  const titles = [flow("identityTitle"), flow("verifyTitle")];
  function returnTo(next: Step) {
    if (busy) return;
    // Details are restaged through viewer.start; a proof for the old identity
    // cannot authorize completion after editing.
    setInvitationId("");
    setReceipt(null);
    setCode("");
    start.reset();
    verify.reset();
    setStep(next);
  }
  function sendIdentityCode() {
    if (busy || !detailsValid) return;
    void captcha.run((captchaGrant) =>
      start.mutateAsync({
        ...names,
        name: name.trim(),
        affiliation: affiliation.trim(),
        email: email.trim(),
        captchaGrant,
      }),
    );
  }

  if (invitationId && receipt)
    return <InvitationReceipt invitation={receipt} />;
  return (
    <div className="space-y-5">
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
              sendIdentityCode();
            }}
          >
            <PersonNameFields
              onPolicyAvailabilityChange={observeNamePolicy}
              accountType="VIEWER"
              value={names}
              onChange={setNames}
            />
            {hasLatinFields && <ProfilePolicyHint />}
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
              if (busy || verifying.current) return;
              if (isEmailCodeFormat(code)) {
                verifying.current = true;
                verify.mutate({ email: email.trim(), code });
              }
            }}
          >
            <p className="text-sm text-slate-700">
              {t("public.viewerSignup.sent", { email })}
            </p>
            <CodeInput
              id="obs-code"
              purpose="email"
              value={code}
              onValueChange={setCode}
              aria-invalid={Boolean(verify.error)}
              aria-describedby={
                verify.error ? "viewer-verification-error" : undefined
              }
            />
            {verify.error && (
              <p
                role="alert"
                id="viewer-verification-error"
                className="text-sm text-red-600"
              >
                <SignupError error={verify.error} />
              </p>
            )}
            {start.error && (
              <p role="alert" className="text-sm text-red-600">
                <CaptchaError error={start.error} />
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={!isEmailCodeFormat(code) || verify.isPending}
            >
              {t("public.viewerSignup.verify")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={sendIdentityCode}
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
      </fieldset>
      {/* The staged identity stays frozen while the challenge remains operable.
        One panel serves identity submission and both resend locations. */}
      {captcha.panel}
    </div>
  );
}
