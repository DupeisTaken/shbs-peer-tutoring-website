"use client";
import { useSignupCaptcha, CaptchaError } from "~/app/_components/signup-captcha";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

/** Recovery works without another survey and never changes the submission timestamp. */
export function SurveyResend({ initialEmail = "" }: { initialEmail?: string }) {
  const t = useTranslations("survey");
  const [email, setEmail] = useState(initialEmail);
  const captcha = useSignupCaptcha("tutee.resend", email);
  const resend = api.tutee.resendSurvey.useMutation();
  return (
    <form
      className="mt-6 space-y-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void captcha.run(captchaGrant => resend.mutateAsync({ email, captchaGrant }));
      }}
    >
      <label className="block space-y-1">
        <span className="label">{t("emailLabel")}</span>
        <input
          className="input min-h-11 lg:min-h-10"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {captcha.panel}
      <button
        className="btn-secondary min-h-11 lg:min-h-10"
        disabled={resend.isPending || captcha.pending}
      >
        {t("resend")}
      </button>
      {resend.data && (
        <p role="status" className="muted">
          {t(resend.data.emailSent ? "resent" : "mailFailed")}
        </p>
      )}
      {resend.error && (
        <p role="alert" className="text-red-700">
          <CaptchaError error={resend.error} />
        </p>
      )}
    </form>
  );
}
