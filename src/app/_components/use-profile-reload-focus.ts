"use client";

import { useEffect, useRef, type RefObject } from "react";

/** A section reload is a cancellable read, so it needs its own focus handoff.
 * Never steal focus if the user moved to another section or a nested dialog. */
export function useProfileReloadFocus(
  formRef: RefObject<HTMLFormElement | null>,
  reloading: boolean,
) {
  const opener = useRef<HTMLElement | null>(null);
  const outcome = useRef<boolean | null>(null);
  useEffect(() => {
    if (reloading || outcome.current === null) return;
    const succeeded = outcome.current;
    outcome.current = null;
    const form = formRef.current;
    if (!form?.isConnected) return;
    if (
      document.activeElement !== document.body &&
      document.activeElement !== opener.current
    )
      return;
    if (!succeeded && opener.current?.isConnected) {
      opener.current.focus();
      return;
    }
    form
      .querySelector<HTMLElement>(
        "input:not(:disabled):not([readonly]), select:not(:disabled), textarea:not(:disabled):not([readonly])",
      )
      ?.focus();
  });
  return {
    beginReload: () => {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    },
    finishReload: (succeeded: boolean) => {
      outcome.current = succeeded;
    },
  };
}
