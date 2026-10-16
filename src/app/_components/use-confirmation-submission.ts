"use client";
import { useEffect, useRef, useState } from "react";

/** Admit once before pending props can render. Returned mutation promises release
 * the guard even for fast identical-error rejections whose pending render was batched away.
 * Void callbacks support dialog handoffs; existing prop transitions remain their fallback. */
export function useConfirmationSubmission(busy: boolean, error?: string) {
  const submitted = useRef(false);
  const previous = useRef({ busy, error });
  const [admitted, setAdmitted] = useState(false);
  useEffect(() => {
    const prior = previous.current;
    previous.current = { busy, error };
    if (
      submitted.current &&
      !busy &&
      error &&
      (prior.busy || prior.error !== error)
    ) {
      submitted.current = false;
      setAdmitted(false);
    }
  }, [busy, error]);
  return {
    submitted,
    admitted,
    run: (callback: () => unknown) => {
      if (submitted.current) return false;
      submitted.current = true;
      setAdmitted(true);
      const rejected = () => {
        submitted.current = false;
        setAdmitted(false);
      };
      try {
        // Feature mutations retain their own error display and transaction recovery.
        void Promise.resolve(callback()).catch(rejected);
      } catch (error) {
        rejected();
        throw error;
      }
      return true;
    },
  };
}
