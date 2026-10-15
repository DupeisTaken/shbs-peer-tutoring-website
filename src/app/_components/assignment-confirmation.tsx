"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  assignmentIdentity,
  type AssignmentOperation,
} from "~/lib/assignment-qualification";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";

/** Remount on any selection change: late preparation responses cannot unlock a new selection. */
export function AssignmentConfirmation(props: {
  operation: AssignmentOperation;
  payload: unknown;
  busy?: boolean;
  error?: string;
  onConfirm: (overrideTicket?: string) => void;
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
  const prepare = api.assignment.prepare.useMutation();
  const cancel = api.assignment.cancel.useMutation();
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof prepare.mutateAsync>
  > | null>(null);
  const [remaining, setRemaining] = useState(3);
  const [acknowledged, setAcknowledged] = useState(false);
  const callbacks = useRef({ onConfirm, onCancel });
  useEffect(() => {
    callbacks.current = { onConfirm, onCancel };
  }, [onConfirm, onCancel]);
  const ticketRef = useRef<string | null>(null);
  const submitted = useRef(false);
  const { mutateAsync } = prepare;
  const cancelTicket = cancel.mutate;
  useEffect(() => {
    let live = true;
    // Defer one microtask so Strict Mode's throwaway effect cannot create a competing
    // server ticket that invalidates the visible dialog's acknowledgement.
    void Promise.resolve()
      .then(async () => {
        if (!live) return;
        const data = await mutateAsync({ operation, payload });
        if (!live) {
          if (data.ticket) cancelTicket({ ticket: data.ticket.id });
          return;
        }
        ticketRef.current = data.ticket?.id ?? null;
        setResult(data);
      })
      .catch(() => {
        /* The mutation error is displayed in the dialog. */
      });
    return () => {
      live = false;
      if (ticketRef.current) cancelTicket({ ticket: ticketRef.current });
    };
    // The keyed parent supplies an immutable selection for this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutateAsync, cancelTicket]);
  useEffect(() => {
    // A fresh workload read must finish before the qualified fast path can submit.
    // A failed advisory read does not create a new permission or block assignment.
    if (
      result &&
      !result.mismatches.length &&
      !workloadReview?.pending &&
      !workloadReview?.warning &&
      !submitted.current
    ) {
      submitted.current = true;
      callbacks.current.onConfirm();
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
  useEffect(() => {
    if (!result?.ticket) return;
    // Start when the mismatch actually appears, using monotonic time to avoid wall-clock jumps.
    const opened = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const left = Math.max(0, 3000 - (performance.now() - opened));
      setRemaining(Math.ceil(left / 1000));
      if (left > 0) timer = setTimeout(tick, Math.min(left, 1000));
    };
    tick();
    return () => clearTimeout(timer);
  }, [result]);
  const warning = !!result?.mismatches.length;
  return (
    <Modal
      busy={busy}
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
          <Button data-dialog-autofocus onClick={onCancel}>
            {t("cancel")}
          </Button>
          {(warning || Boolean(workloadReview?.warning)) && (
            <Button
              variant="primary"
              className="whitespace-normal"
              disabled={
                (warning && remaining > 0) ||
                Boolean(workloadReview?.pending) ||
                acknowledged ||
                !result
              }
              onClick={() => {
                if (
                  (!warning || remaining === 0) &&
                  !workloadReview?.pending &&
                  result &&
                  !submitted.current
                ) {
                  submitted.current = true;
                  setAcknowledged(true);
                  onConfirm(result.ticket?.id);
                }
              }}
            >
              {busy
                ? t("working")
                : warning && remaining
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
      {(error ?? prepare.error?.message) && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error ?? prepare.error?.message}
        </p>
      )}
    </Modal>
  );
}
