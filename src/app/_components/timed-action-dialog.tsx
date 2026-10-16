"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import type { StudentAction } from "~/server/student-workflow";
import { type AnchoredConfirmation } from "~/lib/confirmation-timing";
import { useConfirmationClock } from "./use-confirmation-clock";
import { useConfirmationSubmission } from "./use-confirmation-submission";

/** Native modal supplies focus trapping/inert background; the one-use server ticket enforces delay. */
function TimedActionInstance({
  action,
  target,
  title,
  message,
  children,
  footerActions,
  onConfirm,
  onCancel,
  busy = false,
  error,
  canConfirm = true,
  mandatory = false,
}: {
  action: StudentAction;
  target: string;
  title: string;
  message: string;
  children?: React.ReactNode;
  /** Feature-owned read/recovery actions beside the unchanged timed confirmation. */
  footerActions?: React.ReactNode;
  /** Return the feature mutation promise for retry admission; void supports review handoff. */
  onConfirm: (ticket: string) => unknown;
  onCancel: () => void;
  busy?: boolean;
  error?: string;
  canConfirm?: boolean;
  mandatory?: boolean;
}) {
  const t = useTranslations("workflow");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const prepare = api.studentWorkflow.prepareAction.useMutation();
  const cancel = api.studentWorkflow.cancelAction.useMutation();
  const { mutateAsync } = prepare;
  const cancelTicket = cancel.mutate;
  const [anchor, setAnchor] = useState<AnchoredConfirmation | null>(null);
  const [attempt, setAttempt] = useState(0);
  const clock = useConfirmationClock(anchor);
  const submission = useConfirmationSubmission(busy, error);
  const ticketRef = useRef<string | null>(null);
  const { submitted } = submission;
  useEffect(() => {
    let live = true;
    // Strict Mode's throwaway effect creates no competing proof. Each mounted
    // action/target owns its response, including any late response after cancellation.
    void Promise.resolve()
      .then(async () => {
        if (!live) return;
        const requestStartedAt = performance.now();
        const ticket = await mutateAsync({ action, target });
        if (!live) {
          cancelTicket({ ticket: ticket.id });
          return;
        }
        ticketRef.current = ticket.id;
        setAnchor({ ticket, requestStartedAt, receivedAt: performance.now() });
      })
      .catch(() => {
        /* The preparation error remains visible for recovery. */
      });
    return () => {
      live = false;
      // Submitted proof may be handed to a qualification warning before the write.
      if (ticketRef.current && !submitted.current)
        cancelTicket({ ticket: ticketRef.current });
    };
  }, [action, target, mutateAsync, cancelTicket, submitted, attempt]);
  useEffect(() => {
    // The proposal consumed this ticket. Close its modal so the queued-review notice is reachable.
    const queued = () => {
      if (!mandatory) onCancel();
    };
    window.addEventListener("approval-queued", queued);
    return () => window.removeEventListener("approval-queued", queued);
  }, [mandatory, onCancel]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const parent = previous?.closest<HTMLDialogElement>("dialog");
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      // Release native inertness before restoring focus. This also makes the
      // Strict Mode setup/cleanup rehearsal capture the real opener again.
      dialog?.close();
      const target =
        previous?.isConnected &&
        !previous.matches(':disabled, [aria-disabled="true"]') &&
        !previous.closest("[hidden], [inert]")
          ? previous
          : parent?.isConnected
            ? parent
            : null;
      target?.focus();
    };
  }, []);
  const { remaining, expired } = clock;
  const pending = busy || submission.admitted;
  const blocked = !clock.eligible || pending || !canConfirm;
  const status = pending
    ? t("working")
    : expired
      ? t("confirmationExpired")
      : remaining === null
        ? t("preparing")
        : remaining
          ? t("wait", { seconds: remaining })
          : t("confirm");
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      // Match NativeDialog's close-watcher guard. Repeated Escape can bypass a
      // cancelled native close request; mandatory policy review also blocks it
      // while idle, without treating the policy's Sign out action as pending.
      closedby={pending || mandatory ? "none" : "closerequest"}
      onKeyDown={(event) => {
        if (
          (pending || mandatory) &&
          event.key === "Escape" &&
          event.target instanceof Element &&
          event.target.closest("dialog") === event.currentTarget
        )
          event.preventDefault();
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!mandatory && !pending) onCancel();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60"
    >
      <p className="mb-2 text-xs font-semibold tracking-widest text-slate-500 uppercase">
        {t("pleaseReview")}
      </p>
      <h2 id={titleId} className="text-xl font-bold">
        {title}
      </h2>
      <p
        id={descriptionId}
        className="mt-3 text-sm leading-relaxed whitespace-pre-line text-slate-600"
      >
        {message}
      </p>
      <div className="my-5 space-y-4">{children}</div>
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
      <footer className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
        {footerActions}
        {(expired || prepare.error) && !footerActions && (
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => {
              prepare.reset();
              setAnchor(null);
              setAttempt((value) => value + 1);
            }}
          >
            {t("retry")}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={onCancel}
        >
          {t(mandatory ? "signOut" : "cancel")}
        </button>
        <button
          type="button"
          className={
            ["RECALL", "ABORT", "APPROVE"].includes(action)
              ? "btn-danger"
              : "btn-primary"
          }
          disabled={blocked}
          aria-describedby={statusId}
          onClick={() => {
            // Recheck elapsed time/expiry at admission, even after suspended timers.
            if (busy || !canConfirm || !anchor || !clock.read().eligible)
              return;
            submission.run(() => onConfirm(anchor.ticket.id));
          }}
        >
          {pending
            ? t("working")
            : expired
              ? t("confirm")
              : remaining === null
                ? t("preparing")
                : remaining
                  ? t("wait", { seconds: remaining })
                  : t("confirm")}
        </button>
      </footer>
    </dialog>
  );
}

/** A changed action/target cannot inherit a prepared ticket or a duplicate-write lock. */
export function TimedActionDialog(
  props: Parameters<typeof TimedActionInstance>[0],
) {
  return (
    <TimedActionInstance key={`${props.action}:${props.target}`} {...props} />
  );
}
