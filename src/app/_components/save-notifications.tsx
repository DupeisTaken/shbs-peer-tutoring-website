"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Result = { kind: "success" | "error"; message?: string; id: number };
/** One bounded viewport prevents approval and saved/error notices covering one another. */
export function NotificationViewport({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 left-3 z-50 flex max-h-[70dvh] flex-col gap-3 overflow-y-auto p-1 sm:left-auto sm:w-[25rem]">
      {children}
    </div>
  );
}

/** Only settled mutation results enter this live region; errors stay until dismissed. */
export function SaveNotifications() {
  const t = useTranslations("saveNotifications");
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    let sequence = 0;
    const onResult = (event: Event) => {
      const next = {
        ...(event as CustomEvent<Omit<Result, "id">>).detail,
        id: ++sequence,
      };
      // Keep unresolved failures across later writes. Repeat errors collapse without losing their text.
      setResults((current) => [
        ...current.filter(
          (item) =>
            item.kind === "error" &&
            !(next.kind === "error" && item.message === next.message),
        ),
        next,
      ]);
    };
    const onApproval = () =>
      setResults((current) => current.filter((item) => item.kind === "error"));
    window.addEventListener("admin-save-result", onResult);
    window.addEventListener("approval-queued", onApproval);
    return () => {
      window.removeEventListener("admin-save-result", onResult);
      window.removeEventListener("approval-queued", onApproval);
    };
  }, []);
  const successId = results.find((item) => item.kind === "success")?.id;
  useEffect(() => {
    if (successId === undefined) return;
    const timer = window.setTimeout(
      () =>
        setResults((current) =>
          current.filter((item) => item.id !== successId),
        ),
      4500,
    );
    return () => window.clearTimeout(timer);
  }, [successId]);
  return results.map((result) => (
    <aside
      key={result.id}
      role={result.kind === "error" ? "alert" : "status"}
      className={`pointer-events-auto w-full rounded-xl border bg-white p-4 shadow-xl ${result.kind === "error" ? "border-red-300 text-red-800" : "border-emerald-300 text-emerald-900"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <strong>{t(result.kind === "error" ? "failed" : "saved")}</strong>
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-label={t("dismiss")}
          onClick={() =>
            setResults((current) =>
              current.filter((item) => item.id !== result.id),
            )
          }
        >
          ×
        </button>
      </div>
      {result.kind === "error" && (
        <p className="mt-2 text-sm">{result.message}</p>
      )}
    </aside>
  ));
}
