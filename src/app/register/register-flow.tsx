"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  normalizeRegCode,
  normalizeRegCodeDraft,
} from "~/lib/registration-code";
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
  const normalizedInitialCode = normalizeRegCode(initialCode);
  const [invitationId, setInvitationId] = useState(
    normalizedInitialCode ? "" : (initialInvitation ?? ""),
  );
  const [proof, setProof] = useState("");
  const [code, setCode] = useState(normalizedInitialCode);
  const [legacyEntry, setLegacyEntry] = useState(
    normalizedInitialCode.length > 5,
  );
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState(false);
  const [displayedId, setDisplayedId] = useState("");
  const [boundEmail, setBoundEmail] = useState(false);
  const admitted = useRef(false);
  const settled = () => {
    admitted.current = false;
  };
  const enter = api.accountInvitation.enter.useMutation({
    onSuccess: (data) => {
      if (data.kind === "staff") {
        setEmail(data.boundEmail ?? "");
        setBoundEmail(Boolean(data.boundEmail));
        setChecked(true);
      } else if (data.proof) {
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
  const busy = enter.isPending || send.isPending || sendDisplayed.isPending;
  const error = enter.error ?? send.error ?? sendDisplayed.error;
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
        const canonicalCode = normalizeRegCode(code);
        if (checked) {
          if (displayedId)
            sendDisplayed.mutate({
              invitationId: displayedId,
              code: canonicalCode,
              email,
            });
          else send.mutate({ code: canonicalCode, email });
        } else
          enter.mutate({
            code: canonicalCode,
            ...(initialProof && canonicalCode === normalizedInitialCode
              ? { proof: initialProof }
              : {}),
          });
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
                readOnly={boundEmail}
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
              className="input w-full text-center text-2xl tracking-[0.4em] uppercase"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              placeholder="XXXXX"
              required
              minLength={5}
              maxLength={legacyEntry ? 12 : 5}
              value={code}
              onPaste={(event) => {
                // Normalize before native maxlength can truncate copied separators.
                // A legacy editor also preserves digit 1 in pasted code prefixes.
                const pasted = normalizeRegCodeDraft(
                  event.clipboardData.getData("text"),
                  legacyEntry,
                );
                if (pasted.length === 5 || /^[A-F0-9]{12}$/.test(pasted)) {
                  event.preventDefault();
                  setCode(pasted);
                  if (pasted.length === 12) setLegacyEntry(true);
                }
              }}
              onChange={(event) =>
                // Retyping a legacy receipt must not turn its digit 1 into I
                // when the draft temporarily reaches five characters.
                setCode(normalizeRegCodeDraft(event.target.value, legacyEntry))
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
              setBoundEmail(false);
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
