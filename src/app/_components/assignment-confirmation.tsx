"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { assignmentIdentity, type AssignmentOperation } from "~/lib/assignment-qualification";

/** Remount on any selection change: late preparation responses cannot unlock a new selection. */
export function AssignmentConfirmation(props: {
  operation: AssignmentOperation; payload: unknown; busy?: boolean; error?: string;
  onConfirm: (overrideTicket?: string) => void; onCancel: () => void;
}) {
  return <ConfirmationInstance key={`${props.operation}:${assignmentIdentity(props.payload)}`} {...props} />;
}

function ConfirmationInstance({ operation, payload, busy = false, error, onConfirm, onCancel }: Parameters<typeof AssignmentConfirmation>[0]) {
  const t = useTranslations("assignmentQualification");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const prepare = api.assignment.prepare.useMutation();
  const cancel = api.assignment.cancel.useMutation();
  const [result, setResult] = useState<Awaited<ReturnType<typeof prepare.mutateAsync>> | null>(null);
  const [remaining, setRemaining] = useState(3);
  const [acknowledged, setAcknowledged] = useState(false);
  const callbacks = useRef({ onConfirm, onCancel });
  useEffect(() => { callbacks.current = { onConfirm, onCancel }; }, [onConfirm, onCancel]);
  const ticketRef = useRef<string | null>(null);
  const submitted = useRef(false);
  const { mutateAsync } = prepare;
  const cancelTicket = cancel.mutate;
  useEffect(() => {
    let live = true;
    void mutateAsync({ operation, payload }).then((data) => {
      if (!live) {
        if (data.ticket) cancelTicket({ ticket: data.ticket.id });
        return;
      }
      ticketRef.current = data.ticket?.id ?? null;
      setResult(data);
      if (!data.mismatches.length) { submitted.current = true; callbacks.current.onConfirm(); }
    }).catch(() => { /* The mutation error is displayed in the dialog. */ });
    return () => {
      live = false;
      if (ticketRef.current && !submitted.current) cancelTicket({ ticket: ticketRef.current });
    };
    // The keyed parent supplies an immutable selection for this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutateAsync, cancelTicket]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    const queued = () => callbacks.current.onCancel();
    window.addEventListener("approval-queued", queued);
    return () => { window.removeEventListener("approval-queued", queued); previous?.focus(); };
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
  return <dialog ref={ref} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60">
    <h2 id={titleId} className="text-xl font-bold">{t(warning ? "warningTitle" : "checking")}</h2>
    <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-slate-600">{t(warning ? "warningHelp" : "checkingHelp")}</p>
    {warning && <ul className="my-5 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      {result?.mismatches.map((m) => <li key={`${m.tutorId}:${m.subjectId}`}>{t("mismatch", { tutor: m.tutorName, subject: m.subjectName })}</li>)}
    </ul>}
    {(error ?? prepare.error?.message) && <p role="alert" className="my-3 text-sm text-red-700">{error ?? prepare.error?.message}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
      <button className="btn-secondary min-h-11 lg:min-h-10" disabled={busy} onClick={onCancel}>{t("cancel")}</button>
      {warning && <button className="btn-primary min-h-11 whitespace-normal lg:min-h-10" disabled={remaining > 0 || busy || acknowledged}
        onClick={() => {
          if (remaining === 0 && result?.ticket && !submitted.current) {
            submitted.current = true;
            setAcknowledged(true);
            onConfirm(result.ticket.id);
          }
        }}>{busy ? t("working") : remaining ? t("wait", { seconds: remaining }) : t("confirm")}</button>}
    </div>
  </dialog>;
}
