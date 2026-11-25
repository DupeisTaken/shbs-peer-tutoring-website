"use client";

import { useFormatter, useTranslations, useTimeZone } from "next-intl";
import { Suspense, useContext, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { QueryClientContext } from "@tanstack/react-query";
import { trpcProcedureKey, trpcQueryKey } from "~/lib/trpc-query-key";
import {
  AuditFilters,
  type AuditFilterInput,
  type AuditFilterOptions,
  type AuditKind,
  emptyAuditView,
  hasAuditFilterOptions,
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

import { api, type RouterOutputs } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";
import { AuditEventDetails } from "~/app/_components/audit-event-details";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { StatePanel } from "~/app/_components/ui/patterns";
import { Button } from "~/app/_components/ui/button";
import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import styles from "./page.module.css";

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
 * legacy undo payloads cannot establish a complete dependency chain or identify
 * a supported recovery action. Keep recovery selection in its own workspace.
 */
function AuditLog() {
  const t = useTranslations();
  const format = useFormatter();
  const readOnly = useReadOnly();
  const params = useSearchParams();
  const approvalId = params.get("approval") ?? undefined;
  const timeZone = useTimeZone() ?? "Asia/Shanghai";
  const queryClient = useContext(QueryClientContext);
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
  const [accessDenied, setAccessDenied] = useState(false);
  const options = api.admin.auditFilterOptions.useQuery(undefined, {
    enabled: !accessDenied,
  });
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
  const log = api.admin.auditLog.useQuery(logInput, {
    enabled: !accessDenied,
  });
  const denied = useSessionAccessDenied(
    {
      ...log,
      isSuccess: log.isSuccess && Array.isArray(log.data),
      denialKey: "audit-log",
      queryKey: trpcQueryKey(
        api.admin.auditLog,
        ["admin", "auditLog"],
        logInput,
      ),
    },
    {
      ...options,
      isSuccess: options.isSuccess && hasAuditFilterOptions(options.data),
      denialKey: "audit-filter-options",
      queryKey: trpcQueryKey(api.admin.auditFilterOptions, [
        "admin",
        "auditFilterOptions",
      ]),
    },
  );
  // The read key depends on the view, so synchronize its denial bridge before commit.
  if (accessDenied !== denied) setAccessDenied(denied);
  if (denied && cursors.length) setCursors([]);
  useEffect(() => {
    if (!denied || !queryClient) return;
    queryClient.removeQueries({
      queryKey: trpcProcedureKey(api.admin.auditLog, ["admin", "auditLog"]),
      exact: false,
    });
    queryClient.removeQueries({
      queryKey: trpcProcedureKey(api.admin.auditFilterOptions, [
        "admin",
        "auditFilterOptions",
      ]),
      exact: false,
    });
  }, [denied, queryClient]);

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

  const [retryingLog, setRetryingLog] = useState(false);
  const [retryingOptions, setRetryingOptions] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const logRetryLease = useRef(false);
  const optionsRetryLease = useRef(false);
  const allRetryLease = useRef(false);
  const [logRefreshFailure, setLogRefreshFailure] = useState<Error | null>(
    null,
  );
  const [optionsRefreshFailure, setOptionsRefreshFailure] =
    useState<Error | null>(null);
  if (
    logRefreshFailure &&
    !retryingLog &&
    !retryingAll &&
    !log.isFetching &&
    log.isSuccess &&
    !log.error &&
    !!currentEntries
  ) {
    setLogRefreshFailure(null);
  }
  if (
    optionsRefreshFailure &&
    !retryingOptions &&
    !retryingAll &&
    !options.isFetching &&
    options.isSuccess &&
    !options.error &&
    !!currentOptions
  ) {
    setOptionsRefreshFailure(null);
  }

  const missingLog = log.isSuccess && !currentEntries;
  const missingOptions = options.isSuccess && !currentOptions;
  const logError = log.error ?? logRefreshFailure;
  const optionsError = options.error ?? optionsRefreshFailure;
  const logFailed = !!logError || missingLog;
  const optionsFailed = !!optionsError || missingOptions;
  const logReady = !denied && !!currentEntries && !logFailed && !retryingLog;
  const optionsReady =
    !denied && !!currentOptions && !optionsFailed && !retryingOptions;
  const ready = logReady && optionsReady && !retryingAll;

  const retryLog = async () => {
    if (logRetryLease.current) return;
    logRetryLease.current = true;
    setRetryingLog(true);
    try {
      const result = await log.refetch({ throwOnError: true });
      if (result.error)
        throw auditReadError(result.error, t("auditFilters.loadFailed"));
      if (!Array.isArray(result.data))
        throw new Error(t("auditFilters.loadFailed"));
      setLogRefreshFailure(null);
    } catch (error) {
      setLogRefreshFailure(auditReadError(error, t("auditFilters.loadFailed")));
    } finally {
      logRetryLease.current = false;
      setRetryingLog(false);
    }
  };

  const retryOptions = async () => {
    if (optionsRetryLease.current) return;
    optionsRetryLease.current = true;
    setRetryingOptions(true);
    try {
      const result = await options.refetch({ throwOnError: true });
      if (result.error)
        throw auditReadError(result.error, t("auditFilters.loadFailed"));
      if (!hasAuditFilterOptions(result.data))
        throw new Error(t("auditFilters.loadFailed"));
      setOptionsRefreshFailure(null);
    } catch (error) {
      setOptionsRefreshFailure(
        auditReadError(error, t("auditFilters.loadFailed")),
      );
    } finally {
      optionsRetryLease.current = false;
      setRetryingOptions(false);
    }
  };

  const retryDeniedReads = async () => {
    if (allRetryLease.current) return;
    allRetryLease.current = true;
    setRetryingAll(true);
    try {
      // Keep both active read DTOs unchanged and retain ownership until both settle.
      const reads = await Promise.allSettled([
        Promise.resolve().then(() => log.refetch({ throwOnError: true })),
        Promise.resolve().then(() => options.refetch({ throwOnError: true })),
      ]);
      const listRead = reads[0];
      const filterRead = reads[1];
      if (listRead.status === "rejected") {
        setLogRefreshFailure(
          auditReadError(listRead.reason, t("auditFilters.loadFailed")),
        );
      } else if (listRead.value.error) {
        setLogRefreshFailure(
          auditReadError(listRead.value.error, t("auditFilters.loadFailed")),
        );
      } else if (!Array.isArray(listRead.value.data)) {
        setLogRefreshFailure(new Error(t("auditFilters.loadFailed")));
      } else {
        setLogRefreshFailure(null);
      }
      if (filterRead.status === "rejected") {
        setOptionsRefreshFailure(
          auditReadError(filterRead.reason, t("auditFilters.loadFailed")),
        );
      } else if (filterRead.value.error) {
        setOptionsRefreshFailure(
          auditReadError(filterRead.value.error, t("auditFilters.loadFailed")),
        );
      } else if (!hasAuditFilterOptions(filterRead.value.data)) {
        setOptionsRefreshFailure(new Error(t("auditFilters.loadFailed")));
      } else {
        setOptionsRefreshFailure(null);
      }
    } finally {
      allRetryLease.current = false;
      setRetryingAll(false);
    }
  };

  useSessionPageScroll({
    id: "audit",
    scope: JSON.stringify([approvalId ?? "all", timeZone, view]),
    ready,
    enabled: !denied,
  });

  const entries = entriesData ?? [];

  if (denied)
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">{t("admin.audit.title")}</h1>
          <p className="muted mt-1">{t("auditFilters.subtitle")}</p>
          <p className="muted mt-2 text-sm">{t("approvals.reversalHelp")}</p>
        </div>
        <StatePanel
          kind="denied"
          title={t("auditFilters.accessDenied")}
          action={
            <Button
              disabled={retryingAll || log.isFetching || options.isFetching}
              onClick={() => void retryDeniedReads()}
            >
              {t("auditFilters.retryReads")}
            </Button>
          }
        >
          {logError?.message ?? optionsError?.message}
        </StatePanel>
      </div>
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
        catalogue={catalogue}
        unavailable={!ready}
        optionsError={
          optionsFailed
            ? (optionsError ?? new Error(t("auditFilters.loadFailed")))
            : null
        }
        optionsRetrying={retryingOptions || options.isFetching}
        onRetryOptions={() => void retryOptions()}
        onApply={(_input, nextView) => {
          if (!ready || logRetryLease.current || optionsRetryLease.current)
            return;
          setView(nextView);
          setCursors([]);
        }}
      />
      {approvalId && (
        <Link className="link" href="/admin/audit">
          {t("auditFilters.allHistory")}
        </Link>
      )}
      <QueryFeedback
        hasData={entriesData !== undefined}
        loading={entriesData === undefined && !logFailed}
        error={logFailed}
        retrying={retryingLog || log.isFetching}
        loadingTitle={t("managementRecovery.loading", {
          section: t("admin.audit.title"),
        })}
        errorTitle={t(
          entriesData !== undefined
            ? "managementRecovery.refreshFailed"
            : "managementRecovery.loadFailed",
          { section: t("admin.audit.title") },
        )}
        errorDetail={logError?.message}
        retryLabel={t("managementRecovery.retry", {
          section: t("admin.audit.title"),
        })}
        onRetry={() => void retryLog()}
      />

      {entriesData !== undefined && (
        <div className="card">
          <SummaryTable label={t("admin.audit.title")} className={styles.table}>
            <thead>
              <tr>
                <th className={styles.when}>{t("admin.audit.columns.when")}</th>
                <th>{t("admin.audit.columns.who")}</th>
                <th className={styles.kind}>{t("auditFilters.kind")}</th>
                <th className={styles.operation}>
                  {t("admin.audit.columns.action")}
                </th>
                <th className="table-actions-heading">
                  {t("admin.audit.columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className={e.undone ? "bg-slate-50" : ""}>
                  <td className={`${styles.when} text-xs text-slate-500`}>
                    <time dateTime={new Date(e.createdAt).toISOString()}>
                      <span className={styles.fullTimestamp}>
                        {format.dateTime(new Date(e.createdAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                      {/* Keep locale-owned dates intact on narrow screens; the
                          desktop representation retains its original punctuation. */}
                      <span className={styles.compactTimestamp}>
                        <span>
                          {format.dateTime(new Date(e.createdAt), {
                            dateStyle: "medium",
                          })}
                        </span>{" "}
                        <span>
                          {format.dateTime(new Date(e.createdAt), {
                            timeStyle: "short",
                          })}
                        </span>
                      </span>
                    </time>
                  </td>
                  <td className="min-w-40 whitespace-nowrap text-slate-600">
                    <span
                      className="block max-w-64 truncate"
                      title={e.userName ?? undefined}
                    >
                      {e.userName ?? "—"}
                    </span>
                  </td>
                  <td className={styles.kind}>
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
                  <td className={`${styles.operation} text-slate-800`}>
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
                          {/* Translate only the safe kind; stored action text can
                              contain private reasons in historical events. */}
                          <p>{eventTitle(t, { kind: e.kind })}</p>
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
                  </TableActions>
                </tr>
              ))}
              {logReady && entries.length === 0 && (
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
          disabled={!logReady || !cursors.length || log.isFetching}
          onClick={() => setCursors((old) => old.slice(0, -1))}
        >
          {t("approvals.previous")}
        </button>
        <button
          className="btn-secondary"
          disabled={!logReady || entries.length !== 100 || log.isFetching}
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
