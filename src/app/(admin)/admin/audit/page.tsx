"use client";

import { useFormatter, useTranslations, useTimeZone } from "next-intl";
import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getQueryKey } from "@trpc/react-query";
import {
  AuditFilters,
  type AuditFilterInput,
  type AuditKind,
  emptyAuditView,
  type AuditView,
  type AuditFilterOptions,
  hasAuditFilterOptions,
} from "~/app/_components/audit-filters";
import {
  useSessionAccessDenied,
  useSessionPageScroll,
  useSessionViewState,
} from "~/app/_components/session-view-state";
import { viewEnum, viewFields, viewSearch } from "~/lib/session-view-state";
import { programDayStart, programDayEnd } from "~/lib/program-time";
import { eventTitle } from "~/lib/event-title";

import { api, type RouterOutputs } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";
import { AuditEventDetails } from "~/app/_components/audit-event-details";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";

// These response DTOs contain JSON-like values and Dates. Equal replacement
// arrays must not keep scheduling cache updates; this is not an authority proof.
function sameAuditValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date)
    return (
      left instanceof Date &&
      right instanceof Date &&
      Object.is(left.getTime(), right.getTime())
    );
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    )
      return false;
    const leftItems: readonly unknown[] = left;
    const rightItems: readonly unknown[] = right;
    return leftItems.every((value, index) =>
      sameAuditValue(value, rightItems[index]),
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  )
    return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        sameAuditValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function auditReadError(reason: unknown, message: string): Error {
  if (reason instanceof Error) return reason;
  // Preserve tRPC-shaped codes while giving non-Error failures an Error boundary.
  const error = new Error(message, { cause: reason });
  return typeof reason === "object" && reason !== null
    ? Object.assign(error, reason)
    : error;
}

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
  const [cachedOptions, setCachedOptions] = useState<AuditFilterOptions>();
  const currentOptions = hasAuditFilterOptions(options.data)
    ? options.data
    : undefined;
  if (accessDenied) {
    if (cachedOptions !== undefined) setCachedOptions(undefined);
  } else if (currentOptions && !sameAuditValue(cachedOptions, currentOptions)) {
    setCachedOptions(currentOptions);
  }
  // A failed/null refresh must not turn known filter choices into a new empty
  // catalogue or reset the committed query while an unfinished draft is open.
  const catalogue = accessDenied
    ? undefined
    : (currentOptions ?? cachedOptions);
  const [view, setView] = useSessionViewState<AuditView>({
    id: "audit.filters.v1",
    initialState: emptyAuditView,
    enabled: !accessDenied,
    scope: JSON.stringify([approvalId ?? "all", timeZone]),
    restoreReady: !!catalogue,
    parse: viewFields<AuditView>({
      userId: viewEnum([
        "",
        "__system__",
        ...(catalogue?.users ?? []).map((user) => user.id),
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
      operation: viewEnum(["", ...(catalogue?.operations ?? [])]),
      entity: viewEnum(["", ...(catalogue?.entities ?? [])]),
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
  const logInput = {
    ...filters,
    approvalId,
    cursor: cursors.at(-1),
  };
  const log = api.admin.auditLog.useQuery(logInput);
  const denied = useSessionAccessDenied(
    {
      ...log,
      isSuccess: log.isSuccess && Array.isArray(log.data),
      denialKey: "audit-log",
      queryKey: getQueryKey(api.admin.auditLog, logInput, "query"),
    },
    {
      ...options,
      isSuccess: options.isSuccess && hasAuditFilterOptions(options.data),
      queryKey: getQueryKey(api.admin.auditFilterOptions, undefined, "query"),
    },
  );
  // The read key depends on the view, so synchronize its denial bridge before commit.
  if (accessDenied !== denied) setAccessDenied(denied);
  const scope = JSON.stringify([
    approvalId ?? "all",
    timeZone,
    view,
    cursors.at(-1),
  ]);
  const currentEntries = Array.isArray(log.data) ? log.data : undefined;
  const [cachedEntries, setCachedEntries] = useState<{
    scope: string;
    entries: RouterOutputs["admin"]["auditLog"];
  }>();
  // Reconcile before children commit so denial also clears the fallback. Normal
  // structurally shared query data takes the equality guard's reference fast path.
  if (denied) {
    if (cachedEntries !== undefined) setCachedEntries(undefined);
  } else if (
    currentEntries &&
    (cachedEntries?.scope !== scope ||
      !sameAuditValue(cachedEntries.entries, currentEntries))
  ) {
    setCachedEntries({ scope, entries: currentEntries });
  }
  const entriesData = denied
    ? undefined
    : (currentEntries ??
      (cachedEntries?.scope === scope ? cachedEntries.entries : undefined));
  const [retrying, setRetrying] = useState(false);
  const retryLease = useRef(false);
  const [refreshFailure, setRefreshFailure] = useState<Error | null>(null);
  const missingRead =
    (log.isSuccess && !currentEntries) ||
    (options.isSuccess && !currentOptions);
  const readError = log.error ?? options.error ?? refreshFailure;
  const ready =
    !denied &&
    !!currentEntries &&
    !!currentOptions &&
    !readError &&
    !missingRead &&
    !retrying;
  const retryReads = async () => {
    if (retryLease.current) return;
    retryLease.current = true;
    setRetrying(true);
    try {
      // Keep the active list/filter read DTOs unchanged and retain ownership
      // until both settle, including a failing read beside a slower sibling.
      const reads = await Promise.allSettled([
        Promise.resolve().then(() => log.refetch({ throwOnError: true })),
        Promise.resolve().then(() => options.refetch({ throwOnError: true })),
      ]);
      const listRead = reads[0];
      const filterRead = reads[1];
      if (listRead.status === "rejected")
        throw listRead.reason instanceof Error
          ? listRead.reason
          : new Error(t("auditFilters.loadFailed"));
      if (filterRead.status === "rejected")
        throw filterRead.reason instanceof Error
          ? filterRead.reason
          : new Error(t("auditFilters.loadFailed"));
      if (listRead.value.error)
        throw auditReadError(
          listRead.value.error,
          t("auditFilters.loadFailed"),
        );
      if (filterRead.value.error)
        throw auditReadError(
          filterRead.value.error,
          t("auditFilters.loadFailed"),
        );
      if (
        !Array.isArray(listRead.value.data) ||
        !hasAuditFilterOptions(filterRead.value.data)
      )
        throw new Error(t("auditFilters.loadFailed"));
      setRefreshFailure(null);
    } catch (error) {
      setRefreshFailure(
        error instanceof Error
          ? error
          : new Error(t("auditFilters.loadFailed")),
      );
    } finally {
      retryLease.current = false;
      setRetrying(false);
    }
  };
  useSessionPageScroll({
    id: "audit",
    scope: JSON.stringify([approvalId ?? "all", timeZone, view]),
    ready,
    enabled: !denied,
  });

  const entries = entriesData ?? [];
  const hasReadData = !denied && !!entriesData && !!catalogue;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.audit.title")}</h1>
        <p className="muted mt-1">{t("auditFilters.subtitle")}</p>
        <p className="muted mt-2 text-sm">{t("approvals.reversalHelp")}</p>
      </div>
      <QueryFeedback
        hasData={hasReadData}
        loading={!hasReadData}
        error={denied || !!readError || !!missingRead}
        retrying={retrying}
        loadingTitle={t("auditFilters.loadingReads")}
        errorTitle={t(
          denied
            ? "auditFilters.accessDenied"
            : hasReadData
              ? "auditFilters.refreshFailed"
              : "auditFilters.loadFailed",
        )}
        errorDetail={readError?.message}
        retryLabel={t("auditFilters.retryReads")}
        onRetry={() => void retryReads()}
      />
      {!denied && (
        <>
          {catalogue && (
            <AuditFilters
              appliedView={view}
              catalogue={catalogue}
              unavailable={!ready}
              reportReadError={false}
              onApply={(_input, nextView) => {
                if (!ready || retryLease.current) return;
                setView(nextView);
                setCursors([]);
              }}
            />
          )}
          {approvalId && (
            <Link className="link" href="/admin/audit">
              {t("auditFilters.allHistory")}
            </Link>
          )}
          {entriesData && (
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
                          <Link
                            className="table-action-link"
                            href="/admin/recovery"
                          >
                            {t("recovery.title")}
                          </Link>
                        ) : null}
                      </TableActions>
                    </tr>
                  ))}
                  {ready && entries.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-slate-500">
                        {t("auditFilters.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </SummaryTable>
            </div>
          )}
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              disabled={!ready || !cursors.length || log.isFetching}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              {t("approvals.previous")}
            </button>
            <button
              className="btn-secondary"
              disabled={!ready || entries.length !== 100 || log.isFetching}
              onClick={() => setCursors((old) => [...old, entries.at(-1)!.id])}
            >
              {t("approvals.next")}
            </button>
          </div>
        </>
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
