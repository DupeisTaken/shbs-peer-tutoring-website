"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  nameDraft,
  personNameEdit,
  unsplitLegacyName,
} from "~/lib/person-name";
import { signupSettings, missingTuteeFields } from "~/lib/signup-fields";
import { formatWeekday, minToHm } from "~/lib/time";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { TimedActionDialog } from "./timed-action-dialog";
import { ProfileDialog } from "./profile-dialog";
import { ConfiguredPersonNameFields as PersonNameFields } from "./person-name-fields";
import { FieldRequirement } from "./field-requirement";
import { OfferedGradeSelect, useProfilePolicy } from "./profile-policy";
import { Button } from "./ui/button";
import {
  FormActions,
  FormSection,
  InlineNotice,
  StatePanel,
} from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { useDialogPending } from "./ui/modal";

type Snapshot = RouterOutputs["studentWorkflow"]["signup"];
type Answers = Snapshot["answers"];

/** Mount only when the owner opens the editor. Each opening owns one draft/version;
 * background reads cannot replace it, and a successful write is never replayed by Retry. */
export function StudentSignupEditor({
  requestId,
  onClose,
  managed = false,
}: {
  requestId: string;
  onClose: () => void;
  managed?: boolean;
}) {
  const t = useTranslations("signupEditing");
  return (
    <ProfileDialog
      title={t(managed ? "headEdit" : "title")}
      size="wide"
      onClose={onClose}
    >
      <SignupEditorForm requestId={requestId} managed={managed} />
    </ProfileDialog>
  );
}

