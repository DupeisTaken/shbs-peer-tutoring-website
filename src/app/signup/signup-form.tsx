"use client";
import { Button } from "~/app/_components/ui/button";
import {
  FormSection,
  FormActions,
  InlineNotice,
} from "~/app/_components/ui/patterns";
import { ConfiguredPersonNameFields as PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, fullPersonName } from "~/lib/person-name";

import {
  useSignupCaptcha,
  CaptchaError,
} from "~/app/_components/signup-captcha";

import { FieldRequirement } from "~/app/_components/field-requirement";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  useProfilePolicy,
  OfferedGradeSelect,
} from "~/app/_components/profile-policy";
import {
  RecruitmentNotice,
  useRecruitmentStatus,
} from "~/app/_components/recruitment-notice";
import { useLocale, useTranslations } from "next-intl";

import {
  signupSettings,
  normalizeTuteeFields,
  missingTuteeFields,
} from "~/lib/signup-fields";
import { api, type RouterInputs } from "~/trpc/react";
import { formatWeekday, minToHm } from "~/lib/time";
import { useBranding } from "~/app/_components/branding-provider";
import { PolicyAgreement } from "~/app/_components/policy-agreement";
import { SigninAccess } from "./signin-access";
import { SurveyVerification } from "./survey-verification";
import { SignupEmailField } from "./signup-email-field";
import { SignupTransitionNotice, useSignupClock } from "./signup-transition-notice";
import { publicSignupView, type PublicSignupTransition } from "~/lib/public-signup-transition";

