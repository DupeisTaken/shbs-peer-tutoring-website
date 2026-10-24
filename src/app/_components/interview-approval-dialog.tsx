"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { parseProgramDateTime, programDateTimeInput } from "~/lib/program-time";
import { TUTOR_ACCESS_REVOKED_PROMOTION_MESSAGE } from "~/lib/tutor-promotion";
import { Button } from "./ui/button";
import { Modal, useDialogPending } from "./ui/modal";
import { FormSection, InlineNotice } from "./ui/patterns";
import { useActionReview } from "./ui/action-review";

export type InterviewApprovalEvidence = {
  id: string;
  name: string;
  type: "INITIAL" | "ADDITIONAL_SUBJECT" | "HIGHER_LEVEL";
  updatedAt: Date;
  panel: { tutorId: string; name: string; attended: boolean }[];
  interviewCompletedAt: Date | null;
  interviewDurationMin: number | null;
};
export type InterviewApprovalInput = {
  comment: string;
  expectedUpdatedAt: Date;
  completion: {
    completedAt: Date;
    durationMin: number;
    attendedTutorIds: string[];
  };
};
export type InterviewApprovalDraft = {
  evidence: InterviewApprovalEvidence;
  comment: string;
  date: string;
  duration: string;
  attended: string[];
};

/** Each caller owns authorization and the mutation. This shared interview feature
 * owns a captured evidence draft; votes never imply physical attendance. */
