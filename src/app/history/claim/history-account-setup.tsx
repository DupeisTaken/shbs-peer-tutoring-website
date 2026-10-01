"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { HistoryError } from "~/app/_components/tutee-history";
import { FieldRequirement } from "~/app/_components/field-requirement";

/** Credentials and verification proofs live only in this mounted form, never browser storage.
 * A failed request preserves the draft; only successful setup clears the password. */
export function HistoryAccountSetup({ token }: { token: string }) {
  const t = useTranslations("tuteeHistory");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [proof, setProof] = useState("");
  const [sent, setSent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const send = api.tuteeHistory.startAccount.useMutation({
    onSuccess: () => {
      setSent(true);
      setProof("");
      setCode("");
      requestAnimationFrame(() => codeRef.current?.focus());
    },
  });
  const verify = api.tuteeHistory.verifyAccount.useMutation({
    onSuccess: (data) => {
      setProof(data.completionProof);
      requestAnimationFrame(() => passwordRef.current?.focus());
    },
  });
  const complete = api.tuteeHistory.completeAccount.useMutation({
    onSuccess: () => setPassword(""),
  });
  const pending = send.isPending || verify.isPending || complete.isPending;
  const error = send.error ?? verify.error ?? complete.error;
  function clearErrors() {
    send.reset();
    verify.reset();
    complete.reset();
  }
  if (!/^[a-f0-9]{64}$/.test(token))
    return <HistoryError message="HISTORY_INVITATION_INVALID" />;
  if (complete.isSuccess)
    return (
      <section className="card space-y-4 p-5" aria-live="polite">
        <h2 className="font-semibold">{t("accountReady")}</h2>
        <p>{t("accountReadyHelp")}</p>
        <Link
          className="btn-primary min-h-11 lg:min-h-10"
          href={`/signin?callbackUrl=${encodeURIComponent(`/history/claim?token=${token}`)}`}
        >
          {t("signIn")}
        </Link>
      </section>
    );
  return (
    <details className="card p-5">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
        {t("createAccount")}
      </summary>
      <p className="muted my-3 text-sm">{t("accountSetupHelp")}</p>
      <form
        className="space-y-4"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          clearErrors();
          if (proof)
            complete.mutate({ token, email, password, completionProof: proof });
          else if (sent) verify.mutate({ token, email, code });
          else send.mutate({ token, email });
        }}
      >
        <label className="block">
          <span className="label">
            {t("email")}
            <FieldRequirement state="required" />
          </span>
          <input
            className="input min-h-11 w-full lg:min-h-10"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            disabled={pending || sent}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {sent && !proof && (
          <label className="block">
            <span className="label">
              {t("emailCode")}
              <FieldRequirement state="required" />
            </span>
            <input
              ref={codeRef}
              className="input min-h-11 w-full lg:min-h-10"
              autoComplete="one-time-code"
              required
              maxLength={30}
              value={code}
              disabled={pending}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        )}
        {proof && (
          <>
            <label className="block">
              <span className="label">
                {t("newPassword")}
                <FieldRequirement state="required" />
              </span>
              <input
                ref={passwordRef}
                className="input min-h-11 w-full lg:min-h-10"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={200}
                disabled={pending}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                required
                disabled={pending}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t("accountConfirm")}
            </label>
          </>
        )}
        {error && <HistoryError message={error.message} />}
        {pending && <p role="status">{t("loading")}</p>}
        <div className="flex flex-wrap gap-3">
          <button
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={pending || (!!proof && !confirmed)}
          >
            {t(proof ? "createAccount" : sent ? "verifyCode" : "sendCode")}
          </button>
          {sent && !proof && (
            <button
              type="button"
              className="btn-secondary min-h-11 lg:min-h-10"
              disabled={pending}
              onClick={() => {
                clearErrors();
                send.mutate({ token, email });
              }}
            >
              {t("resendCode")}
            </button>
          )}
          {proof && (
            <button
              type="button"
              className="btn-secondary min-h-11 lg:min-h-10"
              disabled={pending}
              onClick={() => {
                clearErrors();
                setProof("");
                setCode("");
                setConfirmed(false);
              }}
            >
              {t("verifyAgain")}
            </button>
          )}
        </div>
        {sent && !proof && <p className="muted text-sm">{t("codeHelp")}</p>}
      </form>
    </details>
  );
}
