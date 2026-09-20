"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { FieldState } from "~/lib/signup-fields";

/** Contain Tab explicitly: native modal inertness alone can let focus reach browser chrome.
 * Only the checked radio is a tab stop; arrow keys keep their native group semantics. */
function containTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const controls = [
    ...dialog.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], [tabindex]",
    ),
  ].filter(
    (control) =>
      !control.matches(":disabled") &&
      control.tabIndex >= 0 &&
      !control.closest("[hidden]"),
  );
  const stops = controls.filter((control) => {
    if (!(control instanceof HTMLInputElement) || control.type !== "radio")
      return true;
    const group = controls.filter(
      (candidate): candidate is HTMLInputElement =>
        candidate instanceof HTMLInputElement &&
        candidate.type === "radio" &&
        candidate.name === control.name,
    );
    return control === (group.find((radio) => radio.checked) ?? group[0]);
  });
  if (!stops.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = stops[0]!;
  const last = stops.at(-1)!;
  if (
    stops.length === 1 ||
    (event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialog)) ||
    (!event.shiftKey && document.activeElement === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/** Native modal dialog makes the background inert and supports Escape.

 * Explicit focus restoration also covers React unmounting the dialog after a successful save. */
export function FieldDialog({
  label,
  initial,
  pending,
  error,
  onClose,
  onSave,
  onReload,
}: {
  label: string;
  initial: FieldState;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSave: (state: FieldState) => void;
  onReload: () => void;
}) {
  const t = useTranslations("signupFields");
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState(initial);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input:checked")?.focus();
    return () => {
      dialog?.close();
      trigger?.focus();
    };
  }, []);
  useEffect(() => {
    // A disabled save control cannot retain focus while the request is pending.
    const dialog = ref.current;
    if (pending) dialog?.focus();
    else if (document.activeElement === dialog)
      dialog?.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, [pending]);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-busy={pending}
      onKeyDown={containTab}
      aria-labelledby="signup-field-title"
      aria-describedby="signup-field-help"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className="card fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto p-5 shadow-xl backdrop:bg-slate-900/50"
    >
      <h2 id="signup-field-title" className="section-title">
        {label}
      </h2>
      <p id="signup-field-help" className="muted mt-2 text-sm">
        {t("popupHelp")}
      </p>
      <fieldset disabled={pending} className="my-5 space-y-2">
        <legend className="sr-only">{t("state")}</legend>
        {(["required", "optional", "hidden"] as const).map((value) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-3"
          >
            <input
              type="radio"
              name="field-state"
              checked={state === value}
              value={value}
              onChange={() => setState(value)}
            />
            {t(value)}
          </label>
        ))}
      </fieldset>
      {error && (
        <div className="mb-4 space-y-2">
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
          <button
            type="button"
            className="btn-secondary min-h-11 lg:min-h-10"
            onClick={onReload}
            disabled={pending}
          >
            {t("reload")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={pending}
          className="btn-secondary min-h-11 lg:min-h-10"
          onClick={onClose}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          disabled={pending}
          className="btn-primary min-h-11 lg:min-h-10"
          onClick={() => onSave(state)}
        >
          {t(pending ? "saving" : "save")}
        </button>
      </div>
    </dialog>
  );
}
