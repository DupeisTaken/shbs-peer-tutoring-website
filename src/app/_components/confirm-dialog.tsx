"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * A calm, deliberate confirm / prompt dialog that replaces the native `window.confirm` and
 * `window.prompt` popups. Drive it with the `useDialog()` hook, which exposes promise-based
 * helpers so a call site reads almost like the browser primitives it replaces:
 *
 *   const { confirm, promptText, dialog } = useDialog();
 *   if (await confirm({ title, confirmLabel, cancelLabel, danger: true })) del.mutate();
 *   const reason = await promptText({ title, reasonLabel, confirmLabel, cancelLabel });
 *   return (<>{dialog}<button …/></>);
 *
 * All copy is passed in (already translated) — the component hardcodes none.
 */

type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Style the confirm action as destructive (uses .btn-danger). */
  danger?: boolean;
};

type PromptOpts = ConfirmOpts & {
  reasonLabel: string;
  placeholder?: string;
  /** Require a non-empty reason before the confirm action enables. */
  required?: boolean;
  defaultValue?: string;
};

type DialogState =
  | ({ kind: "confirm" } & ConfirmOpts)
  | ({ kind: "prompt" } & PromptOpts)
  | null;

export function useDialog() {
  const [state, setState] = useState<DialogState>(null);
  const resolver = useRef<((value: boolean | string | null) => void) | null>(null);

  const settle = useCallback((value: boolean | string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  /** Ask a yes/no question. Resolves true when confirmed, false otherwise. */
  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        resolver.current = (v) => resolve(v === true);
        setState({ kind: "confirm", ...opts });
      }),
    [],
  );

  /** Collect a short reason. Resolves the (trimmed) text when confirmed, or null when cancelled. */
  const promptText = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        resolver.current = (v) => resolve(typeof v === "string" ? v : null);
        setState({ kind: "prompt", ...opts });
      }),
    [],
  );

  const dialog = state ? (
    <DialogView
      state={state}
      onCancel={() => settle(state.kind === "prompt" ? null : false)}
      onConfirm={(reason) => settle(state.kind === "prompt" ? (reason ?? "") : true)}
    />
  ) : null;

  return { confirm, promptText, dialog };
}

function DialogView({
  state,
  onCancel,
  onConfirm,
}: {
  state: NonNullable<DialogState>;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}) {
  const isPrompt = state.kind === "prompt";
  const [value, setValue] = useState(isPrompt ? (state.defaultValue ?? "") : "");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Focus the first useful control on open; restore focus to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (isPrompt ? inputRef.current : confirmRef.current)?.focus();
    return () => previouslyFocused?.focus?.();
  }, [isPrompt]);

  // Escape always cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const blocked = isPrompt && !!state.required && value.trim().length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card w-full max-w-md space-y-4 p-5 shadow-xl motion-safe:animate-[dialog-pop_140ms_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {state.title}
          </h2>
          {state.message && (
            <p className="text-sm leading-relaxed text-slate-600">{state.message}</p>
          )}
        </div>

        {isPrompt && (
          <label className="block space-y-1">
            <span className="label">{state.reasonLabel}</span>
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={state.placeholder}
              rows={3}
              className="input w-full resize-none"
            />
          </label>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {state.cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={state.danger ? "btn-danger" : "btn-primary"}
            disabled={blocked}
            onClick={() => onConfirm(isPrompt ? value.trim() : undefined)}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