function SignupEditorForm({
  requestId,
  managed,
}: {
  requestId: string;
  managed: boolean;
}) {
  const t = useTranslations("signupEditing");
  const labels = useTranslations();
  const locale = useLocale();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const queryProcedure = managed
    ? api.studentWorkflow.managedSignup
    : api.studentWorkflow.signup;
  const query = queryProcedure.useQuery(
    { id: requestId },
    {
      refetchOnWindowFocus: false,
      retry: false,
    },
  );
  const options = api.tutee.signupOptions.useQuery();
  const profile = useProfilePolicy();
  const mutation = api.studentWorkflow.editSignup.useMutation();
  const headMutation = api.studentWorkflow.headEditSignup.useMutation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Answers | null>(null);
  const [namesReady, setNamesReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [acceptedVersion, setAcceptedVersion] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [review, setReview] = useState(false);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const admitted = useRef(false);
  const attempt = useRef<{ clientKey: string; answers: Answers } | null>(null);
  const busy = useDialogPending(
    working || reloading || mutation.isPending || headMutation.isPending,
  );
  const denied =
    query.error?.data?.code === "FORBIDDEN" ||
    query.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (denied) {
      setRevoked(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(queryProcedure, { id: requestId }, "query"),
      });
    } else if (query.isSuccess && !query.isFetching && !query.error)
      setRevoked(false);
  }, [
    denied,
    query.isSuccess,
    query.isFetching,
    query.error,
    queryClient,
    queryProcedure,
    requestId,
  ]);

  // Seed exactly once. Later adoption is an explicit Reload or completed save refresh.
  if (!snapshot && query.data && !denied) {
    setSnapshot(query.data);
    setDraft(query.data.answers);
  }
  const adopt = (fresh: Snapshot) => {
    setSnapshot(fresh);
    setDraft(fresh.answers);
    attempt.current = null;
    setAcceptedVersion(null);
    setFailure(null);
  };
  const change = (patch: Partial<Answers>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
    attempt.current = null;
    setSaved(false);
  };
  const refresh = async (version?: number) => {
    // Parent list and exact source are independent reads; both must settle before unlocking.
    const results = await Promise.allSettled([
      query.refetch(),
      managed
        ? Promise.all([
            invalidateAndReport(utils.studentWorkflow.adminRequests),
            invalidateAndReport(utils.admin.tutees),
            invalidateAndReport(utils.admin.pairings),
          ])
        : invalidateAndReport(utils.studentWorkflow.mine),
    ]);
    const first = results[0];
    if (
      first.status !== "fulfilled" ||
      first.value.error ||
      !first.value.data ||
      results[1].status !== "fulfilled" ||
      (version !== undefined && first.value.data.version < version)
    )
      throw new Error(t("refreshFailed"));
    adopt(first.value.data);
  };
  const reload = async () => {
    if (admitted.current || busy) return;
    admitted.current = true;
    setReloading(true);
    try {
      // An explicit Reload adopts nothing unless all authoritative prerequisites succeed.
      const [fresh, catalog, grades] = await Promise.all([
        query.refetch(),
        options.refetch(),
        profile.refetch(),
      ]);
      if (
        fresh.error ||
        !fresh.data ||
        catalog.error ||
        !catalog.data ||
        grades.error ||
        !grades.data
      )
        throw new Error(t("reloadFailed"));
      adopt(fresh.data);
      setSaved(false);
    } catch {
      setFailure(t("reloadFailed"));
    } finally {
      admitted.current = false;
      setReloading(false);
    }
  };
  const recover = async () => {
    if (admitted.current || busy || acceptedVersion === null) return;
    admitted.current = true;
    setReloading(true);
    try {
      await refresh(acceptedVersion);
      setSaved(true);
    } catch {
      setFailure(t("refreshFailed"));
    } finally {
      admitted.current = false;
      setReloading(false);
    }
  };
  const save = async (signedTicket?: string) => {
    if (admitted.current || blocked || !snapshot || !draft) return;
    if (managed && !signedTicket) {
      setReview(true);
      return;
    }
    admitted.current = true;
    setWorking(true);
    setFailure(null);
    attempt.current ??= {
      clientKey: crypto.randomUUID(),
      answers: structuredClone(draft),
    };
    try {
      const input = {
        id: requestId,
        expectedVersion: snapshot.version,
        ...attempt.current,
      };
      const receipt = managed
        ? await headMutation.mutateAsync({
            ...input,
            signedTicket: signedTicket!,
            releaseChangedAssignments: true,
          })
        : await mutation.mutateAsync(input);
      setReview(false);
      // Mark accepted before any read. A failed synchronization permits only read recovery.
      setAcceptedVersion(receipt.version);
      try {
        await refresh(receipt.version);
        setSaved(true);
      } catch {
        setFailure(t("refreshFailed"));
      }
    } catch (error) {
      const queued = managed ? queuedApprovalId(error) : undefined;
      if (queued) {
        setApprovalId(queued);
        setReview(false);
      } else
        setFailure(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };

  const readError = !!query.error || !!options.error || !!profile.error;
  const changed =
    !!snapshot && !!query.data && snapshot.version !== query.data.version;
  const authority = query.data ?? snapshot;
  const fields = options.data?.fields ?? signupSettings(null).tutee;
  const missing = draft
    ? missingTuteeFields({ ...draft, signatureName: "" }, fields).filter(
        (key) => key !== "signatureName",
      )
    : ["draft"];
  const blocked =
    busy ||
    denied ||
    readError ||
    !options.data ||
    !profile.data ||
    !namesReady ||
    !authority?.editable ||
    changed ||
    acceptedVersion !== null ||
    !!approvalId ||
    missing.length > 0;
  if (denied || revoked)
    return (
      <StatePanel
        kind="denied"
        title={t("denied")}
        action={
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        }
      />
    );
  const feedback = (
    <QueryFeedback
      hasData={!!snapshot && !!options.data && !!profile.data}
      loading={!snapshot || !options.data || !profile.data}
      error={readError}
      retrying={query.isFetching || options.isFetching || profile.isFetching}
      loadingTitle={t("loading")}
      errorTitle={t("loadFailed")}
      retryLabel={t("retry")}
      onRetry={() => {
        void query.refetch();
        void options.refetch();
        void profile.refetch();
      }}
    />
  );
  if (!snapshot || !draft) return feedback;
  const locked = new Set(
    authority?.assignedSubjectIds ?? snapshot.assignedSubjectIds,
  );
  const catalog = options.data?.subjects ?? [];
  const subjects = [
    ...catalog,
    ...snapshot.persistedSubjects.filter(
      (subject) => !catalog.some((active) => active.id === subject.id),
    ),
  ];
  const available = options.data?.slots ?? [];
  const slots = [
    ...available,
    ...snapshot.persistedSlots.filter(
      (slot) => !available.some((active) => active.id === slot.id),
    ),
  ];
  const currentNames = nameDraft(draft);
  const legacyName = unsplitLegacyName(snapshot.answers);
  const subjectSelect = (
    key: "firstChoiceId" | "secondChoiceId",
    required: boolean,
  ) => {
    const assigned = !managed && locked.has(draft[key] ?? "");
    return (
      <label className="block space-y-1">
        <span className="label">
          {labels(
            key === "firstChoiceId"
              ? "public.signup.fields.firstChoice"
              : "signupFields.labels.secondSubject",
          )}
          <FieldRequirement state={required ? "required" : "optional"} />
        </span>
        <select
          className="select min-h-11 lg:min-h-10"
          value={draft[key] ?? ""}
          required={required}
          disabled={assigned || authority?.subjectEditingBlocked}
          onChange={(event) =>
            change({ [key]: event.target.value || undefined })
          }
        >
          <option value="">
            {labels(
              key === "firstChoiceId"
                ? "public.signup.placeholders.selectCourse"
                : "public.signup.options.none",
            )}
          </option>
          {subjects.map((subject) => (
            <option
              key={subject.id}
              value={subject.id}
              disabled={!catalog.some((active) => active.id === subject.id)}
            >
              {subject.name}
            </option>
          ))}
        </select>
        {assigned && <p className="muted text-xs">{t("assignedLocked")}</p>}
      </label>
    );
  };
  return (
    <>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {feedback}
        <InlineNotice>{t("requestLocal")}</InlineNotice>
        {!authority?.editable && (
          <InlineNotice tone="warning">{t("readOnly")}</InlineNotice>
        )}
        {authority?.assignmentsUnresolved && (
          <InlineNotice tone="warning">{t("assignmentUnknown")}</InlineNotice>
        )}
        {changed && (
          <InlineNotice tone="warning" announcement="alert">
            {t("changed")}
          </InlineNotice>
        )}
        {approvalId && (
          <InlineNotice
            announcement="status"
            action={
              <Link
                className="link inline-flex min-h-11 items-center lg:min-h-8"
                href={`/admin/approvals?request=${encodeURIComponent(approvalId)}`}
              >
                {t("queued")}
              </Link>
            }
          >
            {t("queued")}
          </InlineNotice>
        )}
        {acceptedVersion !== null && (
          <InlineNotice
            tone="success"
            announcement="status"
            action={
              <Button disabled={busy} onClick={() => void recover()}>
                {t("retryRefresh")}
              </Button>
            }
          >
            {t("savedRefresh")}
          </InlineNotice>
        )}
        {saved && (
          <InlineNotice tone="success" announcement="status">
            {t("saved")}
          </InlineNotice>
        )}
        {failure && (
          <InlineNotice tone="error" announcement="alert">
            {failure}
          </InlineNotice>
        )}
        <fieldset
          className="min-w-0 space-y-6"
          disabled={
            busy ||
            !authority?.editable ||
            acceptedVersion !== null ||
            !!approvalId ||
            readError
          }
        >
          <FormSection title={labels("signupSections.identityTitle")}>
            <PersonNameFields
              accountType="STUDENT"
              value={currentNames}
              originalValue={nameDraft(snapshot.answers)}
              legacyName={legacyName}
              onPolicyAvailabilityChange={setNamesReady}
              onChange={(names) => {
                const identity = personNameEdit(
                  names,
                  nameDraft(snapshot.answers),
                  legacyName,
                );
                change({ ...identity.fields, englishName: identity.name });
              }}
            />
            <label className="block space-y-1">
              <span className="label">
                {labels("survey.emailLabel")}
                <FieldRequirement state="required" />
              </span>
              <input
                className="input min-h-11 lg:min-h-10"
                value={snapshot.email}
                readOnly
              />
            </label>
            <p className="muted text-sm">{t("emailFixed")}</p>
            {fields.gradeLevel !== "hidden" && (
              <label className="block space-y-1">
                <span className="label">
                  {labels("public.signup.fields.gradeLevel")}
                  <FieldRequirement state={fields.gradeLevel} />
                </span>
                <OfferedGradeSelect
                  value={draft.gradeLevel ?? ""}
                  onChange={(gradeLevel) => change({ gradeLevel })}
                  offeredGrades={profile.offeredGrades}
                  required={fields.gradeLevel === "required"}
                  preserveLegacy
                />
              </label>
            )}
            {fields.phone !== "hidden" && (
              <label className="block space-y-1">
                <span className="label">
                  {labels("public.signup.fields.phone")}
                  <FieldRequirement state={fields.phone} />
                </span>
                <input
                  className="input min-h-11 lg:min-h-10"
                  maxLength={40}
                  required={fields.phone === "required"}
                  value={draft.phone ?? ""}
                  onChange={(event) => change({ phone: event.target.value })}
                />
              </label>
            )}
            {fields.preferredContact !== "hidden" && (
              <label className="block space-y-1">
                <span className="label">
                  {labels("signupFields.labels.preferredContact")}
                  <FieldRequirement state={fields.preferredContact} />
                </span>
                <input
                  className="input min-h-11 lg:min-h-10"
                  maxLength={200}
                  required={fields.preferredContact === "required"}
                  value={draft.preferredContact}
                  onChange={(event) =>
                    change({ preferredContact: event.target.value })
                  }
                />
              </label>
            )}
          </FormSection>
          <FormSection title={labels("signupSections.subjectsTitle")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {subjectSelect("firstChoiceId", true)}
              {(fields.secondSubject !== "hidden" ||
                locked.has(draft.secondChoiceId ?? "")) &&
                subjectSelect(
                  "secondChoiceId",
                  fields.secondSubject === "required",
                )}
            </div>
          </FormSection>
          {fields.availability !== "hidden" && (
            <FormSection title={labels("signupFields.labels.availability")}>
              <p className="muted text-sm">
                {t("availabilityHelp")}
                <FieldRequirement state={fields.availability} />
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {slots.map((slot) => (
                  <label
                    key={slot.id}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={draft.slotIds.includes(slot.id)}
                      disabled={
                        !available.some((active) => active.id === slot.id) &&
                        !draft.slotIds.includes(slot.id)
                      }
                      onChange={(event) =>
                        change({
                          slotIds: event.target.checked
                            ? [...draft.slotIds, slot.id]
                            : draft.slotIds.filter((id) => id !== slot.id),
                        })
                      }
                    />
                    {formatWeekday(slot.dayOfWeek, locale)}{" "}
                    {minToHm(slot.startMin)}–{minToHm(slot.endMin)}
                  </label>
                ))}
              </div>
            </FormSection>
          )}
          <FormSection title={labels("signupSections.agreementTitle")}>
            <p className="muted text-sm">{t("evidenceFixed")}</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">
                  {labels("signupFields.labels.signatureName")}
                </dt>
                <dd>{snapshot.originalSignature || t("notProvided")}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("policyRevision")}</dt>
                <dd className="break-all">{snapshot.originalPolicyRevision}</dd>
              </div>
            </dl>
          </FormSection>
        </fieldset>
        <FormActions>
          <Button type="submit" variant="primary" disabled={blocked}>
            {t(working ? "saving" : managed ? "headEdit" : "save")}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || acceptedVersion !== null || !!approvalId}
            onClick={() => void reload()}
          >
            {t("reload")}
          </Button>
        </FormActions>
        <p className="muted text-xs">{t("reloadHelp")}</p>
        {review && (
          <TimedActionDialog
            action="SIGNUP_EDIT"
            target={requestId}
            title={t("headEdit")}
            message={t("headConsequences")}
            busy={working || headMutation.isPending}
            error={failure ?? undefined}
            canConfirm={!blocked}
            onCancel={() => setReview(false)}
            onConfirm={(ticket) => void save(ticket)}
          />
        )}
      </form>
      {!managed && (query.data?.isInvalid || query.data?.appeal) && (
        <OwnedSignupAppeal
          request={query.data ?? snapshot}
          readBlocked={readError}
          onRefresh={() => query.refetch()}
        />
      )}
    </>
  );
}

