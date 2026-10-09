"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft } from "~/lib/person-name";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { RegistrationProgress } from "~/app/_components/registration-progress";
import { Button } from "~/app/_components/ui/button";
import { FormActions } from "~/app/_components/ui/patterns";
import { SignupError } from "~/app/_components/signup-error";
import { AcademicError } from "~/app/_components/academic-error";
import {
  OfferedGradeSelect,
  ProfilePolicyLoadError,
  useProfilePolicy,
} from "~/app/_components/profile-policy";
import { invitationSignIn, switchInvitationAccount } from "./actions";

/** One credential editor for every invited account. Proof/password drafts stay in memory;
 * a committed write remains locked while session synchronization is recovered separately. */
type InvitationRedemptionProps = {
  invitationId: string;
  signedIn?: boolean;
  focusOnMount?: boolean;
  initialProof?: string;
  initialEmail?: string;
  onBack?: () => void;
};
export function InvitationRedemption(props: InvitationRedemptionProps) {
  return <InvitationRedemptionFlow key={props.invitationId} {...props} />;
}

function InvitationRedemptionFlow({
  invitationId,
  signedIn = false,
  focusOnMount = false,
  initialProof = "",
  initialEmail = "",
  onBack,
}: InvitationRedemptionProps) {
  const t = useTranslations("accountInvitation");
  const policy = useProfilePolicy();
  const utils = api.useUtils();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [proof, setProof] = useState(initialProof);
  const [names, setNames] = useState(() => nameDraft());
  const [grade, setGrade] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [loginFailed, setLoginFailed] = useState(false);
  const [completedLogin, setCompletedLogin] = useState(false);
  const [sessionPending, startSession] = useTransition();
  const admitted = useRef(false);
  const verifying = useRef(false);
  const details = api.accountInvitation.inspect.useQuery(
    { invitationId, ...(proof ? { proof } : {}) },
    {
      enabled: Boolean(proof || signedIn),
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const info = details.data;
  // Adopt the initial identity once. Background recovery never replaces a local draft.
  if (info && !seeded) {
    setNames(nameDraft(info));
    setGrade(info.gradeLevel == null ? "" : String(info.gradeLevel));
    setSeeded(true);
  }
  const effectiveProof = proof || (info?.completionProof ?? "");
  function login(recipientProof: string) {
    startSession(async () => {
      try {
        const result = await invitationSignIn({
          invitationId,
          proof: recipientProof,
        });
        setLoginFailed(!result.signedIn);
        setCompletedLogin(Boolean(result.completedLogin));
        await utils.accountInvitation.inspect.invalidate();
      } catch {
        setLoginFailed(true);
      }
    });
  }
  const verify = api.accountInvitation.verify.useMutation({
    onSuccess: ({ proof: verified }) => {
      setProof(verified);
      login(verified);
    },
    onSettled: () => {
      verifying.current = false;
    },
  });
  const complete = api.accountInvitation.complete.useMutation({
    onSuccess: () => {
      setPassword("");
      setConfirm("");
      login(effectiveProof);
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const resumedLogin = useRef(false);
  useEffect(() => {
    if (initialProof && !resumedLogin.current) {
      resumedLogin.current = true;
      login(initialProof);
      return;
    }
    if (
      !proof &&
      info?.kind === "LOGIN" &&
      !info.requiresSignIn &&
      !info.needsPassword &&
      !info.completed &&
      !resumedLogin.current
    ) {
      resumedLogin.current = true;
      login(info.completionProof);
    }
  });
  const saved =
    complete.isSuccess || info?.completed === true || completedLogin;
  const busy =
    verify.isPending ||
    complete.isPending ||
    sessionPending ||
    (Boolean(proof) && details.isLoading);
  const step = saved ? 2 : info ? 1 : 0;
  const titles = [t("enterCode"), t("reviewTitle"), t("doneTitle")];
  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(`/register?invitation=${invitationId}`)}`;
  const error =
    complete.error ?? verify.error ?? (proof || info ? details.error : null);
  const editableIdentity = Boolean(
    info &&
    (!info.existing || !info.name.trim()) &&
    ["TUTOR", "CREW", "ADMIN", "COORDINATOR"].includes(info.kind),
  );
  const previewFailed = Boolean(info && details.error);
  return (
    <div className="space-y-5">
      <RegistrationProgress
        steps={titles}
        current={step}
        title={titles[step]!}
        busy={busy}
        focusOnMount={focusOnMount}
      />
      {saved ? (
        <section className="space-y-4" aria-live="polite">
          <p>{t("saved")}</p>
          {(complete.data?.academicConfirmationRequired === true ||
            info?.academicConfirmationRequired === true) && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm" role="status">
              <AcademicError
                message="ACADEMIC_CONFIRMATION_REQUIRED"
                selfService
              />
            </div>
          )}
          <p className="muted text-sm">
            {t(info?.kind === "HISTORY" ? "historyNext" : "nextHelp")}
          </p>
          {loginFailed && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
              {t("savedLoginFailed")}
            </p>
          )}
          <Link
            className="btn-primary"
            href={
              loginFailed
                ? signInUrl
                : info?.kind === "HISTORY"
                  ? `/history/claim?invitation=${invitationId}`
                  : "/dashboard"
            }
          >
            {t(loginFailed ? "signIn" : "continue")}
          </Link>
        </section>
      ) : info ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              busy ||
              previewFailed ||
              admitted.current ||
              !reviewed ||
              (editableIdentity && (policy.isLoading || policy.error)) ||
              (info.needsPassword && password !== confirm)
            )
              return;
            admitted.current = true;
            complete.mutate({
              invitationId,
              proof: effectiveProof,
              reviewed: true,
              firstName: editableIdentity ? names.firstName : info.firstName,
              lastName: editableIdentity ? names.lastName : info.lastName,
              preferredName: editableIdentity
                ? names.preferredName
                : info.preferredName,
              alternativeNames: editableIdentity
                ? names.alternativeNames
                : info.alternativeNames,
              gradeLevel: editableIdentity
                ? grade
                  ? Number(grade)
                  : null
                : info.gradeLevel,
              ...(info.needsPassword ? { password } : {}),
            });
          }}
        >
          <fieldset
            disabled={busy || previewFailed}
            aria-busy={busy}
            className="min-w-0 space-y-5"
          >
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 break-words">
              <p className="font-semibold">{t(`kind.${info.kind}`)}</p>
              <p>{info.name || `${info.firstName} ${info.lastName}`.trim()}</p>
              <p className="text-sm">{info.email}</p>
              <p className="muted mt-2 text-sm">
                {t(info.existing ? "preserveIdentity" : "newAccount")}
              </p>
            </div>
            {info.requiresSignIn && info.existing && !info.needsPassword ? (
              <div className="space-y-3 rounded-lg bg-amber-50 p-4">
                <p>{t(info.mfaRequired ? "mfaRequired" : "signInRequired")}</p>
                <Link className="btn-primary" href={signInUrl}>
                  {t("signIn")}
                </Link>
                {signedIn && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      startSession(() => switchInvitationAccount(invitationId))
                    }
                  >
                    {t("switchAccount")}
                  </Button>
                )}
              </div>
            ) : (
              <>
                {editableIdentity && (
                  <>
                    <ProfilePolicyLoadError
                      error={policy.error}
                      onRetry={() => void policy.refetch()}
                    />
                    <PersonNameFields
                      value={names}
                      onChange={setNames}
                      legacyName={info.legacyName}
                    />
                    {!info.existing && (
                      <label className="block">
                        <span className="label">
                          {t("grade")}
                          <FieldRequirement state="optional" />
                        </span>
                        <OfferedGradeSelect
                          value={grade}
                          onChange={setGrade}
                          offeredGrades={policy.offeredGrades}
                        />
                      </label>
                    )}
                  </>
                )}
                {info.needsPassword && (
                  <div className="space-y-4">
                    <label className="block">
                      <span className="label">
                        {t("password")}
                        <FieldRequirement state="required" />
                      </span>
                      <input
                        className="input"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        maxLength={200}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="label">
                        {t("confirmPassword")}
                        <FieldRequirement state="required" />
                      </span>
                      <input
                        className="input"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        maxLength={200}
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                      />
                    </label>
                    {confirm && password !== confirm && (
                      <p role="alert" className="text-sm text-red-700">
                        {t("mismatch")}
                      </p>
                    )}
                  </div>
                )}
                {!(info.kind === "LOGIN" && !info.needsPassword) && (
                  <>
                    <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                      <input
                        className="mt-1.5"
                        type="checkbox"
                        required
                        checked={reviewed}
                        onChange={(event) => setReviewed(event.target.checked)}
                      />
                      {t(
                        info.kind === "LOGIN" ? "reviewLogin" : "reviewAccess",
                      )}
                    </label>
                    <FormActions>
                      <Button
                        type="submit"
                        disabled={
                          !reviewed ||
                          Boolean(
                            editableIdentity &&
                            (policy.isLoading || policy.error),
                          ) ||
                          (info.needsPassword &&
                            (!password || password !== confirm))
                        }
                      >
                        {t("accept")}
                      </Button>
                    </FormActions>
                  </>
                )}
                {info.kind === "LOGIN" &&
                  !info.needsPassword &&
                  loginFailed && (
                    <div role="alert" className="space-y-3">
                      <p>{t("signInRequired")}</p>
                      <Link className="link" href={signInUrl}>
                        {t("signIn")}
                      </Link>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => login(effectiveProof)}
                      >
                        {t("retry")}
                      </Button>
                    </div>
                  )}
              </>
            )}
          </fieldset>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || verifying.current) return;
            verifying.current = true;
            verify.mutate({ invitationId, email, code });
          }}
        >
          <fieldset
            disabled={busy}
            aria-busy={busy}
            className="min-w-0 space-y-4"
          >
            <p className="muted text-sm">{t("codeHelp")}</p>
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
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">
                {t("verificationCode")}
                <FieldRequirement state="required" />
              </span>
              <input
                className="input font-mono tracking-widest"
                autoComplete="one-time-code"
                required
                maxLength={30}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <FormActions>
              <Button type="submit">{t("verify")}</Button>
              {onBack ? (
                <Button variant="secondary" onClick={onBack}>
                  {t("back")}
                </Button>
              ) : (
                <Link className="link" href="/register">
                  {t("back")}
                </Link>
              )}
            </FormActions>
          </fieldset>
        </form>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-sm text-red-700">
          <SignupError error={error} />
          <p>{t("recovery")}</p>
          {details.error && (proof || info) && (
            <Button variant="secondary" onClick={() => void details.refetch()}>
              {t("retry")}
            </Button>
          )}
          <Link className="link" href="/register">
            {t("restart")}
          </Link>
        </div>
      )}
    </div>
  );
}
