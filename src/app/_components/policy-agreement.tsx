"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Markdown } from "~/app/_components/markdown";

type Policy = { title: string; body: string } | null | undefined;

/**
 * Agreement checkbox whose label links to the program policy. Clicking the policy name opens a
 * modal; the checkbox stays disabled until the reader scrolls to the end of the policy and closes
 * it via "Done". Used on the tutee and tutor signup forms. Falls back to an immediately-checkable
 * box if no policy document is configured.
 */
export function PolicyAgreement({
  messageKey,
  appTitle,
  policy,
  checked,
  onChange,
}: {
  /** i18n key of the agreement sentence; must contain a `<policy>…</policy>` tag. */
  messageKey: string;
  appTitle: string;
  policy: Policy;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [hasRead, setHasRead] = useState(false);

  const requiresRead = !!policy?.body;
  const canCheck = hasRead || !requiresRead;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          disabled={!canCheck}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-slate-700">
          {t.rich(messageKey, {
            appTitle,
            policy: (chunks) => (
              <button
                type="button"
                className="link"
                onClick={() => requiresRead && setOpen(true)}
              >
                {chunks}
              </button>
            ),
          })}
        </span>
      </label>
      {requiresRead && !hasRead && (
        <p className="muted mt-2 text-xs">{t("public.policy.mustRead")}</p>
      )}
      {open && policy && (
        <PolicyModal
          title={policy.title}
          body={policy.body}
          onClose={() => setOpen(false)}
          onRead={() => {
            setHasRead(true);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PolicyModal({
  title,
  body,
  onClose,
  onRead,
}: {
  title: string;
  body: string;
  onClose: () => void;
  onRead: () => void;
}) {
  const t = useTranslations();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    // A policy short enough to fit without scrolling counts as read-to-end right away.
    if (el && el.scrollHeight <= el.clientHeight + 4) setAtBottom(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setAtBottom(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-2xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="section-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("public.policy.close")}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="overflow-y-auto px-5 py-4 text-sm leading-relaxed text-slate-700"
        >
          <Markdown>{body}</Markdown>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <span className="muted text-xs">
            {atBottom ? t("public.policy.readPrompt") : t("public.policy.scrollPrompt")}
          </span>
          <button
            type="button"
            className="btn-primary"
            disabled={!atBottom}
            onClick={onRead}
          >
            {t("public.policy.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
