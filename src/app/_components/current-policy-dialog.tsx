"use client";

import { useEffect, useId, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Markdown } from "./markdown";

/** Read-only policy viewer: native modality traps focus and keeps the page inert. */
export function CurrentPolicyDialog({
  documents,
  loading,
  error,
  onRetry,
  onClose,
}: {
  documents?: {
    locale: string;
    title: string;
    body: string;
    version?: string | null;
  }[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const document =
    documents?.find((doc) => doc.locale === locale && doc.body.trim()) ??
    documents?.find((doc) => doc.locale === "en" && doc.body.trim());

  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);

  // Hide cached content while refreshing or on failure rather than label it latest.
  const ready = !loading && !error && document;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60"
    >
      <div className="flex max-h-[90dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="min-w-0 self-center">
            <h2 id={titleId} className="text-xl font-bold break-words">
              {ready ? document.title : t("workflows.policy")}
            </h2>
            {ready && document.version && (
              <span className="badge-slate mt-2">{document.version}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("public.policy.close")}
            className="btn-secondary min-h-11 min-w-11 shrink-0"
          >
            ✕
          </button>
        </header>
        <div
          role="region"
          aria-labelledby={titleId}
          aria-busy={loading}
          tabIndex={0}
          className="min-h-0 overflow-y-auto px-5 py-4 text-sm leading-relaxed"
        >
          {loading ? (
            <p role="status">{t("workflows.loading")}</p>
          ) : !ready ? (
            <div className="space-y-3">
              <p role="alert">{t("workflow.policyLoadError")}</p>
              <button
                type="button"
                className="btn-secondary min-h-11"
                onClick={onRetry}
              >
                {t("workflow.retry")}
              </button>
            </div>
          ) : (
            <Markdown>{document.body}</Markdown>
          )}
        </div>
      </div>
    </dialog>
  );
}
