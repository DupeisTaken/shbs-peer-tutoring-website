"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** Queued proposals are deliberately not mutation successes: existing editors keep their
 * values instead of navigating away or pretending a live record was saved. */
export function ApprovalNotice() {
  const t = useTranslations("approvals");
  const [requestId, setRequestId] = useState<string | null>(null);
  useEffect(() => {
    const onQueued = (event: Event) =>
      setRequestId((event as CustomEvent<string>).detail);
    window.addEventListener("approval-queued", onQueued);
    return () => window.removeEventListener("approval-queued", onQueued);
  }, []);
  if (!requestId) return null;
  return (
    <aside
      role="status"
      className="pointer-events-auto w-full rounded-xl border border-emerald-300 bg-white p-5 shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <strong className="text-emerald-900">{t("queued")}</strong>
        <button
          className="btn-ghost btn-sm"
          aria-label={t("dismiss")}
          onClick={() => setRequestId(null)}
        >
          ×
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-600">{t("queuedBody")}</p>
      <Link
        className="link mt-3 inline-block"
        href={`/admin/approvals?request=${requestId}`}
        onClick={() => setRequestId(null)}
      >
        {t("viewRequest")}
      </Link>
    </aside>
  );
}
