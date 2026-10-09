"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/app/_components/ui/button";
import {
  FormActions,
  FormSection,
  InlineNotice,
} from "~/app/_components/ui/patterns";
import { SectionTabs } from "~/app/_components/ui/section-tabs";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { RegistrationProgress } from "~/app/_components/registration-progress";
import {
  CaptchaError,
  useSignupCaptcha,
} from "~/app/_components/signup-captcha";
import {
  useProfilePolicy,
  ProfilePolicyHint,
  OfferedGradeSelect,
} from "~/app/_components/profile-policy";
import { InvitationReceipt } from "../register/invitation-receipt";
import { nameDraft, fullPersonName } from "~/lib/person-name";
import { normalizeRegCode } from "~/lib/registration-code";
import { api, type RouterOutputs } from "~/trpc/react";

type Mode = "new" | "existing";
type Step = "details" | "code" | "status";
type CrewStatus = RouterOutputs["crew"]["verifyApplication"];
type FormError = {
  message: string;
  data?: { retryAfterSeconds?: number | null } | null;
};

/** Verification submits a staged application for review; only an approved grant
 * yields a receipt. Checking existing applications also proves mailbox ownership. */
export function CrewSignupForm() {
  const t = useTranslations("public.crewSignup");
  const shared = useTranslations();
  const policy = useProfilePolicy();
  const [mode, setMode] = useState<Mode>("new");
  const [step, setStep] = useState<Step>("details");
  const [names, setNames] = useState(() => nameDraft());
  const [applicationEmail, setApplicationEmail] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [grade, setGrade] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [challengeEmail, setChallengeEmail] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<CrewStatus | null>(null);
  const [proofStale, setProofStale] = useState(false);
  const [receiptUsable, setReceiptUsable] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [working, setWorking] = useState(false);
  const admitted = useRef(false);
  const email = mode === "new" ? applicationEmail : lookupEmail;
  const captcha = useSignupCaptcha(
    step === "details" && mode === "new" ? "crew.submit" : "crew.status",
    step === "details" ? email : challengeEmail,
  );
  const apply = api.crew.submitApplication.useMutation();
  const request = api.crew.requestStatus.useMutation();
  const verify = api.crew.verifyApplication.useMutation();
  const refresh = api.crew.applicationStatus.useMutation();
  const busy = working || captcha.pending;
  const name = fullPersonName(names);
  const validEmail = /^[^@\s]+@[^@\s]+$/.test(email.trim());
  const valid =
    validEmail &&
    (mode === "existing" ||
      ((!grade || policy.offeredGrades.includes(Number(grade))) &&
        name.trim().length > 0));

  function failed(failure: unknown) {
    const next =
      failure instanceof Error
        ? (failure as FormError)
        : { message: "SIGNUP_CREW_INVALID" };
    setError(next);
    if (next.message === "SIGNUP_CREW_INVALID") setProofStale(true);
  }

  /** One admission lock covers every operation before React rerenders. CAPTCHA
   * remains outside disabled fieldsets and separately owns its captured intent. */
  async function perform(
    work: (grant?: string) => Promise<unknown>,
    protectedSend = false,
  ) {
    if (admitted.current || busy) return;
    admitted.current = true;
    setWorking(true);
    setError(null);
    setReceiptUsable(false);
    const attempt = async (grant?: string) => {
      try {
        await work(grant);
      } catch (failure) {
        failed(failure);
      }
    };
    try {
      if (protectedSend) await captcha.run(attempt);
      else await attempt();
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  }

  function received(next: CrewStatus) {
    setResult(next);
    setProofStale(false);
    setReceiptUsable(true);
    setStep("status");
  }

  function edit(nextMode = mode) {
    if (admitted.current || busy) return;
    setMode(nextMode);
    setStep("details");
    setCode("");
    setResult(null);
    setProofStale(true);
    setReceiptUsable(false);
    setError(null);
  }

  async function send() {
    if (!valid) return;
    const recipient = email.trim().toLowerCase();
    await perform(async (captchaGrant) => {
      if (mode === "new") {
        await apply.mutateAsync({
          ...names,
          name: name.trim(),
          email: recipient,
          gradeLevel: grade.trim() ? Number(grade) : null,
          preferredContact: contact.trim() || undefined,
          message: message.trim() || undefined,
          captchaGrant,
        });
      } else await request.mutateAsync({ email: recipient, captchaGrant });
      setChallengeEmail(recipient);
      setCode("");
      setResult(null);
      setProofStale(true);
      setStep("code");
    }, true);
  }

  async function resend() {
    if (admitted.current || busy) return;
    // A resend may invalidate the proof before delivery fails. Cached status can
    // stay visible, but its old receipt/proof must no longer authorize actions.
    setProofStale(true);
    await perform(async (captchaGrant) => {
      await request.mutateAsync({
        email: challengeEmail,
        captchaGrant,
        resend: true,
      });
      setCode("");
      setResult(null);
      setStep("code");
    }, true);
  }

  const current = step === "details" ? 0 : step === "code" ? 1 : 2;
  const steps = [t("steps.application"), t("steps.email"), t("steps.review")];
  const acceptedState =
    result?.status === "ACCEPTED"
      ? (result.invitationState ?? "UNAVAILABLE")
      : null;
  const statusKey = acceptedState ?? result?.status ?? "PENDING";
  const receipt =
    result?.status === "ACCEPTED" &&
    acceptedState === "AVAILABLE" &&
    receiptUsable &&
    !proofStale &&
    !busy
      ? result.invitation
      : undefined;

  return (
    <div className="card space-y-5 p-6">
      <RegistrationProgress
        steps={steps}
        current={current}
        title={
          step === "details"
            ? t("detailsTitle")
            : step === "code"
              ? t("verifyTitle")
              : t("statusTitle")
        }
        busy={busy}
      />
      {step === "details" && (
        <fieldset disabled={busy} className="min-w-0">
          <SectionTabs<Mode>
            label={t("modeLabel")}
            value={mode}
            onChange={edit}
            items={[
              { value: "new", label: t("newApplication") },
              { value: "existing", label: t("checkApplication") },
            ]}
          >
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              {mode === "existing" && (
                <p className="muted">{t("lookupHint")}</p>
              )}
              <FormSection
                title={shared("signupSections.identityTitle")}
                busy={busy}
              >
                {mode === "new" && (
                  <>
                    <PersonNameFields value={names} onChange={setNames} />
                    <ProfilePolicyHint />
                  </>
                )}
                <div>
                  <label className="label" htmlFor="crew-email">
                    {t("fields.email")}
                    <FieldRequirement state="required" />
                  </label>
                  <input
                    id="crew-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(event) =>
                      mode === "new"
                        ? setApplicationEmail(event.target.value)
                        : setLookupEmail(event.target.value)
                    }
                    className="input w-full"
                  />
                </div>
                {mode === "new" && (
                  <>
                    <div>
                      <label className="label" htmlFor="crew-grade">
                        {t("fields.grade")}
                        <FieldRequirement state="optional" />
                      </label>
                      <OfferedGradeSelect
                        id="crew-grade"
                        value={grade}
                        onChange={setGrade}
                        offeredGrades={policy.offeredGrades}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="crew-contact">
                        {t("fields.contact")}
                        <FieldRequirement state="optional" />
                      </label>
                      <input
                        id="crew-contact"
                        value={contact}
                        maxLength={200}
                        onChange={(event) => setContact(event.target.value)}
                        className="input w-full"
                      />
                    </div>
                  </>
                )}
              </FormSection>
              {mode === "new" && (
                <FormSection
                  title={shared("signupSections.applicationTitle")}
                  busy={busy}
                >
                  <div>
                    <label className="label" htmlFor="crew-message">
                      {t("fields.message")}
                      <FieldRequirement state="optional" />
                    </label>
                    <textarea
                      id="crew-message"
                      rows={3}
                      value={message}
                      maxLength={1000}
                      onChange={(event) => setMessage(event.target.value)}
                      className="textarea w-full"
                    />
                  </div>
                </FormSection>
              )}
              <FormActions>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={!valid || busy}
                >
                  {busy
                    ? t("submitting")
                    : mode === "new"
                      ? t("submit")
                      : t("sendCode")}
                </Button>
              </FormActions>
            </form>
          </SectionTabs>
        </fieldset>
      )}
      {step === "code" && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length !== 5) return;
            void perform(async () =>
              received(
                await verify.mutateAsync({
                  email: challengeEmail,
                  code: normalizeRegCode(code),
                }),
              ),
            );
          }}
        >
          {/* Long mailbox addresses remain complete and wrap at enlarged text sizes. */}
          <p className="muted min-w-0 [overflow-wrap:anywhere]">
            {t("sent", { email: challengeEmail })}
          </p>
          <p className="muted text-sm">{t("verifyHint")}</p>
          <FormSection title={t("emailCode")} busy={busy}>
            <div>
              <label className="label" htmlFor="crew-code">
                {t("emailCode")}
                <FieldRequirement state="required" />
              </label>
              <input
                id="crew-code"
                className="input w-full font-mono uppercase"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                required
                minLength={5}
                maxLength={5}
                value={code}
                onChange={(event) =>
                  setCode(normalizeRegCode(event.target.value))
                }
                onPaste={(event) => {
                  event.preventDefault();
                  setCode(
                    normalizeRegCode(event.clipboardData.getData("text")).slice(
                      0,
                      5,
                    ),
                  );
                }}
              />
            </div>
          </FormSection>
          <FormActions>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || code.length !== 5}
            >
              {t("verify")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void resend()}>
              {t("resend")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => edit()}>
              {t("editDetails")}
            </Button>
          </FormActions>
        </form>
      )}
      {step === "status" && result && (
        <div className="space-y-4">
          <p className="muted min-w-0 text-sm [overflow-wrap:anywhere]">
            {challengeEmail}
          </p>
          <InlineNotice
            tone={
              statusKey === "AVAILABLE"
                ? "success"
                : statusKey === "PENDING"
                  ? "info"
                  : "warning"
            }
          >
            <p className="font-semibold">{t(`statuses.${statusKey}.title`)}</p>
            <p className="mt-1">{t(`statuses.${statusKey}.body`)}</p>
          </InlineNotice>
          {result.status === "PENDING" && (
            <p className="muted text-sm">
              {shared("public.applicationRetryNotice")}
            </p>
          )}
          {proofStale && <p className="muted text-sm">{t("proofExpired")}</p>}
          {receipt && (
            <InvitationReceipt
              key={receipt.invitationId}
              invitation={receipt}
            />
          )}
          {acceptedState === "USED" && (
            <Link
              className="text-link inline-flex min-h-11 items-center"
              href="/signin"
            >
              {t("signIn")}
            </Link>
          )}
          <FormActions>
            {!proofStale && (
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => {
                  void perform(async () =>
                    received(
                      await refresh.mutateAsync({
                        email: challengeEmail,
                        statusProof: result.statusProof,
                      }),
                    ),
                  );
                }}
              >
                {t("refreshStatus")}
              </Button>
            )}
            <Button type="button" disabled={busy} onClick={() => void resend()}>
              {t("verifyAgain")}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => edit(result.status === "NOT_FOUND" ? "new" : mode)}
            >
              {result.status === "NOT_FOUND"
                ? t("newApplication")
                : t("editDetails")}
            </Button>
          </FormActions>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error.message === "SIGNUP_CREW_INVALID" ? (
            t("invalidCode")
          ) : error.message === "CREW_DISABLED" ? (
            t("disabled")
          ) : (
            <CaptchaError error={error} />
          )}
        </p>
      )}
      {captcha.panel}
    </div>
  );
}
