"use client";
import { CodeInput } from "~/app/_components/ui/code-field";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  localizedSnapshot,
  policySnapshotDocuments,
} from "~/lib/policy-evidence";
import { formatWeekday, minToHm } from "~/lib/time";
import { ConfiguredPersonNameFields as PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft } from "~/lib/person-name";
import { participantNameLabel } from "~/app/_components/participant-name";
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

/** A proof-bound review shows the posted request separately from canonical account
 * identity. Consent uses the saved snapshot, never a newly edited policy document. */
export function InvitationSignupReview({
  request,
}: {
  request: NonNullable<
    RouterOutputs["accountInvitation"]["review"]["signupRequest"]
  >;
}) {
  const t = useTranslations("signupEditing");
  const labels = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const answers = request.answers;
  const document = localizedSnapshot(
    policySnapshotDocuments(request.policySnapshot),
    locale,
  );
  const subject = (id: string | undefined) =>
    request.subjects.find((value) => value.id === id)?.name ??
    id ??
    t("notProvided");
  const fields = [
    [t("submittedName"), answers.englishName],
    [t("submittedFirstName"), answers.firstName],
    [t("submittedLastName"), answers.lastName],
    [t("submittedPreferredName"), answers.preferredName],
    [t("submittedAlternativeNames"), answers.alternativeNames],
    [t("submittedLatinName"), answers.preferredLatinName],
    [labels("survey.emailLabel"), answers.email],
    [labels("public.signup.fields.gradeLevel"), answers.gradeLevel],
    [labels("public.signup.fields.phone"), answers.phone],
    [labels("signupFields.labels.preferredContact"), answers.preferredContact],
    [
      labels("public.signup.fields.firstChoice"),
      subject(answers.firstChoiceId),
    ],
    [
      labels("public.signup.fields.secondChoice"),
      subject(answers.secondChoiceId),
    ],
  ];
  return (
    <section
      aria-label={t("replacementReview")}
      className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4"
    >
      <div>
        <h2 className="font-semibold">{t("replacementReview")}</h2>
        <p className="muted mt-1 text-sm">{t("replacementHelp")}</p>
      </div>
      <p className="text-sm">
        {t("originalPriority", {
          date: format.dateTime(new Date(request.originalPriority), {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        })}
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="font-medium">{label}</dt>
            <dd className="break-words whitespace-pre-wrap">
              {value?.trim().length ? value : t("notProvided")}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="text-sm font-medium">
          {labels("signupFields.labels.availability")}
        </h3>
        <ul className="mt-1 space-y-1 text-sm">
          {answers.slotIds.map((id) => {
            const slot = request.slots.find((value) => value.id === id);
            return (
              <li key={id}>
                {slot
                  ? `${formatWeekday(slot.dayOfWeek, locale)} ${minToHm(slot.startMin)}–${minToHm(slot.endMin)}${slot.label ? ` · ${slot.label}` : ""}`
                  : id}
              </li>
            );
          })}
        </ul>
        {!answers.slotIds.length && (
          <p className="text-sm">{t("notProvided")}</p>
        )}
      </div>
      <div className="border-t border-indigo-200 pt-3">
        <h3 className="text-sm font-medium">{t("submittedConsent")}</h3>
        <p className="mt-1 text-sm break-words">
          {answers.signatureName ? answers.signatureName : t("notProvided")}
        </p>
        <p className="muted mt-1 text-xs break-all">
          {t("policyRevision")}: {answers.policyRevision}
        </p>
        {document ? (
          <details className="mt-2">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium lg:min-h-8">
              {document.title}
            </summary>
            <p className="mt-2 text-sm break-words whitespace-pre-wrap">
              {document.body}
            </p>
          </details>
        ) : (
          <p className="muted mt-2 text-sm">{t("notProvided")}</p>
        )}
      </div>
    </section>
  );
}

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
  const participantText = useTranslations("participantNames");
  const utils = api.useUtils();
  const policy = useProfilePolicy();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [proof, setProof] = useState(initialProof);
  const [names, setNames] = useState(() => nameDraft());
  const [namePolicyReady, setNamePolicyReady] = useState(false);
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
  const { mutateAsync: readReview } =
    api.accountInvitation.review.useMutation();
  const [reviewData, setReviewData] = useState<
    RouterOutputs["accountInvitation"]["review"] | undefined
  >();
  const [reviewError, setReviewError] = useState<Error | null>(null);
  const [reading, setReading] = useState(false);
  const readSequence = useRef(0);
  const loadReview = useCallback(
    async (recipientProof: string) => {
      const sequence = ++readSequence.current;
      setReading(true);
      try {
        const fresh = await readReview({
          invitationId,
          ...(recipientProof ? { proof: recipientProof } : {}),
        });
        if (sequence === readSequence.current) {
          setReviewData(fresh);
          setReviewError(null);
        }
      } catch (error) {
        if (sequence === readSequence.current) {
          const code =
            typeof error === "object" && error !== null && "data" in error
              ? (error.data as { code?: string } | null)?.code
              : undefined;
          // An authoritative denial removes private preview data. Transport errors
          // retain the draft but block dependent writes until a successful read.
          if (
            code &&
            ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(
              code,
            )
          )
            setReviewData(undefined);
          setReviewError(
            error instanceof Error ? error : new Error("Review failed"),
          );
        }
      } finally {
        if (sequence === readSequence.current) setReading(false);
      }
    },
    [readReview, invitationId],
  );
  useEffect(() => {
    if (proof || signedIn) void loadReview(proof);
    return () => {
      readSequence.current++;
    };
  }, [proof, signedIn, loadReview]);
  const info = reviewData;
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
        await loadReview(recipientProof);
      } catch {
        setLoginFailed(true);
      }
    });
  }
  const verify = api.accountInvitation.verify.useMutation({
    onSuccess: ({ proof: verified }) => {
      // Verification exposes no source kind before its proof-authorized review.
      // Discard only the continuation snapshot; its next read decides eligibility.
      void utils.studentWorkflow.continuationStatus
        .reset()
        .catch(() => undefined);
      setProof(verified);
      login(verified);
    },
    onSettled: () => {
      verifying.current = false;
    },
  });
  const complete = api.accountInvitation.complete.useMutation({
    onSuccess: () => {
      if (info?.kind === "TUTEE")
        void utils.studentWorkflow.continuationStatus
          .reset()
          .catch(() => undefined);
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
    verify.isPending || complete.isPending || sessionPending || reading;
  const step = saved ? 2 : info ? 1 : 0;
  const titles = [t("enterCode"), t("reviewTitle"), t("doneTitle")];
  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(`/register?invitation=${invitationId}`)}`;
  const error = complete.error ?? verify.error ?? reviewError;
  const editableIdentity = Boolean(
    info &&
    !info.acceptedIdentity &&
    !info.existing &&
    ["TUTOR", "CREW", "ADMIN", "COORDINATOR"].includes(info.kind),
  );
  const previewFailed = Boolean(info && reviewError);
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
              (editableIdentity && !namePolicyReady) ||
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
              <p>
                {participantNameLabel(
                  info.name || `${info.firstName} ${info.lastName}`.trim(),
                  null,
                  participantText("unnamed"),
                )}
              </p>
              <p className="text-sm">{info.email}</p>
              <p className="muted mt-2 text-sm">
                {t(info.existing ? "preserveIdentity" : "newAccount")}
              </p>
            </div>
            {info.signupRequest && (
              <InvitationSignupReview request={info.signupRequest} />
            )}
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
                      onPolicyAvailabilityChange={setNamePolicyReady}
                      accountType={
                        info.kind === "CREW"
                          ? "CREW"
                          : info.kind === "ADMIN"
                            ? "ADMIN"
                            : info.kind === "COORDINATOR"
                              ? "COORDINATOR"
                              : "TUTOR"
                      }
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
                          (editableIdentity && !namePolicyReady) ||
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
            <CodeInput
              purpose="email"
              value={code}
              onValueChange={setCode}
              aria-invalid={Boolean(error)}
              aria-describedby={
                error ? "invitation-redemption-error" : undefined
              }
            />
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
        <div
          role="alert"
          id="invitation-redemption-error"
          className="space-y-2 text-sm text-red-700"
        >
          <SignupError error={error} />
          <p>{t("recovery")}</p>
          {reviewError && (proof || signedIn) && (
            <Button variant="secondary" onClick={() => void loadReview(proof)}>
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
