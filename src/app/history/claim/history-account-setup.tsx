"use client";
import {
  InvitationReceipt,
  type InvitationReceiptData,
} from "../../register/invitation-receipt";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { HistoryError } from "~/app/_components/tutee-history";
import { FieldRequirement } from "~/app/_components/field-requirement";

/** Historical mailbox verification issues the same credential invitation used elsewhere.
 * The exact staff-reviewed record stays separate and still requires an explicit claim. */
export function HistoryAccountSetup({ token }: { token: string }) {
  const t = useTranslations("tuteeHistory");
  const a = useTranslations("accountInvitation");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [invitation, setInvitation] = useState<InvitationReceiptData | null>(
    null,
  );
  const [sent, setSent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const admitted = useRef(false);
  const send = api.tuteeHistory.startAccount.useMutation({
    onSuccess: () => {
      setSent(true);
      setCode("");
      requestAnimationFrame(() => codeRef.current?.focus());
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const verify = api.tuteeHistory.verifyAccount.useMutation({
    onSuccess: setInvitation,
    onSettled: () => {
      admitted.current = false;
    },
  });
  const pending = send.isPending || verify.isPending;
  const error = send.error ?? verify.error;
  if (!/^[a-f0-9]{64}$/.test(token))
    return <HistoryError message="HISTORY_INVITATION_INVALID" />;
  if (invitation) return <InvitationReceipt invitation={invitation} />;
  return (
    <details className="card p-5">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
        {t("createAccount")}
      </summary>
      <p className="muted my-3 text-sm">{t("accountSetupHelp")}</p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || admitted.current) return;
          admitted.current = true;
          send.reset();
          verify.reset();
          if (sent) verify.mutate({ token, email, code });
          else send.mutate({ token, email });
        }}
      >
        <fieldset disabled={pending} aria-busy={pending} className="space-y-4">
          <label className="block">
            <span className="label">
              {t("email")}
              <FieldRequirement state="required" />
            </span>
            <input
              className="input"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              readOnly={sent}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {sent && (
            <label className="block">
              <span className="label">
                {t("emailCode")}
                <FieldRequirement state="required" />
              </span>
              <input
                ref={codeRef}
                className="input"
                autoComplete="one-time-code"
                required
                maxLength={30}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          )}
          <button className="btn-primary" type="submit">
            {sent ? a("verify") : a("sendVerification")}
          </button>
          {sent && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setSent(false);
                setCode("");
                verify.reset();
              }}
            >
              {a("back")}
            </button>
          )}
        </fieldset>
        {error && <HistoryError message={error.message} />}
      </form>
    </details>
  );
}
