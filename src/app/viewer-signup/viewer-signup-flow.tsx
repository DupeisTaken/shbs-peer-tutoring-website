"use client";
import { PersonNameFields } from "~/app/_components/person-name-fields";
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
import { InvitationRedemption } from "../register/invitation-redemption";
import { useTranslations } from "next-intl";

import { ProfilePolicyHint } from "~/app/_components/profile-policy";
import { api } from "~/trpc/react";

type Step = "details" | "code";

/**
 * Public identity request and mailbox verification. A separate recipient invitation then
 * enters the shared account flow; an established account receives sign-in only.
 */
export function ViewerSignupFlow({ signedIn = false }: { signedIn?: boolean }) {
  const t = useTranslations();
  const flow = useTranslations("registrationFlow");
  const [step, setStep] = useState<Step>("details");

  const [names, setNames] = useState(() => nameDraft());
  const name = fullPersonName(names);
  const [affiliation, setAffiliation] = useState("");
  const [email, setEmail] = useState("");
  const captcha = useSignupCaptcha("viewer.start", email);
  const [code, setCode] = useState("");
  const [invitationId, setInvitationId] = useState("");
  const verifying = useRef(false);

  const start = api.viewer.start.useMutation({
    onSuccess: () => {
      setInvitationId("");
      setCode("");
      verify.reset();
      setStep("code");
    },
  });
  const verify = api.viewer.verify.useMutation({
    onSuccess: (data) => {
      setInvitationId(data.invitationId);
    },
    onSettled: () => {
      verifying.current = false;
    },
  });

  const detailsValid =
    name.trim().length > 0 &&
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

  if (invitationId)
    return (
      <InvitationRedemption
        invitationId={invitationId}
        signedIn={signedIn}
        focusOnMount
      />
    );
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
              if (/^[0-9A-Z]{5}$/.test(code)) {
                verifying.current = true;
                verify.mutate({ email: email.trim(), code });
              }
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
