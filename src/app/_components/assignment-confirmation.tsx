"use client";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  assignmentIdentity,
  type AssignmentOperation,
} from "~/lib/assignment-qualification";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { type AnchoredConfirmation } from "~/lib/confirmation-timing";
import { useConfirmationClock } from "./use-confirmation-clock";
import { useConfirmationSubmission } from "./use-confirmation-submission";

/** Remount on any selection change: late preparation responses cannot unlock a new selection. */
export function AssignmentConfirmation(props: {
  operation: AssignmentOperation;
  payload: unknown;
  busy?: boolean;
  error?: string;
  onConfirm: (overrideTicket?: string) => unknown;
  onCancel: () => void;
  advisory?: ReactNode;
  /** Optional workload review shares this dialog without changing qualification tickets. */
  workloadReview?: { pending: boolean; warning: string | null };
}) {
  return (
    <ConfirmationInstance
      key={`${props.operation}:${assignmentIdentity(props.payload)}`}
      {...props}
    />
  );
}

function ConfirmationInstance({
  operation,
  payload,
  busy = false,
  error,
  onConfirm,
  onCancel,
  advisory,
  workloadReview,
}: Parameters<typeof AssignmentConfirmation>[0]) {
  const t = useTranslations("assignmentQualification");
  const workloadText = useTranslations("tutorWorkload");
  const statusId = useId();
  const prepare = api.assignment.prepare.useMutation();
  const cancel = api.assignment.cancel.useMutation();
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof prepare.mutateAsync>
  > | null>(null);
  const [anchor, setAnchor] = useState<AnchoredConfirmation | null>(null);
  const [attempt, setAttempt] = useState(0);
  const clock = useConfirmationClock(anchor);
  const submission = useConfirmationSubmission(busy, error);
  const automaticAttempt = useRef(false);
  const { run } = submission;
  const runAttempt = useCallback(
    (callback: () => unknown) =>
      run(() => {
        // Manual and automatic admission consume the same prepared attempt. Only
        // explicit Review again/new preparation permits a later automatic write.
        automaticAttempt.current = true;
        return callback();
      }),
    [run],
  );
  const callbacks = useRef({ onConfirm, onCancel, run: runAttempt });
  useEffect(() => {
    callbacks.current = { onConfirm, onCancel, run: runAttempt };
  }, [onConfirm, onCancel, runAttempt]);
  const ticketRef = useRef<string | null>(null);
  const { submitted } = submission;
  const { mutateAsync } = prepare;
  const cancelTicket = cancel.mutate;
  useEffect(() => {
    let live = true;
    // Defer one microtask so Strict Mode's throwaway effect cannot create a competing
    // server ticket that invalidates the visible dialog's acknowledgement.
    void Promise.resolve()
      .then(async () => {
        if (!live) return;
        const requestStartedAt = performance.now();
        const data = await mutateAsync({ operation, payload });
        if (!live) {
          if (data.ticket) cancelTicket({ ticket: data.ticket.id });
          return;
        }
        ticketRef.current = data.ticket?.id ?? null;
        automaticAttempt.current = false;
        setAnchor(
          data.ticket
            ? {
                ticket: data.ticket,
                requestStartedAt,
                receivedAt: performance.now(),
              }
            : null,
        );
        setResult(data);
      })
      .catch(() => {
        /* The mutation error is displayed in the dialog. */
      });
    return () => {
      live = false;
      if (ticketRef.current && !submitted.current)
        cancelTicket({ ticket: ticketRef.current });
    };
    // The keyed parent supplies an immutable selection for this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutateAsync, cancelTicket, attempt]);
  useEffect(() => {
    // A fresh workload read must finish before the qualified fast path can submit.
    // A failed advisory read does not create a new permission or block assignment.
    if (
      result &&
      !result.mismatches.length &&
      !workloadReview?.pending &&
      !workloadReview?.warning &&
      !automaticAttempt.current &&
      !submitted.current
    ) {
      // A failed write needs deliberate Retry; a later advisory refresh must
      // not silently repeat this qualified fast path with the same intent.
      callbacks.current.run(() => callbacks.current.onConfirm());
    }
  }, [result, workloadReview?.pending, workloadReview?.warning]);
  useEffect(() => {
    // A queued approval is an accepted handoff, not a user dismissal. Keep this
    // lifecycle separate from Modal's pending-write Escape/backdrop protection.
    const queued = () => callbacks.current.onCancel();
    window.addEventListener("approval-queued", queued);
    return () => {
      window.removeEventListener("approval-queued", queued);
    };
  }, []);
  const { remaining, expired } = clock;
  const pending = busy || submission.admitted;
  const warning = !!result?.mismatches.length;
  const status = pending
    ? t("working")
    : expired
      ? t("confirmationExpired")
      : !warning || remaining === null
        ? t("checking")
        : remaining
          ? t("wait", { seconds: remaining })
          : t("confirm");
  return (
    <Modal
      busy={pending}
      onClose={onCancel}
      title={
        warning
          ? t("warningTitle")
          : workloadReview?.warning
            ? workloadText("confirmTitle")
            : t("checking")
      }
      description={
        warning
          ? t("warningHelp")
          : (workloadReview?.warning ?? t("checkingHelp"))
      }
      footer={
        <>
          {(expired || !!prepare.error || (!warning && !!error)) && (
            <Button
              disabled={pending}
              onClick={() => {
                prepare.reset();
                setResult(null);
                setAnchor(null);
                setAttempt((value) => value + 1);
              }}
            >
              {t("retry")}
            </Button>
          )}
          <Button data-dialog-autofocus disabled={pending} onClick={onCancel}>
            {t("cancel")}
          </Button>
          {(warning || Boolean(workloadReview?.warning)) && (
            <Button
              variant="primary"
              className="whitespace-normal"
              aria-describedby={statusId}
              disabled={
                (warning && !clock.eligible) ||
                Boolean(workloadReview?.pending) ||
                pending ||
                !result
              }
              onClick={() => {
                if (
                  (!warning || clock.read().eligible) &&
                  !workloadReview?.pending &&
                  result &&
                  !pending
                ) {
                  runAttempt(() => onConfirm(result.ticket?.id));
                }
              }}
            >
              {pending
                ? t("working")
                : warning && remaining !== null && remaining > 0
                  ? t("wait", { seconds: remaining })
                  : warning
                    ? t("confirm")
                    : workloadText("continue")}
            </Button>
          )}
        </>
      }
    >
      {warning && (
        <ul className="my-5 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {result?.mismatches.map((m) => (
            <li key={`${m.tutorId}:${m.subjectId}`}>
              {t("mismatch", { tutor: m.tutorName, subject: m.subjectName })}
            </li>
          ))}
        </ul>
      )}
      {advisory}
      {warning && workloadReview?.warning && (
        <p className="my-4 text-sm leading-relaxed">{workloadReview.warning}</p>
      )}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {status}
      </p>
      {expired && (
        <p className="my-3 text-sm text-amber-800">
          {t("confirmationExpired")}
        </p>
      )}
      {(error ?? prepare.error?.message) && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error ?? prepare.error?.message}
        </p>
      )}
    </Modal>
  );
}
