"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FieldState } from "~/lib/signup-fields";

/** Native modal dialog makes the background inert, traps keyboard focus and supports Escape.
 * Explicit focus restoration also covers React unmounting the dialog after a successful save. */
export function FieldDialog({ label, initial, pending, error, onClose, onSave, onReload }: {
  label: string; initial: FieldState; pending: boolean; error?: string;
  onClose: () => void; onSave: (state: FieldState) => void; onReload: () => void;
}) {
  const t = useTranslations("signupFields");
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState(initial);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby="signup-field-title" aria-describedby="signup-field-help" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} className="card fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto p-5 shadow-xl backdrop:bg-slate-900/50">
    <h2 id="signup-field-title" className="section-title">{label}</h2><p id="signup-field-help" className="muted mt-2 text-sm">{t("popupHelp")}</p>
    <fieldset disabled={pending} className="my-5 space-y-2"><legend className="sr-only">{t("state")}</legend>
      {(["required", "optional", "hidden"] as const).map(value => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-3"><input type="radio" name="field-state" checked={state === value} value={value} onChange={() => setState(value)} />{t(value)}</label>)}
    </fieldset>
    {error && <div className="mb-4 space-y-2"><p role="alert" className="text-sm text-red-600">{error}</p><button type="button" className="btn-secondary min-h-11 lg:min-h-10" onClick={onReload}>{t("reload")}</button></div>}
    <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={pending} className="btn-secondary min-h-11 lg:min-h-10" onClick={onClose}>{t("cancel")}</button><button type="button" disabled={pending} className="btn-primary min-h-11 lg:min-h-10" onClick={() => onSave(state)}>{t(pending ? "saving" : "save")}</button></div>
  </dialog>;
}
