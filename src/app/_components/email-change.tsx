"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "~/trpc/react";

/** Both account surfaces use the same verified identity change instead of editing login email. */
export function EmailChange() {
  const t = useTranslations("emailChange");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const utils = api.useUtils();
  const features = api.program.features.useQuery();
  const request = api.account.requestEmailChange.useMutation({
    onSuccess: () => setPassword(""),
  });
  const confirm = api.account.confirmEmailChange.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.account.me.invalidate(),
        utils.tutor.myProfile.invalidate(),
      ]);
      setCode("");
      setEmail("");
      request.reset();
    },
  });
  return (
    <section className="card space-y-3 p-5">
      <h2 className="section-title">{t("title")}</h2>
      <p className="muted">{t("help")}</p>
      {!features.data?.EMAIL_DELIVERY_AVAILABLE && (
        <p className="muted">{t("unavailable")}</p>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          request.mutate({ email, currentPassword: password });
        }}
      >
        <label className="block space-y-1">
          <span className="label">{t("email")}</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="label">{t("password")}</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          className="btn-primary"
          disabled={
            request.isPending || !features.data?.EMAIL_DELIVERY_AVAILABLE
          }
        >
          {t("send")}
        </button>
      </form>
      {request.isSuccess && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            confirm.mutate({ code });
          }}
        >
          <label className="block space-y-1">
            <span className="label">{t("code")}</span>
            <input
              className="input"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="btn-primary" disabled={confirm.isPending}>
            {t("confirm")}
          </button>
        </form>
      )}
      {(request.error ?? confirm.error) && (
        <p role="alert" className="text-sm text-red-600">
          {request.error?.message ?? confirm.error?.message}
        </p>
      )}
      {confirm.isSuccess && <p role="status">{t("success")}</p>}
    </section>
  );
}
