"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { RegistrationProgress } from "~/app/_components/registration-progress";
import { Button } from "~/app/_components/ui/button";
import { FormActions } from "~/app/_components/ui/patterns";
import { SignupError } from "~/app/_components/signup-error";
import { InvitationRedemption } from "./invitation-redemption";

/** Staff keys authorize an invitation; only the subsequently emailed code proves the
 * recipient. Every role then enters the same account-review and credential editor. */
export function RegisterFlow({
  invitationId: initialInvitation,
  signedIn = false,
  viewerSignupAvailable = false,
}: {
  invitationId?: string;
  signedIn?: boolean;
  viewerSignupAvailable?: boolean;
}) {
  const t = useTranslations("accountInvitation");
  const old = useTranslations("auth.register");
  const [invitationId, setInvitationId] = useState(initialInvitation ?? "");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState(false);
  const admitted = useRef(false);
  const check = api.registration.check.useMutation({
    onSuccess: (data) => {
      setEmail(data.boundEmail ?? "");
      setChecked(true);
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const send = api.registration.sendEmailCode.useMutation({
    onSuccess: (data) => setInvitationId(data.invitationId),
    onSettled: () => {
      admitted.current = false;
    },
  });
  const busy = check.isPending || send.isPending;
  if (invitationId)
    return (
      <InvitationRedemption
        invitationId={invitationId}
        signedIn={signedIn}
        focusOnMount={!initialInvitation}
      />
    );
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || admitted.current) return;
        admitted.current = true;
        if (checked) send.mutate({ code, email });
        else check.mutate({ code });
      }}
    >
      <RegistrationProgress
        steps={[t("staffKey"), t("sendInvitation")]}
        current={checked ? 1 : 0}
        title={checked ? t("sendInvitation") : t("staffKey")}
        busy={busy}
      />
      <fieldset disabled={busy} aria-busy={busy} className="space-y-4">
        <p className="muted text-sm">{t("staffHelp")}</p>
        {checked ? (
          <label className="block">
            <span className="label">
              {t("email")}
              <FieldRequirement state="required" />
            </span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              readOnly={Boolean(check.data?.boundEmail)}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        ) : (
          <label className="block">
            <span className="label">
              {old("step.code.label")}
              <FieldRequirement state="required" />
            </span>
            <input
              className="input font-mono tracking-widest"
              autoComplete="one-time-code"
              required
              maxLength={30}
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                )
              }
            />
          </label>
        )}
        <FormActions>
          <Button type="submit">
            {t(checked ? "sendInvitation" : "checkKey")}
          </Button>
          {checked && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setChecked(false);
                check.reset();
                send.reset();
              }}
            >
              {t("back")}
            </Button>
          )}
        </FormActions>
      </fieldset>
      {(check.error ?? send.error) && (
        <p role="alert" className="text-sm text-red-700">
          <SignupError error={(check.error ?? send.error)!} />
        </p>
      )}
      <p className="muted border-t border-slate-200 pt-4 text-sm">
        {t("emailLinkHelp")}
      </p>
      {viewerSignupAvailable && (
        <Link className="link" href="/viewer-signup">
          {t("requestCode")}
        </Link>
      )}
    </form>
  );
}
