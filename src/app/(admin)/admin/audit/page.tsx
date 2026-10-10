"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AuditFilters,
  type AuditFilterInput,
} from "~/app/_components/audit-filters";

import { InlineNotice } from "~/app/_components/ui/patterns";
import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";
import { AuditEventDetails } from "~/app/_components/audit-event-details";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";

/**
 * Audit trail of admin mutations. Entries that carry undo data can be reverted with one
 * click (see src/server/audit/log.ts). Supports the revertibility philosophy in docs/contributing.md.
 */
function AuditLog() {
  const t = useTranslations();
  const format = useFormatter();
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
        <p className="muted mt-2 text-sm">{t("approvals.reversalHelp")}</p>
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

      <div className="card">
        <SummaryTable label={t("admin.audit.title")}>
          <thead>
            <tr>
              <th>{t("admin.audit.columns.when")}</th>
              <th>{t("admin.audit.columns.who")}</th>
              <th>{t("auditFilters.kind")}</th>
              <th>{t("admin.audit.columns.action")}</th>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className={e.undone ? "opacity-50" : ""}>
                <td className="text-xs text-slate-500">
                  {format.dateTime(new Date(e.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </td>
                <td className="min-w-40 whitespace-nowrap text-slate-600">
                  <span
                    className="block max-w-64 truncate"
                    title={e.userName ?? undefined}
                  >
                    {e.userName ?? "—"}
                  </span>
                </td>
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
                  <span className="block max-w-72 truncate" title={e.action}>
                    {e.action}
                  </span>
                  {e.undone && (
                    <span className="badge-slate ml-2">
                      {t("admin.audit.undone")}
                    </span>
                  )}
                </td>
                <TableActions>
                  <TableDetails title={`${e.action} · ${e.userName ?? "—"}`}>
                    {/* Staff evidence is fetched only while this dialog is open.
                        Observers retain the existing server-projected summary. */}
                    {readOnly ? (
                      <>
                        <p>
                          {format.dateTime(new Date(e.createdAt), {
                            dateStyle: "full",
                            timeStyle: "short",
                          })}
                        </p>
                        <p>{e.userName ?? "—"}</p>
                        <p>{e.action}</p>
                      </>
                    ) : (
                      <AuditEventDetails id={e.id} />
                    )}
                  </TableDetails>
                  {!readOnly && e.approvalId && (
                    <Link
                      className="table-action-link"
                      href={`/admin/approvals?request=${e.approvalId}`}
                    >
                      {t("approvals.viewRequest")}
                    </Link>
                  )}
                  {!readOnly && e.undoData != null && !e.undone ? (
                    <TableAction
                      disabled={undo.isPending}
                      onClick={() => undo.mutate({ id: e.id })}
                    >
                      {t("admin.audit.undo")}
                    </TableAction>
                  ) : null}
                </TableActions>
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
        </SummaryTable>
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
      {!readOnly && undo.error?.data?.approvalId && <InlineNotice tone="warning" announcement="status">{t("approvals.queuedBody")}</InlineNotice>}
      {!readOnly && undo.error && !undo.error.data?.approvalId && (
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
