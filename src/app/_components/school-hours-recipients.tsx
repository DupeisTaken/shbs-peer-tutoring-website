"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Button } from "./ui/button";

export type SchoolHoursRecipient = { email: string; label: string };
type Editor = SchoolHoursRecipient & { index: number | null };
const emailSchema = z.string().trim().email().max(254);

/** Entries are a schedule draft; only the parent's reviewed Save persists them. */
export function SchoolHoursRecipients({
  value,
  onChange,
  onEditingChange,
}: {
  value: SchoolHoursRecipient[];
  onChange: (value: SchoolHoursRecipient[]) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const t = useTranslations("schoolHours");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const editButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState<
    "recipientInvalid" | "recipientDuplicate" | null
  >(null);
  const editing = editor !== null;
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (opener.current) {
      // Editing an address replaces its keyed row, so focus the live Edit control.
      (focusIndex.current === null
        ? opener.current
        : editButtons.current[focusIndex.current]
      )?.focus();
    }
  }, [editing]);

  function close() {
    setEditor(null);
    setError(null);
    onEditingChange(false);
  }
  function accept() {
    if (!editor) return;
    const email = editor.email.trim().toLowerCase();
    if (!emailSchema.safeParse(email).success) {
      setError("recipientInvalid");
      input.current?.focus();
      return;
    }
    if (
      value.some(
        (row, index) =>
          index !== editor.index && row.email.toLowerCase() === email,
      )
    ) {
      setError("recipientDuplicate");
      input.current?.focus();
      return;
    }
    const recipient = { email, label: editor.label.trim() };
    onChange(
      editor.index === null
        ? [...value, recipient]
        : value.map((row, index) => (index === editor.index ? recipient : row)),
    );
    close();
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <h4 id={`${id}-title`} className="font-semibold text-slate-900">
            {t("recipients")}
          </h4>
          <p className="mt-1 text-xs text-slate-600" aria-live="polite">
            {t("recipientCount", { count: value.length })}
          </p>
        </div>
        <Button
          size="compact"
          className="w-full sm:w-auto"
          aria-expanded={editing}
          aria-controls={`${id}-editor`}
          disabled={editing || value.length >= 100}
          onClick={(event) => {
            opener.current = event.currentTarget;
            focusIndex.current = null;
            setEditor({ index: null, email: "", label: "" });
            setError(null);
            onEditingChange(true);
          }}
        >
          <span aria-hidden="true">+ </span>
          {t("addRecipient")}
        </Button>
      </div>
      {value.length ? (
        <ul
          aria-label={t("recipients")}
          className="divide-y divide-slate-100 px-4"
        >
          {value.map((recipient, index) => (
            <li
              key={recipient.email}
              className="flex flex-col items-start justify-between gap-x-4 gap-y-1 py-3 sm:flex-row sm:items-center"
            >
              <div className="flex w-full min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto">
                <span className="min-w-0 font-medium break-all text-slate-900">
                  {recipient.email}
                </span>
                <span
                  className={`max-w-full rounded-full px-2.5 py-1 text-xs font-medium [overflow-wrap:anywhere] ${recipient.label ? "bg-accent-100 text-accent-800" : "bg-slate-100 text-slate-600"}`}
                >
                  {recipient.label || t("noRecipientLabel")}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                <Button
                  ref={(button) => {
                    editButtons.current[index] = button;
                  }}
                  size="compact"
                  variant="ghost"
                  disabled={editing}
                  aria-label={t("editRecipientEmail", {
                    email: recipient.email,
                  })}
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    focusIndex.current = index;
                    setEditor({ index, ...recipient });
                    setError(null);
                    onEditingChange(true);
                  }}
                >
                  {t("editRecipient")}
                </Button>
                <Button
                  size="compact"
                  variant="ghost"
                  className="text-red-700"
                  disabled={editing}
                  aria-label={t("removeRecipientEmail", {
                    email: recipient.email,
                  })}
                  onClick={() =>
                    onChange(value.filter((_, row) => row !== index))
                  }
                >
                  {t("removeRecipient")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-6">
          <p className="font-medium text-slate-800">{t("noRecipients")}</p>
          <p className="mt-1 text-slate-600">{t("noRecipientsHelp")}</p>
        </div>
      )}
      {editor && (
        <div
          id={`${id}-editor`}
          role="group"
          aria-label={t(
            editor.index === null ? "addRecipient" : "editRecipient",
          )}
          className="space-y-3 border-t border-slate-200 bg-slate-50 p-4"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              event.key === "Enter" &&
              event.target instanceof HTMLInputElement
            ) {
              event.preventDefault();
              accept();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <label className="block min-w-0 space-y-1" htmlFor={`${id}-email`}>
              <span className="block font-medium">{t("recipientEmail")}</span>
              <input
                ref={input}
                id={`${id}-email`}
                type="email"
                autoComplete="off"
                maxLength={254}
                className="input w-full"
                value={editor.email}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setEditor({ ...editor, email: event.target.value });
                  setError(null);
                }}
              />
            </label>
            <label className="block min-w-0 space-y-1" htmlFor={`${id}-label`}>
              <span className="block font-medium">{t("recipientLabel")}</span>
              <input
                id={`${id}-label`}
                maxLength={80}
                className="input w-full"
                value={editor.label}
                aria-describedby={`${id}-label-help`}
                onChange={(event) =>
                  setEditor({ ...editor, label: event.target.value })
                }
              />
            </label>
          </div>
          <p id={`${id}-label-help`} className="text-xs text-slate-600">
            {t("recipientLabelHelp")}
          </p>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-red-700">
              {t(error)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="compact" onClick={accept}>
              {t(editor.index === null ? "addRecipient" : "updateRecipient")}
            </Button>
            <Button size="compact" onClick={close}>
              {t("cancelRecipient")}
            </Button>
          </div>
        </div>
      )}
      <p
        id={`${id}-help`}
        className="border-t border-slate-200 px-4 py-3 text-xs leading-relaxed text-slate-600"
      >
        {t("recipientsHelp")}
      </p>
    </section>
  );
}
