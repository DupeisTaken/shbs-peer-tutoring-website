"use client";
import { CodeInput } from "~/app/_components/ui/code-field";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Button } from "~/app/_components/ui/button";
import { SignupError } from "~/app/_components/signup-error";
import { InvitationReceipt } from "../register/invitation-receipt";
import {
  useSignupCaptcha,
  CaptchaError,
} from "~/app/_components/signup-captcha";

/** The application is already saved. Only mailbox verification is retried here. */
export function SurveyVerification({
  email,
  intentId,
}: {
  email: string;
  intentId?: string;
}) {
  const t = useTranslations("accountInvitation");
  const survey = useTranslations("survey");
  const utils = api.useUtils();
  const [code, setCode] = useState("");
  const admitted = useRef(false);
  const captcha = useSignupCaptcha("tutee.resend", email);
  const resend = api.tutee.resendSurvey.useMutation();
  const verify = api.accountInvitation.verifySurvey.useMutation({
    onSuccess: () => {
      // Discard the old eligible snapshot so returning to the portal cannot flash
      // its shortcut while the authoritative post-confirmation read is pending.
      void utils.studentWorkflow.continuationStatus
        .reset()
        .catch(() => undefined);
    },
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
          verify.mutate({ email, code, ...(intentId ? { intentId } : {}) });
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          <CodeInput
            purpose="email"
            value={code}
            onValueChange={setCode}
            aria-invalid={Boolean(verify.error)}
            aria-describedby={
              verify.error ? "survey-verification-error" : undefined
            }
          />
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
                  resend.mutateAsync({
                    email,
                    captchaGrant,
                    ...(intentId ? { intentId } : {}),
                  }),
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
          <p
            role="alert"
            id="survey-verification-error"
            className="text-sm text-red-700"
          >
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
