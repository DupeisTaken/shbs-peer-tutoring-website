"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AuditFilters,
  type AuditFilterInput,
} from "~/app/_components/audit-filters";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";

/**
 * Audit trail of admin mutations. Entries that carry undo data can be reverted with one
 * click (see src/server/audit/log.ts). Supports the revertibility philosophy in CLAUDE.md.
 */
function AuditLog() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const params = useSearchParams();
  const approvalId = params.get("approval") ?? undefined;
  const [filters, setFilters] = useState<AuditFilterInput>({});
  const [cursors, setCursors] = useState<string[]>([]);
  const log = api.admin.auditLog.useQuery({
    ...filters,
    approvalId,
    cursor: cursors.at(-1),
  });
  const undo = api.admin.undoAudit.useMutation({
    onSuccess: () => utils.admin.auditLog.invalidate(),
  });

  const entries = log.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.audit.title")}</h1>
        <p className="muted mt-1">{t("auditFilters.subtitle")}</p>
      </div>
      <AuditFilters
        onApply={(input) => {
          setFilters(input);
          setCursors([]);
        }}
      />
      {approvalId && (
        <Link className="link" href="/admin/audit">
          {t("auditFilters.allHistory")}
        </Link>
      )}
      {log.error && (
        <p role="alert" className="text-red-700">
          {log.error.message}
        </p>
      )}
      {log.isLoading && (
        <p role="status" className="muted">
          {t("approvals.loading")}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.audit.columns.when")}</th>
              <th>{t("admin.audit.columns.who")}</th>
              <th>{t("auditFilters.kind")}</th>
              <th>{t("admin.audit.columns.action")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className={e.undone ? "opacity-50" : ""}>
                <td className="text-xs text-slate-500">
                  {programFormat.dateTime(new Date(e.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td className="text-slate-600">{e.userName ?? "—"}</td>
                <td>
                  <span
                    className={
                      e.kind === "DECISION"
                        ? "badge-green"
                        : e.kind === "SUBMISSION"
                          ? "badge-amber"
                          : "badge-slate"
                    }
                  >
                    {t(`auditFilters.kinds.${e.kind}`)}
                  </span>
                </td>
                <td className="text-slate-800">
                  {e.action}
                  {!readOnly && e.approvalId && (
                    <Link
                      className="link mt-1 block text-xs"
                      href={`/admin/approvals?request=${e.approvalId}`}
                    >
                      {t("approvals.viewRequest")}
                    </Link>
                  )}
                  {!readOnly && e.details != null && (
                    <details className="mt-2">
                      <summary className="link cursor-pointer text-xs">
                        {t("auditFilters.details")}
                      </summary>
                      <pre className="mt-2 max-h-64 max-w-md overflow-auto text-xs whitespace-pre-wrap">
                        {JSON.stringify(e.details, null, 2)}
                      </pre>
                    </details>
                  )}
                  {e.undone && (
                    <span className="badge-slate ml-2">
                      {t("admin.audit.undone")}
                    </span>
                  )}
                </td>
                <td className="text-right">
                  {!readOnly && e.undoData != null && !e.undone ? (
                    <button
                      className="btn-secondary btn-sm"
                      disabled={undo.isPending}
                      onClick={() => undo.mutate({ id: e.id })}
                    >
                      {t("admin.audit.undo")}
                    </button>
                  ) : (
                    <span className="muted text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!log.isLoading && !log.error && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  {t("auditFilters.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={!cursors.length || log.isFetching}
          onClick={() => setCursors((old) => old.slice(0, -1))}
        >
          {t("approvals.previous")}
        </button>
        <button
          className="btn-secondary"
          disabled={entries.length !== 100 || log.isFetching}
          onClick={() => setCursors((old) => [...old, entries.at(-1)!.id])}
        >
          {t("approvals.next")}
        </button>
      </div>
      {!readOnly && undo.error && (
        <p className="text-sm text-red-600">{undo.error.message}</p>
      )}
    </div>
  );
}
export default function AuditPage() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
