"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import type { StudentAction } from "~/server/student-workflow";

/** Native modal supplies focus trapping/inert background; the one-use server ticket enforces delay. */
export function TimedActionDialog({
  action,
  target,
  title,
  message,
  children,
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
  onConfirm: (ticket: string) => void;
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
  const prepare = api.studentWorkflow.prepareAction.useMutation();
  const { mutate } = prepare;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    mutate({ action, target });
  }, [action, target, mutate]);
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
    ref.current?.showModal();
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(timer);
      previous?.focus();
    };
  }, []);
  const remaining = prepare.data
    ? Math.max(0, Math.ceil((+new Date(prepare.data.readyAt) - now) / 1000))
    : null;
  const blocked = remaining !== 0 || busy || !canConfirm;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(e) => {
        e.preventDefault();
        if (!mandatory && !busy) onCancel();
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
      {(error ?? prepare.error?.message) && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error ?? prepare.error?.message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
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
          onClick={() => {
            if (!blocked && prepare.data) onConfirm(prepare.data.id);
          }}
        >
          {busy
            ? t("working")
            : remaining === null
              ? t("preparing")
              : remaining
                ? t("wait", { seconds: remaining })
                : t("confirm")}
        </button>
      </div>
    </dialog>
  );
}
