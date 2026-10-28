"use client";

import { useFormatter, useTranslations, useTimeZone } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AuditFilters,
  type AuditFilterInput,
  type AuditKind,
  emptyAuditView,
  type AuditView,
} from "~/app/_components/audit-filters";
import {
  useSessionAccessDenied,
  useSessionPageScroll,
  useSessionViewState,
} from "~/app/_components/session-view-state";
import { viewEnum, viewFields, viewSearch } from "~/lib/session-view-state";
import { programDayStart, programDayEnd } from "~/lib/program-time";
import { eventTitle } from "~/lib/event-title";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";
import { AuditEventDetails } from "~/app/_components/audit-event-details";
import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";

/**
 * Audit evidence remains readable. Recovery requires a separate consequence preview;
 * legacy undo payloads cannot establish a complete dependency chain.
 */
function AuditLog() {
  const t = useTranslations();
  const format = useFormatter();
  const readOnly = useReadOnly();
  const params = useSearchParams();
  const approvalId = params.get("approval") ?? undefined;
  const timeZone = useTimeZone() ?? "Asia/Shanghai";
  const dateChoice = (value: unknown) => {
    if (typeof value !== "string") return;
    if (!value) return value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    try {
      programDayStart(value, timeZone);
      return value;
    } catch {
      return;
    }
  };
  const options = api.admin.auditFilterOptions.useQuery();
  const [accessDenied, setAccessDenied] = useState(false);
  const [view, setView] = useSessionViewState<AuditView>({
    id: "audit.filters.v1",
    initialState: emptyAuditView,
    enabled: !accessDenied,
    scope: JSON.stringify([approvalId ?? "all", timeZone]),
    restoreReady: !!options.data,
    parse: viewFields<AuditView>({
      userId: viewEnum([
        "",
        "__system__",
        ...(options.data?.users ?? []).map((user) => user.id),
      ]),
      kind: viewEnum([
        "",
        "ACTION",
        "DECISION",
        "SUBMISSION",
        "CANCELLATION",
        "ATTEMPT",
        "REVERSAL",
      ]),
      operation: viewEnum(["", ...(options.data?.operations ?? [])]),
      entity: viewEnum(["", ...(options.data?.entities ?? [])]),
      search: viewSearch,
      from: dateChoice,
      until: dateChoice,
    }),
  });
  // Store date control values, then rebuild the existing timezone-aware read DTO.
  const filters: AuditFilterInput = {
    userId: view.userId || undefined,
    kind: (view.kind || undefined) as AuditKind | undefined,
    operation: view.operation || undefined,
    entity: view.entity || undefined,
    search: view.search || undefined,
    from: view.from ? programDayStart(view.from, timeZone) : undefined,
    until: view.until
      ? new Date(programDayEnd(view.until, timeZone).getTime() + 1)
      : undefined,
  };
  const [cursors, setCursors] = useState<string[]>([]);
  const log = api.admin.auditLog.useQuery({
    ...filters,
    approvalId,
    cursor: cursors.at(-1),
  });
  const denied = useSessionAccessDenied(log, options);
  useEffect(() => setAccessDenied(denied), [denied]);
  useSessionPageScroll({
    id: "audit",
    scope: JSON.stringify([approvalId ?? "all", timeZone, view]),
    ready: !!log.data && !!options.data,
    enabled: !denied,
  });

  const entries = denied ? [] : (log.data ?? []);

  if (denied)
    return (
      <p role="alert">
        {log.error?.message ??
          options.error?.message ??
          t("uiPatterns.loadFailed")}
      </p>
    );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.audit.title")}</h1>
        <p className="muted mt-1">{t("auditFilters.subtitle")}</p>
        <p className="muted mt-2 text-sm">{t("approvals.reversalHelp")}</p>
      </div>
      <AuditFilters
        appliedView={view}
        onApply={(_input, nextView) => {
          setView(nextView);
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
              <tr key={e.id} className={e.undone ? "bg-slate-50" : ""}>
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
                    {t.has(`auditFilters.kinds.${e.kind}`)
                      ? t(`auditFilters.kinds.${e.kind}`)
                      : eventTitle(t, { kind: e.kind })}
                  </span>
                </td>
                <td className="text-slate-800">
                  <span
                    className="block max-w-72 truncate"
                    title={eventTitle(t, e)}
                  >
                    {eventTitle(t, e)}
                  </span>
                  {e.undone && (
                    <span className="badge-slate ml-2">
                      {t("admin.audit.undone")}
                    </span>
                  )}
                </td>
                <TableActions>
                  <TableDetails
                    title={`${eventTitle(t, e)} · ${e.userName ?? "—"}`}
                    // Full recorded evidence needs a reachable Close even after
                    // expanding long JSON; observers keep their compact summary.
                    longReader={!readOnly}
                  >
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
                    <Link className="table-action-link" href="/admin/recovery">
                      {t("recovery.title")}
                    </Link>
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
