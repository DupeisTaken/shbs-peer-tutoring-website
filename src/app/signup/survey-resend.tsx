"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

/** Recovery works without another survey and never changes the submission timestamp. */
export function SurveyResend({ initialEmail = "" }: { initialEmail?: string }) {
  const t = useTranslations("survey");
  const [email, setEmail] = useState(initialEmail);
  const resend = api.tutee.resendSurvey.useMutation();
  return (
    <form
      className="mt-6 space-y-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        resend.mutate({ email });
      }}
    >
      <label className="block space-y-1">
        <span className="label">{t("emailLabel")}</span>
        <input
          className="input"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <button className="btn-secondary" disabled={resend.isPending}>
        {t("resend")}
      </button>
      {resend.data && (
        <p role="status" className="muted">
          {t(resend.data.emailSent ? "resent" : "mailFailed")}
        </p>
      )}
      {resend.error && (
        <p role="alert" className="text-red-700">
          {resend.error.message}
        </p>
      )}
    </form>
  );
}