/** The applicant's appeal is an independent draft/version scope. Refreshing it
 * must not replace the signup-answer draft or expose a staff-only screening note. */
function OwnedSignupAppeal({
  request,
  onRefresh,
  readBlocked,
}: {
  request: Snapshot;
  onRefresh: () => Promise<{ data?: Snapshot; error?: unknown }>;
  readBlocked: boolean;
}) {
  const t = useTranslations("signupAppeal");
  const mutation = api.studentWorkflow.appealOwnedSignup.useMutation();
  const [reason, setReason] = useState("");
  const [version, setVersion] = useState(request.invalidityVersion);
  const [working, setWorking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const busy = useDialogPending(working || mutation.isPending);
  const admitted = useRef(false);
  const attempt = useRef<{ reason: string; clientKey: string } | null>(null);
  const changed = request.invalidityVersion !== version;
  const refresh = async (adoptVersion = false) => {
    if (admitted.current || busy) return;
    admitted.current = true;
    setWorking(true);
    try {
      const fresh = await onRefresh();
      if (fresh.error || !fresh.data) throw new Error(t("loadFailed"));
      if (adoptVersion) {
        setVersion(fresh.data.invalidityVersion);
        attempt.current = null;
      }
      setRefreshFailed(false);
      setFailure(null);
    } catch {
      setRefreshFailed(true);
      setFailure(t("loadFailed"));
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };
  const submit = async () => {
    if (
      admitted.current ||
      busy ||
      readBlocked ||
      changed ||
      accepted ||
      !request.canAppeal ||
      !reason.trim()
    )
      return;
    admitted.current = true;
    setWorking(true);
    setFailure(null);
    attempt.current ??= {
      reason: reason.trim(),
      clientKey: crypto.randomUUID(),
    };
    try {
      await mutation.mutateAsync({
        id: request.id,
        expectedInvalidityVersion: version,
        ...attempt.current,
      });
      setAccepted(true);
      const fresh = await onRefresh();
      if (fresh.error) {
        setRefreshFailed(true);
        setFailure(t("loadFailed"));
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };
  const state = request.appeal?.state;
  return (
    <section className="mt-6 space-y-4 border-t border-slate-200 pt-6">
      <h3 className="section-title">{t("title")}</h3>
      <p className="muted text-sm">{t("help")}</p>
      {state && (
        <InlineNotice announcement="status">
          {t(
            state === "PENDING"
              ? "pending"
              : state === "ACCEPTED"
                ? "accepted"
                : "rejected",
          )}
        </InlineNotice>
      )}
      {request.appeal && (
        <blockquote className="rounded-lg bg-slate-50 p-3 text-sm break-words whitespace-pre-wrap">
          {request.appeal.reason}
        </blockquote>
      )}
      {accepted && !request.appeal && (
        <InlineNotice tone="success" announcement="status">
          {t("submitted")}
        </InlineNotice>
      )}
      {failure && (
        <InlineNotice tone="error" announcement="alert">
          {failure}
        </InlineNotice>
      )}
      {(changed || refreshFailed) && (
        <InlineNotice
          tone="warning"
          action={
            <Button disabled={busy} onClick={() => void refresh(!accepted)}>
              {t(accepted ? "retry" : "reload")}
            </Button>
          }
        >
          {t(changed ? "changed" : "loadFailed")}
        </InlineNotice>
      )}
      {!accepted && request.canAppeal && state !== "PENDING" && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset
            className="space-y-4"
            disabled={busy || changed || readBlocked}
            aria-busy={working}
          >
            <label className="block space-y-1">
              <span className="label">
                {t("reason")}
                <FieldRequirement state="required" />
              </span>
              <textarea
                className="input min-h-32"
                rows={4}
                maxLength={2000}
                required
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  attempt.current = null;
                }}
              />
            </label>
            <FormActions>
              <Button type="submit" variant="primary" disabled={!reason.trim()}>
                {t(working ? "submitting" : "submit")}
              </Button>
            </FormActions>
          </fieldset>
        </form>
      )}
      {!request.canAppeal && !request.appeal && (
        <p className="muted text-sm">{t("closed")}</p>
      )}
    </section>
  );
}
