"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";

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
  | ({ kind: "confirm"; requestId: number } & ConfirmOpts)
  | ({ kind: "prompt"; requestId: number } & PromptOpts)
  | null;

export function useDialog() {
  const [state, setState] = useState<DialogState>(null);
  const sequence = useRef(0);
  const resolver = useRef<((value: boolean | string | null) => void) | null>(
    null,
  );
  // Never leave a caller waiting after navigation or a superseding prompt.
  useEffect(
    () => () => {
      resolver.current?.(null);
      resolver.current = null;
    },
    [],
  );

  const settle = useCallback((value: boolean | string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  /** Ask a yes/no question. Resolves true when confirmed, false otherwise. */
  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(null);
        resolver.current = (v) => resolve(v === true);
        setState({ kind: "confirm", requestId: ++sequence.current, ...opts });
      }),
    [],
  );

  /** Collect a short reason. Resolves the (trimmed) text when confirmed, or null when cancelled. */
  const promptText = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        resolver.current?.(null);
        resolver.current = (v) => resolve(typeof v === "string" ? v : null);
        setState({ kind: "prompt", requestId: ++sequence.current, ...opts });
      }),
    [],
  );

  const dialog = state ? (
    <DialogView
      key={state.requestId}
      state={state}
      onCancel={() => settle(state.kind === "prompt" ? null : false)}
      onConfirm={(reason) =>
        settle(state.kind === "prompt" ? (reason ?? "") : true)
      }
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
  const [value, setValue] = useState(
    isPrompt ? (state.defaultValue ?? "") : "",
  );
  const blocked = isPrompt && !!state.required && value.trim().length === 0;
  return (
    <Modal
      title={state.title}
      description={state.message}
      onClose={onCancel}
      footer={
        <>
          <Button
            data-dialog-autofocus={!isPrompt || undefined}
            onClick={onCancel}
          >
            {state.cancelLabel}
          </Button>
          <Button
            variant={state.danger ? "danger" : "primary"}
            disabled={blocked}
            onClick={() => onConfirm(isPrompt ? value.trim() : undefined)}
          >
            {state.confirmLabel}
          </Button>
        </>
      }
    >
      {isPrompt && (
        <label className="block space-y-1">
          <span className="label">{state.reasonLabel}</span>
          <textarea
            data-dialog-autofocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={state.placeholder}
            rows={3}
            className="textarea"
          />
        </label>
      )}
    </Modal>
  );
}