export function SignupForm({ initialTransition }: { initialTransition?: PublicSignupTransition } = {}) {
  const { APP_TITLE } = useBranding();
  const t = useTranslations();
  const profilePolicy = useProfilePolicy();
  const locale = useLocale();
  const options = api.tutee.signupOptions.useQuery(undefined, {
    // Returning from the tutee workspace must recheck intake dates even while
    // the shared query cache considers the previous visit's options fresh.
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const transition = options.data?.transition ?? initialTransition;
  const transitionNow = useSignupClock(transition?.serverNow);
  const signupView = transition ? publicSignupView(transition, transitionNow) : null;
  const transitionText = useTranslations("signupTransition");
  const [draftTerm, setDraftTerm] = useState(transition?.current ?? null);
  const [reviewingPeriod, setReviewingPeriod] = useState(false);
  const [periodReadFailed, setPeriodReadFailed] = useState(false);
  // Adopt the first usable period once. Later reads must not retarget an existing draft.
  if (!draftTerm && transition?.current) setDraftTerm(transition.current);
  const periodChanged = !!draftTerm && draftTerm.termId !== transition?.current?.termId;
  const { refetch: refetchRecruitment } = options;
  const refreshRecruitment = useCallback(() => { void refetchRecruitment(); }, [refetchRecruitment]);
  const policy = api.tutee.surveyPolicy.useQuery({ locale });
  const submit = api.tutee.submitSurvey.useMutation();
  const recoverReceipt = api.tutee.signupReceipt.useMutation();
  type CapturedSubmission = {
    clientKey: string;
    answers: Omit<
      RouterInputs["tutee"]["submitSurvey"],
      "captchaGrant" | "clientKey"
    >;
  };
  const attempt = useRef<CapturedSubmission | null>(null);
  const admitted = useRef(false);
  const [working, setWorking] = useState(false);
  const [held, setHeld] = useState(false);
  const [dispatched, setDispatched] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<{
    email: string;
    emailSent: boolean;
    intentId?: string;
  } | null>(null);
  const editing = useTranslations("signupEditing");

  /** Retry carries exactly the original intent and answers. Receipt recovery uses POST
   * to keep personal answers out of URLs, and does not consume CAPTCHA or mail budgets. */
  const sendSubmission = async (captured?: CapturedSubmission) => {
    if (admitted.current) return;
    const retry = !captured;
    const submission = captured ?? attempt.current;
    if (!submission) return;
    admitted.current = true;
    attempt.current = submission;
    if (captured) setDispatched(false);
    setWorking(true);
    setHeld(true);
    try {
      if (retry) {
        const saved = await recoverReceipt.mutateAsync(submission);
        if (saved) {
          setAcknowledgement({ ...saved, email: submission.answers.email });
          return;
        }
      }
      await captcha.run(async (captchaGrant) => {
        // Once a feature write is dispatched, a missing reply can mean success.
        // CAPTCHA cancellation on a later retry must keep this intent frozen.
        setDispatched(true);
        const saved = await submit.mutateAsync({
          ...submission.answers,
          clientKey: submission.clientKey,
          captchaGrant,
        });
        setAcknowledgement({ ...saved, email: submission.answers.email });
        return saved;
      });
    } catch {
      // Keep the captured snapshot and key, including when a committed response was lost.
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };

  /** Returning to editing first resolves the held intent. A failed recovery leaves
   * the draft frozen; a confirmed absence keeps fields and starts a new deliberate intent. */
  const returnToEditing = async () => {
    if (
      admitted.current ||
      working ||
      captcha.pending ||
      submit.isPending ||
      !attempt.current
    )
      return;
    admitted.current = true;
    setWorking(true);
    const captured = attempt.current;
    try {
      const saved = await recoverReceipt.mutateAsync(captured);
      if (saved)
        setAcknowledgement({ ...saved, email: captured.answers.email });
      else {
        attempt.current = null;
        setHeld(false);
        setDispatched(false);
      }
    } catch {
      /* Ambiguous recovery must not abandon a possibly committed intent. */
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };

  const [names, setNames] = useState(() => nameDraft());
  const [namePolicyReady, setNamePolicyReady] = useState(false);
  const englishName = fullPersonName(names);
  const [gradeLevel, setGradeLevel] = useState("");
  const [email, setEmail] = useState("");
  const captcha = useSignupCaptcha("tutee.submit", email);
  // A cancelled/rejected initial challenge never dispatched a feature write, so
  // its draft can reopen immediately. Ambiguous writes require receipt recovery.
  const holdDraft = held && (dispatched || working || captcha.pending);
  const [phone, setPhone] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
  const [firstChoiceId, setFirstChoiceId] = useState("");
  const [secondChoiceId, setSecondChoiceId] = useState("");
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [signatureName, setSignatureName] = useState("");
  const [agreedRevision, setAgreedRevision] = useState<string | null>(null);
  const agreed =
    !!policy.data?.revision && agreedRevision === policy.data.revision;

  const fields = options.data?.fields ?? signupSettings(null).tutee;
  const optionalValues = {
    gradeLevel,
    phone,
    preferredContact,
    secondChoiceId,
    slotIds,
    signatureName,
  };
  const courses = options.data?.subjects ?? [];
  const slots = useMemo(() => options.data?.slots ?? [], [options.data]);

  // Group slots by day of week for a tidy availability picker.
  const slotsByDay = useMemo(() => {
    const map = new Map<number, typeof slots>();
    for (const s of slots) {
      const arr = map.get(s.dayOfWeek) ?? [];
      arr.push(s);
      map.set(s.dayOfWeek, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [slots]);

  const toggleSlot = (id: string) =>
    setSlotIds((cur) =>
      cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id],
    );

  const status = useRecruitmentStatus(options.data?.recruitment);
  const missing = [
    ...(!courses.length ? ["subjects"] : []),
    ...(fields.availability === "required" && !slots.length ? ["slots"] : []),
    ...(!policy.data?.body?.trim() || !policy.data?.revision ? ["policy"] : []),
  ];
  const readOnly = status !== "open" || missing.length > 0 || !draftTerm || periodChanged || reviewingPeriod;
  const canSubmit =
    namePolicyReady &&
    options.isFetchedAfterMount &&
    !readOnly &&
    !options.isError &&
    !policy.isError &&
    (!gradeLevel || profilePolicy.offeredGrades.includes(Number(gradeLevel))) &&
    email.trim() &&
    policy.data?.revision &&
    missingTuteeFields(normalizeTuteeFields(optionalValues, fields), fields)
      .length === 0 &&
    firstChoiceId &&
    agreed &&
    !submit.isPending &&
    !working &&
    !holdDraft &&
    !captcha.pending;

  if (acknowledgement) {
    return (
      <div className="card p-5 text-center sm:p-8">
        <h2 className="text-xl font-semibold text-slate-900">
          {t("survey.savedTitle")}
        </h2>
        <p className="muted mt-2">
          {editing(acknowledgement.emailSent ? "savedMailbox" : "savedNoMail", {
            email: acknowledgement.email,
          })}
        </p>
        <p className="muted mt-3 text-sm">{editing("replacementHelp")}</p>
        {!acknowledgement.emailSent && (
          <p role="alert" className="mt-3 text-amber-800">
            {t("survey.mailFailed")}
          </p>
        )}
        <SigninAccess />
        <SurveyVerification
          email={acknowledgement.email}
          intentId={acknowledgement.intentId}
        />
      </div>
    );
  }

  // Distinguish pending reads and configuration gaps from a usable signup form.
  if ((options.isError && !options.data) || (policy.isError && !policy.data))
    return (
      <>{transition && <SignupTransitionNotice data={transition} now={transitionNow} refresh={refreshRecruitment} verified={!options.isError} />}<section className="card space-y-4 p-6">
        <p role="alert">{t("survey.loadFailed")}</p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            void options.refetch();
            void policy.refetch();
          }}
        >
          {t("survey.retry")}
        </button>
      </section></>
    );
  if (
    (!options.isFetchedAfterMount && !options.isError) ||
    (options.isLoading && !options.data) ||
    (policy.isLoading && !policy.data)
  )
    return (
      <>{transition && <SignupTransitionNotice data={transition} now={transitionNow} refresh={refreshRecruitment} verified={!options.isError} />}<p role="status" className="card p-6">
        {t("workflows.loading")}
      </p></>
    );
  return (
    <>
      {transition && <SignupTransitionNotice data={transition} now={transitionNow} refresh={refreshRecruitment} verified={!options.isError} />}
      {periodChanged && <InlineNotice tone="warning" announcement="status" action={
        <Button disabled={working || holdDraft || reviewingPeriod} onClick={async () => {
          setReviewingPeriod(true);
          setPeriodReadFailed(false);
          try {
            const [latest, latestPolicy] = await Promise.all([options.refetch(), policy.refetch()]);
            if (latest.error || latestPolicy.error || !latest.data?.transition.current) throw new Error("read failed");
            // The explicit review retains answers but makes the new period and consent deliberate.
            setDraftTerm(latest.data.transition.current);
            setAgreedRevision(null);
          } catch { setPeriodReadFailed(true); }
          finally { setReviewingPeriod(false); }
        }}>{transitionText("reviewPeriod", { period: transition?.current?.label ?? "" })}</Button>
      }>{transitionText("periodChanged", { period: draftTerm?.label ?? "" })}</InlineNotice>}
      {periodReadFailed && <InlineNotice tone="error" announcement="alert">{transitionText("reviewFailed")}</InlineNotice>}
      {/* Cached prerequisites and controlled drafts stay mounted during recovery. */}
      {(options.isError || policy.isError) && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button
              onClick={() => {
                void options.refetch();
                void policy.refetch();
              }}
            >
              {t("survey.retry")}
            </Button>
          }
        >
          {t("survey.loadFailed")}
        </InlineNotice>
      )}
      {readOnly && (
        <RecruitmentNotice
          status={status}
          missing={missing}
          window={signupView?.next ? undefined : options.data?.recruitment}
          policy={policy.data}
        />
      )}
      <form
        className="card space-y-6 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit || !policy.data) return;
          const policyRevision = policy.data.revision;
          void sendSubmission({
            clientKey: crypto.randomUUID(),
            answers: normalizeTuteeFields(
              {
                ...names,
                expectedTermId: draftTerm.termId,
                englishName: englishName.trim(),
                email: email.trim(),
                policyRevision,
                phone: phone.trim() || undefined,
                preferredContact: preferredContact.trim(),
                gradeLevel: gradeLevel.trim() || undefined,
                firstChoiceId,
                secondChoiceId: secondChoiceId || undefined,
                slotIds,
                signatureName: signatureName.trim(),
                agreed: true as const,
              },
              fields,
            ),
          });
        }}
      >
        {/* Native fieldset prevents mouse, keyboard and assistive-input edits in preview mode. */}
        <fieldset
          disabled={
            !options.isFetchedAfterMount ||
            options.isError ||
            policy.isError ||
            readOnly ||
            submit.isPending ||
            working ||
            holdDraft ||
            captcha.pending
          }
          aria-busy={submit.isPending || working}
          className="min-w-0 space-y-6"
          aria-label={t("recruitment.responses")}
        >
          <FormSection title={t("signupSections.identityTitle")}>
            {/* Align identity labels with the email help trigger's mobile touch target. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&_.label]:min-h-11 [&_.label]:content-center lg:[&_.label]:min-h-0">
              <div className="sm:col-span-2">
                <PersonNameFields
                  onPolicyAvailabilityChange={setNamePolicyReady}
                  accountType="STUDENT"
                  value={names}
                  onChange={setNames}
                />
              </div>
              {fields.gradeLevel !== "hidden" && (
                <label className="space-y-1">
                  <span className="label">
                    {t("public.signup.fields.gradeLevel")}
                    <FieldRequirement state={fields.gradeLevel} />
                  </span>
                  <OfferedGradeSelect
                    required={fields.gradeLevel === "required"}
                    value={gradeLevel}
                    onChange={setGradeLevel}
                    offeredGrades={profilePolicy.offeredGrades}
                  />
                </label>
              )}
              <SignupEmailField
                value={email}
                onChange={setEmail}
                disabled={readOnly}
              />
              {fields.phone !== "hidden" && (
                <label className="space-y-1">
                  <span className="label">
                    {t("public.signup.fields.phone")}
                    <FieldRequirement state={fields.phone} />
                  </span>
                  <input
                    className="input min-h-11 lg:min-h-10"
                    required={fields.phone === "required"}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
              )}
            </div>

            {/* Preferred contact — make it unmistakable how to reach this student. */}
            {fields.preferredContact !== "hidden" && (
              <label className="space-y-1">
                <span className="label">
                  {t("signupFields.labels.preferredContact")}
                  <FieldRequirement state={fields.preferredContact} />
                </span>
                <input
                  className="input min-h-11 lg:min-h-10"
                  value={preferredContact}
                  onChange={(e) => setPreferredContact(e.target.value)}
                  placeholder={t("public.signup.placeholders.preferredContact")}
                  required={fields.preferredContact === "required"}
                />
                <span className="muted text-xs">
                  {t("public.signup.help.preferredContact")}
                </span>
              </label>
            )}
          </FormSection>
          <FormSection title={t("signupSections.subjectsTitle")}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="label">
                  {t("public.signup.fields.firstChoice")}
                  <FieldRequirement state="required" />
                </span>
                <select
                  className="select min-h-11 lg:min-h-10"
                  value={firstChoiceId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFirstChoiceId(next);
                    // Removing an option does not clear a controlled select's
                    // draft. Keep the posted second choice aligned with None;
                    // required-second validation then requests a replacement.
                    setSecondChoiceId((previous) =>
                      previous === next ? "" : previous,
                    );
                  }}
                  required
                >
                  <option value="">
                    {t("public.signup.placeholders.selectCourse")}
                  </option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {fields.secondSubject !== "hidden" && (
                <label className="space-y-1">
                  <span className="label">
                    {t("signupFields.labels.secondSubject")}
                    <FieldRequirement state={fields.secondSubject} />
                  </span>
                  <select
                    className="select min-h-11 lg:min-h-10"
                    required={fields.secondSubject === "required"}
                    value={secondChoiceId}
                    onChange={(e) => setSecondChoiceId(e.target.value)}
                  >
                    <option value="">{t("public.signup.options.none")}</option>
                    {courses
                      .filter((c) => c.id !== firstChoiceId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
          </FormSection>
          {/* Availability retains native checkbox selection and configured marking. */}
          {fields.availability !== "hidden" && (
            <fieldset className="min-w-0 space-y-3">
              <legend className="section-title">
                {t("signupFields.labels.availability")}
                <FieldRequirement state={fields.availability} />
              </legend>
              {slots.length === 0 ? (
                <p className="muted mt-1">{t("public.signup.noSlots")}</p>
              ) : (
                <div className="mt-2 space-y-3">
                  {slotsByDay.map(([day, daySlots]) => (
                    <div key={day}>
                      <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                        {formatWeekday(day, locale)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {daySlots.map((s) => {
                          const checked = slotIds.includes(s.id);
                          return (
                            <label
                              key={s.id}
                              className={`focus-within:ring-accent-500 inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm transition focus-within:ring-2 ${
                                checked
                                  ? "border-accent-500 bg-accent-50 text-accent-700"
                                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={checked}
                                onChange={() => toggleSlot(s.id)}
                              />
                              {s.label}{" "}
                              <span className="text-slate-600">
                                ({minToHm(s.startMin)}–{minToHm(s.endMin)})
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {/* Policy agreement (gated on reading the policy) + signature */}
          <FormSection title={t("signupSections.agreementTitle")}>
            <PolicyAgreement
              key={policy.data?.revision}
              messageKey="public.signup.agree"
              appTitle={APP_TITLE}
              policy={policy.data}
              checked={agreed}
              onChange={(value) =>
                setAgreedRevision(
                  value ? (policy.data?.revision ?? null) : null,
                )
              }
            />
            {fields.signatureName !== "hidden" && (
              <label className="block space-y-1">
                <span className="label">
                  {t("signupFields.labels.signatureName")}
                  <FieldRequirement state={fields.signatureName} />
                </span>
                <input
                  className="input min-h-11 lg:min-h-10"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder={t("public.signup.placeholders.signature")}
                  required={fields.signatureName === "required"}
                />
              </label>
            )}
          </FormSection>

          {submit.error && (
            <p role="alert" className="text-sm text-red-600">
              <CaptchaError error={submit.error} />
            </p>
          )}

          <FormActions>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={!canSubmit}
            >
              {submit.isPending
                ? t("public.signup.submitting")
                : t("public.signup.submit")}
            </Button>
          </FormActions>
        </fieldset>
        {/* Freeze the captured application draft, but keep the challenge's own
            Verify/Cancel/Retry controls outside the disabled form controls. */}
        {captcha.panel}
        {holdDraft && !acknowledgement && (
          <InlineNotice
            tone="warning"
            announcement="status"
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={working || captcha.pending}
                  onClick={() => void sendSubmission()}
                >
                  {editing("recoverSubmission")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={working || captcha.pending || submit.isPending}
                  onClick={() => void returnToEditing()}
                >
                  {editing("returnToEditing")}
                </Button>
              </div>
            }
          >
            {editing("submissionHeld")}
          </InlineNotice>
        )}
        {recoverReceipt.error && (
          <p role="alert" className="text-sm text-red-700">
            <CaptchaError error={recoverReceipt.error} />
          </p>
        )}
      </form>
    </>
  );
}