export function InterviewApprovalDialog({
  evidence,
  initialComment,
  initialEvidence,
  initialDraft,
  authorized,
  canApprove,
  canRetrySubmitted = false,
  commit,
  refresh,
  reload,
  onClose,
}: {
  evidence: InterviewApprovalEvidence;
  initialComment: string;
  initialEvidence?: InterviewApprovalEvidence;
  initialDraft?: InterviewApprovalDraft;
  authorized: boolean;
  canApprove: boolean;
  /** Only an already submitted payload may replay against a now-accepted record. */
  canRetrySubmitted?: boolean;
  commit: (input: InterviewApprovalInput) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  reload: () => Promise<InterviewApprovalEvidence>;
  onClose: (draft?: InterviewApprovalDraft) => void;
}) {
  const t = useTranslations("interviewApproval");
  const all = useTranslations();
  const format = useFormatter();
  const timeZone = useTimeZone();
  const formId = useId();
  const createDraft = (
    record: InterviewApprovalEvidence,
    comment: string,
  ): InterviewApprovalDraft => ({
    evidence: record,
    comment,
    date: record.interviewCompletedAt
      ? programDateTimeInput(record.interviewCompletedAt, timeZone)
      : "",
    duration:
      record.interviewDurationMin === null
        ? ""
        : String(record.interviewDurationMin),
    attended: record.interviewCompletedAt
      ? record.panel
          .filter((person) => person.attended)
          .map((person) => person.tutorId)
      : [],
  });
  const [draft, setDraft] = useState(
    () =>
      initialDraft ?? createDraft(initialEvidence ?? evidence, initialComment),
  );
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saved, setSaved] = useState(false);
  // State owns rendered immutable evidence; the ref only guards event-time replay.
  const [submittedSnapshot, setSubmittedSnapshot] =
    useState<InterviewApprovalInput | null>(null);
  const submittedNow = useRef<InterviewApprovalInput | null>(null);
  const review = useActionReview();
  const permission = useRef({ authorized, canApprove, canRetrySubmitted });
  useLayoutEffect(() => {
    permission.current = { authorized, canApprove, canRetrySubmitted };
  }, [authorized, canApprove, canRetrySubmitted]);
  const reloadInFlight = useRef(false);
  const writing = useRef(false);
  const finished = useRef(false);
  const finish = () => {
    if (!finished.current) {
      finished.current = true;
      onClose();
    }
  };
  const recorded = !!draft.evidence.interviewCompletedAt;
  const retryOnly = !canApprove && canRetrySubmitted && !!submittedSnapshot;
  const canSubmit = canApprove || retryOnly;
  // A delayed ACCEPTED read may arrive after the user edited a failed draft.
  // Both fields and review must show the exact replay, never those later edits.
  const visibleDraft =
    retryOnly && submittedSnapshot
      ? {
          ...draft,
          comment: submittedSnapshot.comment,
          date: programDateTimeInput(
            submittedSnapshot.completion.completedAt,
            timeZone,
          ),
          duration: String(submittedSnapshot.completion.durationMin),
          attended: submittedSnapshot.completion.attendedTutorIds,
        }
      : draft;
  const hours = Number(visibleDraft.duration) / 60;
  const number = (value: number) =>
    format.number(value, { maximumFractionDigits: 4 });
  const update = (values: Partial<InterviewApprovalDraft>) =>
    setDraft((current) => ({ ...current, ...values }));

  const revokeReview = review.revoke;
  useEffect(() => {
    if (!authorized) revokeReview();
  }, [authorized, revokeReview]);

  const reloadDraft = async () => {
    if (reloadInFlight.current || review.busy) return;
    reloadInFlight.current = true;
    setReloading(true);
    setError("");
    try {
      const current = await reload();
      setDraft(createDraft(current, ""));
      setAttempted(false);
      submittedNow.current = null;
      setSubmittedSnapshot(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("unavailable"));
    } finally {
      reloadInFlight.current = false;
      setReloading(false);
    }
  };
  const openReview = () => {
    if (
      !authorized ||
      !canSubmit ||
      saved ||
      reloading ||
      review.blocked(evidence.id)
    )
      return;
    setError("");
    try {
      // Preserve seconds/milliseconds on recorded evidence instead of reparsing
      // the minute-precision display and accidentally requesting a correction.
      const input: InterviewApprovalInput =
        retryOnly && submittedSnapshot
          ? submittedSnapshot
          : {
              comment: draft.comment.trim(),
              expectedUpdatedAt: draft.evidence.updatedAt,
              completion: {
                completedAt:
                  draft.evidence.interviewCompletedAt ??
                  parseProgramDateTime(draft.date, timeZone),
                durationMin: Number(draft.duration),
                attendedTutorIds: [...draft.attended],
              },
            };
      const { completedAt, durationMin, attendedTutorIds } = input.completion;
      if (
        !Number.isFinite(completedAt.getTime()) ||
        completedAt > new Date() ||
        !Number.isInteger(durationMin) ||
        durationMin < 1 ||
        durationMin > 480 ||
        !attendedTutorIds.length ||
        !input.comment
      )
        throw new Error(all("interviewReview.invalidEvidence"));
      review.open({
        key: evidence.id,
        title: t("title", { name: draft.evidence.name }),
        description: t(
          draft.evidence.type === "INITIAL"
            ? "effectsInitial"
            : "effectsQualification",
        ),
        confirmLabel: t("confirm"),
        confirmVariant: "primary",
        details: (
          <div className="space-y-3 text-sm">
            <p>
              {all("interviewReview.reviewDate", {
                date: format.dateTime(completedAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
                minutes: durationMin,
              })}
            </p>
            <p className="break-words whitespace-pre-wrap">{input.comment}</p>
            {recorded && <InlineNotice>{t("recorded")}</InlineNotice>}
            <ul className="space-y-2">
              {draft.evidence.panel
                .filter((person) => attendedTutorIds.includes(person.tutorId))
                .map((person) => (
                  <li
                    key={person.tutorId}
                    className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2"
                  >
                    <span>{person.name}</span>
                    <span>
                      {all("interviewReview.credit", {
                        hours: number(durationMin / 60),
                      })}
                    </span>
                  </li>
                ))}
            </ul>
            <p className="font-semibold">
              {all("interviewReview.total", {
                hours: number((durationMin / 60) * attendedTutorIds.length),
              })}
            </p>
          </div>
        ),
        commit: async () => {
          // A lost response may be followed by an ACCEPTED cache update. Permit
          // only the exact captured replay; the server verifies its no-op result.
          if (
            !permission.current.authorized ||
            (!permission.current.canApprove &&
              !(
                permission.current.canRetrySubmitted &&
                submittedNow.current === input
              ))
          )
            throw new Error(t("unavailable"));
          writing.current = true;
          submittedNow.current = input;
          setSubmittedSnapshot(input);
          setAttempted(true);
          try {
            const result = await commit(input);
            setSaved(true);
            return result;
          } catch (caught) {
            writing.current = false;
            throw caught;
          }
        },
        refresh: async () => {
          try {
            await refresh();
            // The caller keeps a saved receipt; releasing its retained row only
            // after every read succeeds also handles the closed inline recovery.
            finish();
          } finally {
            writing.current = false;
          }
        },
        renderResult: () => <p>{t("saved")}</p>,
        // This refusal belongs to promotion, not the review framework. Keep the
        // failed evidence editable while explaining the independent Head action.
        renderError: (message) =>
          message === TUTOR_ACCESS_REVOKED_PROMOTION_MESSAGE
            ? t("tutoringAccessRevoked")
            : message,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : all("interviewReview.invalidEvidence"),
      );
    }
  };
  const closeEditor = () => {
    if (!review.busy && !writing.current && !reloadInFlight.current)
      onClose(draft);
  };
  if (!authorized) return null;
  return (
    <>
      {!saved && (
        <Modal
          wide
          title={t("title", { name: draft.evidence.name })}
          description={t("help")}
          busy={review.busy || reloading}
          onClose={closeEditor}
          footer={
            <>
              <Button onClick={closeEditor}>{all("common.cancel")}</Button>
              <Button
                variant="primary"
                type="submit"
                form={formId}
                disabled={!canSubmit || !visibleDraft.comment.trim()}
              >
                {t("review")}
              </Button>
            </>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              openReview();
            }}
          >
            <ApprovalFields
              draft={visibleDraft}
              update={update}
              recorded={recorded}
              retryOnly={retryOnly}
            />
          </form>
          {!!visibleDraft.duration && Number.isFinite(hours) && (
            <p className="my-3 text-sm font-semibold">
              {t("hours", {
                minutes: Number(visibleDraft.duration),
                hours: number(hours),
              })}
            </p>
          )}
          {recorded && <InlineNotice>{t("recorded")}</InlineNotice>}
          {!canSubmit && (
            <InlineNotice tone="warning">{t("waitingVotes")}</InlineNotice>
          )}
          {!retryOnly &&
            (attempted ||
              draft.evidence.updatedAt.getTime() !==
                evidence.updatedAt.getTime()) && (
              <InlineNotice
                tone="warning"
                action={
                  <Button
                    disabled={reloading}
                    onClick={() => void reloadDraft()}
                  >
                    {t("reload")}
                  </Button>
                }
              >
                {t("changed")}
              </InlineNotice>
            )}
          {error && (
            <InlineNotice tone="error" announcement="alert">
              {error}
            </InlineNotice>
          )}
        </Modal>
      )}
      {review.dialog}
    </>
  );
}

