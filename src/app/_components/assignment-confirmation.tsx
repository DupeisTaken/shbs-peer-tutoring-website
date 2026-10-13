"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  assignmentIdentity,
  type AssignmentOperation,
} from "~/lib/assignment-qualification";
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
}: Parameters<typeof AssignmentConfirmation>[0]) {
  const t = useTranslations("assignmentQualification");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
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
  const callbacks = useRef({ onConfirm, onCancel });
  useEffect(() => {
    callbacks.current = { onConfirm, onCancel };
  }, [onConfirm, onCancel]);
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
        setResult(data);
        setAnchor(
          data.ticket
            ? {
                ticket: data.ticket,
                requestStartedAt,
                receivedAt: performance.now(),
              }
            : null,
        );
        if (!data.mismatches.length)
          submission.run(() => callbacks.current.onConfirm());
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
    const previous = document.activeElement as HTMLElement | null;
    const modal = ref.current;
    modal?.showModal();
    const queued = () => callbacks.current.onCancel();
    window.addEventListener("approval-queued", queued);
    return () => {
      window.removeEventListener("approval-queued", queued);
      // Close before restoring focus: an open modal makes the trigger inert, including
      // during development effect replay. Removing the node alone is too late.
      modal?.close();
      previous?.focus();
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
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      closedby={pending ? "none" : "closerequest"}
      onKeyDown={(event) => {
        if (pending && event.key === "Escape") event.preventDefault();
        // Keep Tab inside the two explicit choices; native modal inertness alone can
        // still let Chromium move focus to browser chrome after the final control.
        if (
          event.key !== "Tab" ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not([disabled])",
          ),
        ];
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60"
    >
      <h2 id={titleId} className="text-xl font-bold">
        {t(warning ? "warningTitle" : "checking")}
      </h2>
      <p
        id={descriptionId}
        className="mt-3 text-sm leading-relaxed text-slate-600"
      >
        {t(warning ? "warningHelp" : "checkingHelp")}
      </p>
      {warning && (
        <ul className="my-5 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {result?.mismatches.map((m) => (
            <li key={`${m.tutorId}:${m.subjectId}`}>
              {t("mismatch", { tutor: m.tutorName, subject: m.subjectName })}
            </li>
          ))}
        </ul>
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
      <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
        {(expired || prepare.error || (!warning && error)) && (
          <button
            type="button"
            className="btn-secondary min-h-11 lg:min-h-10"
            disabled={pending}
            onClick={() => {
              prepare.reset();
              setResult(null);
              setAnchor(null);
              setAttempt((value) => value + 1);
            }}
          >
            {t("retry")}
          </button>
        )}
        <button
          className="btn-secondary min-h-11 lg:min-h-10"
          disabled={pending}
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        {warning && (
          <button
            className="btn-primary min-h-11 whitespace-normal lg:min-h-10"
            aria-describedby={statusId}
            disabled={!clock.eligible || pending}
            onClick={() => {
              if (!busy && result?.ticket && clock.read().eligible) {
                submission.run(() => onConfirm(result.ticket!.id));
              }
            }}
          >
            {pending
              ? t("working")
              : expired || remaining === null
                ? t("confirm")
                : remaining
                  ? t("wait", { seconds: remaining })
                  : t("confirm")}
          </button>
        )}
      </div>
    </dialog>
  );
}
