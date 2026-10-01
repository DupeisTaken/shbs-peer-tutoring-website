"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Markdown } from "~/app/_components/markdown";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";

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
      <label className="flex min-h-11 items-start gap-2 text-sm">
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
                className="link inline-flex min-h-11 items-center text-left lg:min-h-0"
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
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 8)
      setAtBottom(true);
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted mr-auto text-xs">
            {t(
              atBottom
                ? "public.policy.readPrompt"
                : "public.policy.scrollPrompt",
            )}
          </span>
          <Button data-dialog-autofocus onClick={onClose}>
            {t("public.policy.close")}
          </Button>
          <Button variant="primary" disabled={!atBottom} onClick={onRead}>
            {t("public.policy.done")}
          </Button>
        </>
      }
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        role="region"
        aria-label={title}
        className="max-h-[50dvh] overflow-y-auto py-2 text-sm leading-relaxed text-slate-700"
      >
        <Markdown>{body}</Markdown>
      </div>
    </Modal>
  );
}
