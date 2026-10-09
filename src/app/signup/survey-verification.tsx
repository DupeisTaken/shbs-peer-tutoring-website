"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Button } from "~/app/_components/ui/button";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { SignupError } from "~/app/_components/signup-error";
import { InvitationReceipt } from "../register/invitation-receipt";
import {
  useSignupCaptcha,
  CaptchaError,
} from "~/app/_components/signup-captcha";

/** The application is already saved. Only mailbox verification is retried here. */
export function SurveyVerification({ email }: { email: string }) {
  const t = useTranslations("accountInvitation");
  const survey = useTranslations("survey");
  const [code, setCode] = useState("");
  const admitted = useRef(false);
  const captcha = useSignupCaptcha("tutee.resend", email);
  const resend = api.tutee.resendSurvey.useMutation();
  const verify = api.accountInvitation.verifySurvey.useMutation({
    onSettled: () => {
      admitted.current = false;
    },
  });
  // Verification and resend own the same challenge. One shared admission boundary
  // prevents a resend rotating the source while verification issues its receipt.
  const busy = verify.isPending || resend.isPending || captcha.pending;
  if (verify.data) return <InvitationReceipt invitation={verify.data} />;
  return (
    <div className="mx-auto max-w-md space-y-5 text-left">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (admitted.current || busy) return;
          admitted.current = true;
          verify.mutate({ email, code });
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          <label className="block">
            <span className="label">
              {t("verificationCode")}
              <FieldRequirement state="required" />
            </span>
            <input
              className="input text-center font-mono text-xl tracking-widest"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </label>
          <Button type="submit" variant="primary" className="w-full">
            {t("verify")}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              if (busy || admitted.current) return;
              admitted.current = true;
              void captcha
                .run((captchaGrant) =>
                  resend.mutateAsync({ email, captchaGrant }),
                )
                .finally(() => {
                  admitted.current = false;
                });
            }}
          >
            {survey("resend")}
          </Button>
        </fieldset>
        {captcha.panel}
        {verify.error && (
          <p role="alert" className="text-sm text-red-700">
            <SignupError error={verify.error} />
          </p>
        )}
      </form>
      {resend.data && (
        <p role="status" className="muted text-sm">
          {survey(resend.data.emailSent ? "resent" : "mailFailed")}
        </p>
      )}
      {resend.error && (
        <p role="alert" className="text-sm text-red-700">
          <CaptchaError error={resend.error} />
        </p>
      )}
    </div>
  );
}
