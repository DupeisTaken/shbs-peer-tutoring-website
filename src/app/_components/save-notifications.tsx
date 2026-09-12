"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Result = { kind: "success" | "error"; message?: string; id: number };
/** Only settled mutation results enter this live region; errors stay until dismissed. */
export function SaveNotifications() {
  const t = useTranslations("saveNotifications");
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    let sequence = 0;
    const onResult = (event: Event) =>
      setResult({
        ...(event as CustomEvent<Omit<Result, "id">>).detail,
        id: ++sequence,
      });
    const onApproval = () => setResult(null);
    window.addEventListener("admin-save-result", onResult);
    window.addEventListener("approval-queued", onApproval);
    return () => {
      window.removeEventListener("admin-save-result", onResult);
      window.removeEventListener("approval-queued", onApproval);
    };
  }, []);
  useEffect(() => {
    if (result?.kind !== "success") return;
    const timer = window.setTimeout(() => setResult(null), 4500);
    return () => window.clearTimeout(timer);
  }, [result]);
  if (!result) return null;
  return (
    <aside
      role={result.kind === "error" ? "alert" : "status"}
      className={`fixed right-4 bottom-4 left-4 z-50 rounded-xl border bg-white p-4 shadow-xl sm:left-auto sm:w-96 ${result.kind === "error" ? "border-red-300 text-red-800" : "border-emerald-300 text-emerald-900"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <strong>{t(result.kind === "error" ? "failed" : "saved")}</strong>
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-label={t("dismiss")}
          onClick={() => setResult(null)}
        >
          ×
        </button>
      </div>
      {result.kind === "error" && (
        <p className="mt-2 text-sm">{result.message}</p>
      )}
    </aside>
  );
}