function ApprovalFields({
  draft,
  update,
  recorded,
  retryOnly,
}: {
  draft: InterviewApprovalDraft;
  update: (values: Partial<InterviewApprovalDraft>) => void;
  recorded: boolean;
  retryOnly: boolean;
}) {
  const t = useTranslations();
  // Read ancestor/nested pending state without registering that aggregate again.
  const busy = useDialogPending(false);
  return (
    <FormSection
      title={t("interviewReview.evidence")}
      busy={busy}
      disabled={retryOnly}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">{t("workflows.interviewComplete")}</span>
          <input
            data-dialog-autofocus
            required
            type="datetime-local"
            className="input w-full"
            value={draft.date}
            disabled={recorded || busy}
            onChange={(event) => update({ date: event.target.value })}
          />
        </label>
        <label>
          <span className="label">{t("workflows.duration")}</span>
          <input
            required
            type="number"
            min={1}
            max={480}
            step={1}
            className="input w-full"
            value={draft.duration}
            disabled={recorded || busy}
            onChange={(event) => update({ duration: event.target.value })}
          />
        </label>
      </div>
      <fieldset disabled={recorded || busy}>
        <legend className="label">{t("workflows.attended")}</legend>
        <p className="muted mb-2 text-sm">
          {t("interviewApproval.attendanceHelp")}
        </p>
        <div className="space-y-1">
          {draft.evidence.panel.map((person) => (
            <label
              key={person.tutorId}
              className="flex min-h-11 items-center gap-2 lg:min-h-8"
            >
              <input
                type="checkbox"
                checked={draft.attended.includes(person.tutorId)}
                onChange={(event) =>
                  update({
                    attended: event.target.checked
                      ? [...draft.attended, person.tutorId]
                      : draft.attended.filter((id) => id !== person.tutorId),
                  })
                }
              />
              {person.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="label">{t("qualificationRequests.decisionNote")}</span>
        <textarea
          required
          maxLength={500}
          className="textarea w-full"
          value={draft.comment}
          onChange={(event) => update({ comment: event.target.value })}
        />
      </label>
    </FormSection>
  );
}
