"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { RegistrationProgress } from "~/app/_components/registration-progress";
import { Button } from "~/app/_components/ui/button";
import { SignupError } from "~/app/_components/signup-error";
import { InvitationRedemption } from "./invitation-redemption";

/** A recipient handoff skips repeated mailbox verification; an authorization code alone cannot. */
export function RegisterFlow({
  invitationId: initialInvitation,
  initialCode = "",
  initialProof = "",
  signedIn = false,
}: {
  invitationId?: string;
  initialCode?: string;
  initialProof?: string;
  signedIn?: boolean;
  viewerSignupAvailable?: boolean;
}) {
  const t = useTranslations("accountInvitation");
  const [invitationId, setInvitationId] = useState(
    initialCode ? "" : (initialInvitation ?? ""),
  );
  const [proof, setProof] = useState("");
  const [code, setCode] = useState(initialCode);
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState(false);
  const [displayedId, setDisplayedId] = useState("");
  const admitted = useRef(false);
  const settled = () => {
    admitted.current = false;
  };
  const check = api.registration.check.useMutation({
    onSuccess: (data) => {
      setEmail(data.boundEmail ?? "");
      setChecked(true);
    },
    onSettled: settled,
  });
  const enter = api.accountInvitation.enter.useMutation({
    onSuccess: (data) => {
      if (data.proof) {
        setProof(data.proof);
        setInvitationId(data.invitationId);
      } else {
        setDisplayedId(data.invitationId);
        setChecked(true);
      }
    },
    onSettled: settled,
  });
  const send = api.registration.sendEmailCode.useMutation({
    onSuccess: (data) => setInvitationId(data.invitationId),
    onSettled: settled,
  });
  const sendDisplayed = api.accountInvitation.sendVerification.useMutation({
    onSuccess: (data) => setInvitationId(data.invitationId),
    onSettled: settled,
  });
  const busy =
    check.isPending ||
    enter.isPending ||
    send.isPending ||
    sendDisplayed.isPending;
  const error = check.error ?? enter.error ?? send.error ?? sendDisplayed.error;
  if (invitationId)
    return (
      <InvitationRedemption
        invitationId={invitationId}
        signedIn={signedIn}
        initialProof={proof}
        initialEmail={email}
        onBack={() => {
          setInvitationId("");
          setProof("");
        }}
        focusOnMount
      />
    );
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || admitted.current) return;
        admitted.current = true;
        if (checked) {
          if (displayedId)
            sendDisplayed.mutate({ invitationId: displayedId, code, email });
          else send.mutate({ code, email });
        } else if (code.length > 5)
          enter.mutate({
            code,
            ...(initialProof && code === initialCode
              ? { proof: initialProof }
              : {}),
          });
        else check.mutate({ code });
      }}
    >
      {checked && (
        <RegistrationProgress
          steps={[t("code"), t("email"), t("reviewTitle")]}
          current={1}
          title={t("emailTitle")}
          busy={busy}
          focusOnMount
        />
      )}
      <fieldset disabled={busy} aria-busy={busy} className="space-y-5">
        {checked ? (
          <>
            <p className="muted text-sm">{t("verifyEmailHelp")}</p>
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
          </>
        ) : (
          <label className="block">
            <span className="label">
              {t("code")}
              <FieldRequirement state="required" />
            </span>
            <input
              className="input w-full text-center font-mono text-2xl tracking-[0.2em] uppercase"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              placeholder="XXXXX"
              required
              maxLength={12}
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                )
              }
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            <SignupError error={error} />
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full">
          {t(checked ? "sendVerification" : "continue")}
        </Button>
        {checked && (
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => {
              setChecked(false);
              setDisplayedId("");
              check.reset();
              enter.reset();
              send.reset();
              sendDisplayed.reset();
            }}
          >
            {t("back")}
          </Button>
        )}
      </fieldset>
    </form>
  );
}
