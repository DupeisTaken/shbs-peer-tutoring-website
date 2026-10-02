"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { qualificationSnapshot } from "~/lib/qualification-applications";
import { useReadOnly } from "./read-only";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { InlineNotice } from "./ui/patterns";

/** The application card owns panel setup; this component owns additional-request decisions only. */
export function QualificationReview({
  app,
  onChanged,
}: {
  app: {
    id: string;
    name: string;
    type: "INITIAL" | "ADDITIONAL_SUBJECT" | "HIGHER_LEVEL";
    subjectIntents: { subject: { name: string } }[];
    status: string;
    updatedAt: Date;
    qualificationReason?: string | null;
    qualificationSnapshot?: unknown;
    decisionComment: string | null;
    requestedTutorId?: string | null;
    interviewers?: { isHead: boolean; tutor: { id: string } }[];
  };
  onChanged: (throwOnError?: boolean) => Promise<unknown> | void;
}) {
  const t = useTranslations("qualificationRequests");
  const ui = useTranslations("uiPatterns");
  const readOnly = useReadOnly();
  const me = api.account.me.useQuery().data;
  const utils = api.useUtils();
  const [reviewOpen, setReviewOpen] = useState(false);
  // The note and expected version belong to one review, including cancel/reopen
  // and failed writes. Background refetches must never rebase that draft.
  const [draft, setDraft] = useState<{
    comment: string;
    expectedUpdatedAt: Date;
  } | null>(null);
  const submitted = useRef(false);
  const [decided, setDecided] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const refreshDecision = async () => {
    setRefreshing(true);
    setRecoveryError(null);
    try {
      // A committed decision cannot be submitted again when a subsequent read
      // fails. Retry only synchronization, including the independent detail cache.
      const results = await Promise.allSettled([
        onChanged(true),
        utils.qualificationApplication.mine.invalidate(undefined, undefined, {
          throwOnError: true,
        }),
        utils.subjectAvailability.options.invalidate(undefined, undefined, {
          throwOnError: true,
        }),
        utils.admin.tutors.invalidate(undefined, undefined, {
          throwOnError: true,
        }),
        app.requestedTutorId
          ? utils.tutorDetails.get.invalidate(
              { tutorId: app.requestedTutorId },
              undefined,
              { throwOnError: true },
            )
          : Promise.resolve(),
      ]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      setReviewOpen(false);
      setDraft(null);
    } catch (error) {
      setRecoveryError(
        error instanceof Error ? error.message : ui("loadFailed"),
      );
    } finally {
      setRefreshing(false);
    }
  };
  const mutation = api.qualificationApplication.decide.useMutation({
    onSuccess: async () => {
      setDecided(true);
      await refreshDecision();
    },
    onError: () => {
      void Promise.resolve()
        .then(() => onChanged())
        .catch(() => undefined);
    },
    onSettled: () => {
      submitted.current = false;
    },
  });
  const hasPanel = app.status === "INTERVIEW" || !!app.interviewers?.length;
  const canReview =
    !readOnly &&
    app.type !== "INITIAL" &&
    !!me &&
    ["ADMIN", "HEAD"].includes(me.role) &&
    me.tutorId !== app.requestedTutorId &&
    (!hasPanel ||
      (!me.tutorAccessRevoked &&
        !!app.interviewers?.some(
          (person) => person.isHead && person.tutor.id === me.tutorId,
        )));
  const open = app.status === "PENDING" || app.status === "INTERVIEW";
  const busy = mutation.isPending || refreshing || reloading;
  const locked = busy || decided;
  const closeReview = () => {
    if (!busy && !submitted.current) setReviewOpen(false);
  };
  const comment = draft?.comment ?? "";
  const submit = (accept: boolean) => {
    // React's pending render is asynchronous; this guard also stops two clicks
    // in the same tick, including opposite decisions on the same request.
    if (
      !canReview ||
      !open ||
      (!accept && !hasPanel) ||
      locked ||
      submitted.current ||
      !draft?.comment.trim()
    )
      return;
    submitted.current = true;
    mutation.mutate({ id: app.id, accept, ...draft });
  };
  const reloadDraft = async () => {
    setReloading(true);
    setRecoveryError(null);
    try {
      const rows = await utils.admin.tutorApplications.fetch(undefined, {
        staleTime: 0,
      });
      const fresh = rows.find((row) => row.id === app.id);
      if (!fresh) throw new Error(ui("loadFailed"));
      // Explicit Reload replaces the note/version only after a successful GET.
      setDraft({ comment: "", expectedUpdatedAt: fresh.updatedAt });
      mutation.reset();
    } catch (error) {
      setRecoveryError(
        error instanceof Error ? error.message : ui("loadFailed"),
      );
    } finally {
      setReloading(false);
    }
  };
  const fields = (
    <div className="space-y-3">
      <label
        className="block text-sm font-medium"
        htmlFor={`qualification-decision-${app.id}`}
      >
        {t("decisionNote")}
      </label>
      <textarea
        id={`qualification-decision-${app.id}`}
        className="textarea w-full"
        rows={3}
        required
        maxLength={500}
        disabled={locked}
        value={comment}
        onChange={(event) =>
          setDraft({
            comment: event.target.value,
            expectedUpdatedAt: draft?.expectedUpdatedAt ?? app.updatedAt,
          })
        }
      />
      {mutation.error && (
        <InlineNotice tone="error" announcement="alert">
          {mutation.error.message}
        </InlineNotice>
      )}
      {recoveryError && (
        <InlineNotice tone="error" announcement="alert">
          {recoveryError}
        </InlineNotice>
      )}
      {!decided &&
        (!!mutation.error ||
          (draft &&
            draft.expectedUpdatedAt.getTime() !== app.updatedAt.getTime())) && (
          <InlineNotice
            tone="warning"
            action={
              <Button disabled={busy} onClick={() => void reloadDraft()}>
                {t("reloadReview")}
              </Button>
            }
          >
            {t("reloadHelp")}
          </InlineNotice>
        )}
    </div>
  );
  const actions = (
    <>
      {/* Rejection belongs to the assigned chair's interview workflow only. */}
      {(hasPanel ? [true, false] : [true]).map((accept) => (
        <Button
          key={String(accept)}
          variant={accept ? "primary" : "secondary"}
          disabled={!comment.trim() || locked}
          onClick={() => submit(accept)}
        >
          {t(accept ? "approve" : "reject")}
        </Button>
      ))}
    </>
  );
  const grants = qualificationSnapshot(app.qualificationSnapshot);
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm break-words whitespace-pre-wrap">
        {app.qualificationReason}
      </p>
      {app.decisionComment && (
        <p className="text-sm">
          {t("result", { comment: app.decisionComment })}
        </p>
      )}
      {!!grants.length && (
        <p className="text-sm">
          {t("granted", {
            subjects: grants.map((subject) => subject.name).join(", "),
          })}
        </p>
      )}
      {open && (
        <p className="muted text-sm">
          {t(hasPanel ? "interviewReview" : "directHelp")}
        </p>
      )}
      {open && !canReview && (
        <p className="muted text-sm">{t("reviewerOnly")}</p>
      )}
      {decided && (
        <InlineNotice
          tone={recoveryError ? "warning" : "success"}
          announcement="status"
          action={
            recoveryError && !reviewOpen ? (
              <Button disabled={busy} onClick={() => void refreshDecision()}>
                {ui("retry")}
              </Button>
            ) : undefined
          }
        >
          {t(recoveryError ? "decisionRefreshFailed" : "decisionSaved")}
        </InlineNotice>
      )}
      {open && canReview && !hasPanel && !decided && (
        <Button
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => {
            setDraft(
              (current) =>
                current ?? { comment: "", expectedUpdatedAt: app.updatedAt },
            );
            setReviewOpen(true);
          }}
        >
          {t("approveWithoutInterview")}
        </Button>
      )}
      {reviewOpen && ((open && canReview && !hasPanel) || decided) && (
        <Modal
          title={t("reviewTitle")}
          description={t("reviewHelp")}
          busy={busy}
          onClose={closeReview}
          footer={
            <>
              <Button
                data-dialog-autofocus
                disabled={busy}
                onClick={closeReview}
              >
                {ui("cancel")}
              </Button>
              {decided ? (
                <Button
                  disabled={!recoveryError}
                  onClick={() => void refreshDecision()}
                >
                  {ui("retry")}
                </Button>
              ) : (
                actions
              )}
            </>
          }
        >
          <div className="mb-4 space-y-1 text-sm break-words">
            <p className="font-semibold">{app.name}</p>
            <p>
              {t(app.type)} ·{" "}
              {app.subjectIntents
                .map((intent) => intent.subject.name)
                .join(", ")}
            </p>
            <p className="muted whitespace-pre-wrap">
              {app.qualificationReason}
            </p>
          </div>
          {decided && (
            <p role="status" className="mb-3 text-sm">
              {t(recoveryError ? "decisionRefreshFailed" : "decisionSaved")}
            </p>
          )}
          {fields}
        </Modal>
      )}
      {open && canReview && hasPanel && !decided && (
        <>
          {fields}
          <div className="flex flex-wrap gap-2">{actions}</div>
        </>
      )}
    </div>
  );
}
