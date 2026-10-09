"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import { InlineNotice, StatePanel } from "./ui/patterns";

/** Preserve JSON types and escaping on demand; never serialize the event's
 * executable undo payload alongside its historical details. */
function StoredEvidenceJson({ value }: { value: unknown }) {
  return (
    <pre className="max-w-full font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
      {JSON.stringify(
        value,
        (key, item: unknown) => (key === "undoData" ? undefined : item),
        2,
      )}
    </pre>
  );
}

/** Display only recorded evidence. Unknown keys remain verbatim, so a legacy
 * payload cannot be mistaken for a reconstructed current record or a new diff. */
function EvidenceValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  const t = useTranslations("auditEventDetails");
  if (value === undefined)
    return <span className="text-slate-500">{t("notRecorded")}</span>;
  if (value === null)
    return <span className="text-slate-500">{t("nullValue")}</span>;
  if (value === "")
    return <span className="text-slate-500">{t("emptyString")}</span>;
  if (typeof value === "boolean")
    return <>{t(value ? "trueValue" : "falseValue")}</>;
  if (typeof value === "number" || typeof value === "string")
    return <>{String(value)}</>;
  if (Array.isArray(value) && value.length === 0) return <>{t("emptyList")}</>;
  if (typeof value !== "object") return <>{t("notRecorded")}</>;

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key]) => key !== "undoData",
  );
  if (!entries.length) return <>{t("emptyObject")}</>;
  // Deep evidence stays complete without indefinitely narrowing nested cards.
  // Undo payloads are implementation data, never part of this reader's contract.
  if (depth >= 4) {
    return (
      <pre className="max-w-full font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
        {JSON.stringify(
          value,
          (key, item: unknown) => (key === "undoData" ? undefined : item),
          2,
        )}
      </pre>
    );
  }
  if (Array.isArray(value)) {
    return (
      <ol className="list-decimal space-y-3 pl-5">
        {value.map((item: unknown, index) => (
          <li key={index} className="min-w-0 pl-1">
            <EvidenceValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <dl className="space-y-3">
      {entries.map(([key, item]) => (
        <div key={key} className="min-w-0 border-l-2 border-slate-200 pl-3">
          <dt className="mb-1 text-xs font-medium text-slate-600">
            {key === "before" || key === "after" ? t(key) : key}
          </dt>
          <dd className="min-w-0">
            <EvidenceValue value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Metadata({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-slate-900">
        {children}
      </dd>
    </div>
  );
}

/** Mounted by TableDetails only on opening; each reopening rechecks the event.
 * Recovery repeats this read, never the audited write or an undo operation. */
export function AuditEventDetails({ id }: { id: string }) {
  const t = useTranslations("auditEventDetails");
  const kinds = useTranslations("auditFilters.kinds");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [deniedId, setDeniedId] = useState<string | null>(null);
  const query = api.admin.auditLogDetail.useQuery(
    { id },
    { refetchOnMount: "always", enabled: deniedId !== id },
  );
  const authorizationDenied =
    query.error?.data?.code === "FORBIDDEN" ||
    query.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (!authorizationDenied) return;
    // Evict only this event so reopening cannot recover evidence that authority
    // has revoked. Disable automatic reads while denied; Retry remains explicit.
    setDeniedId(id);
    queryClient.removeQueries({
      queryKey: getQueryKey(api.admin.auditLogDetail, { id }, "query"),
      exact: true,
    });
  }, [authorizationDenied, id, queryClient]);
  useEffect(() => {
    // A subsequent network failure must not lift the denial. Only a completed
    // successful read can establish permission again and resume normal caching.
    if (query.isSuccess && !query.isFetching) setDeniedId(null);
  }, [query.isSuccess, query.isFetching]);
  const event = query.data;
  const retry = (
    <Button
      size="compact"
      disabled={query.isFetching}
      onClick={() => void query.refetch()}
    >
      {t("retry")}
    </Button>
  );
  // Cached evidence is useful during network recovery, but an authoritative
  // denial must immediately remove private records from the rendered reader.
  if (authorizationDenied || deniedId === id) {
    return (
      <StatePanel kind="denied" title={t("accessDenied")} action={retry}>
        {t("accessDeniedHelp")}
      </StatePanel>
    );
  }
  if (!event) {
    return query.error ? (
      <StatePanel kind="error" title={t("loadFailed")} action={retry}>
        {query.error.message}
      </StatePanel>
    ) : (
      <StatePanel kind="loading" title={t("loading")} />
    );
  }
  const recorded = (value: string | null) =>
    value === null ? t("notRecorded") : value === "" ? t("emptyString") : value;
  const timestamp = (value: Date | string | null) => {
    if (value === null) return t("notRecorded");
    const date = new Date(value);
    return (
      <>
        <time dateTime={date.toISOString()} className="block">
          {format.dateTime(date, { dateStyle: "long", timeStyle: "long" })}
        </time>
        <span className="mt-1 block font-mono text-xs text-slate-500">
          {date.toISOString()}
        </span>
      </>
    );
  };
  const details = event.details;
  const evidence =
    details && typeof details === "object" && !Array.isArray(details)
      ? details
      : null;
  const hasComparison =
    evidence !== null &&
    (Object.hasOwn(evidence, "before") || Object.hasOwn(evidence, "after"));
  const context = hasComparison
    ? Object.fromEntries(
        Object.entries(evidence).filter(
          ([key]) => !["before", "after", "undoData"].includes(key),
        ),
      )
    : null;

  return (
    <div className="min-w-0 space-y-6 text-sm [overflow-wrap:anywhere]">
      {query.error && (
        <InlineNotice tone="warning" announcement="alert" action={retry}>
          {t("refreshFailed")}
        </InlineNotice>
      )}
      <section aria-label={t("event")} className="space-y-4">
        <h3 className="text-base font-semibold text-slate-900">{t("event")}</h3>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Metadata label={t("action")}>{event.action}</Metadata>
          <Metadata label={t("when")}>{timestamp(event.createdAt)}</Metadata>
          <Metadata label={t("actor")}>{recorded(event.userName)}</Metadata>
          <Metadata label={t("actorId")}>{recorded(event.userId)}</Metadata>
          <Metadata label={t("eventId")}>{event.id}</Metadata>
          <Metadata label={t("kind")}>
            {kinds(event.kind)}{" "}
            <span className="text-xs text-slate-500">({event.kind})</span>
          </Metadata>
          <Metadata label={t("operation")}>
            {recorded(event.operation)}
          </Metadata>
          <Metadata label={t("entity")}>{recorded(event.entity)}</Metadata>
          <Metadata label={t("entityId")}>{recorded(event.entityId)}</Metadata>
          <Metadata label={t("approval")}>
            {event.approvalId ? (
              <Link
                className="link inline-flex min-h-11 items-center lg:min-h-8"
                href={`/admin/approvals?request=${encodeURIComponent(event.approvalId)}`}
              >
                {t("openApproval", { id: event.approvalId })}
              </Link>
            ) : (
              t("notRecorded")
            )}
          </Metadata>
          <Metadata label={t("undoStatus")}>
            {t(event.undone ? "undone" : "notUndone")}
          </Metadata>
          <Metadata label={t("undoneAt")}>{timestamp(event.undoneAt)}</Metadata>
        </dl>
      </section>
      <section
        aria-label={t("evidence")}
        className="space-y-4 border-t border-slate-200 pt-5"
      >
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {t("evidence")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">{t("evidenceHelp")}</p>
        </div>
        {details === null ? (
          <p className="rounded-lg bg-slate-50 p-4 text-slate-600">
            {t("noEvidence")}
          </p>
        ) : hasComparison ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["before", "after"] as const).map((side) => (
                <section
                  key={side}
                  aria-label={t(side)}
                  className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <h4 className="mb-3 text-sm font-semibold text-slate-700">
                    {t(side)}
                  </h4>
                  <div className="whitespace-pre-wrap">
                    <EvidenceValue value={evidence[side]} />
                  </div>
                </section>
              ))}
            </div>
            {context && Object.keys(context).length > 0 && (
              <div className="min-w-0 whitespace-pre-wrap">
                <EvidenceValue value={context} />
              </div>
            )}
          </>
        ) : (
          <div className="min-w-0 rounded-lg bg-slate-50 p-4 whitespace-pre-wrap">
            <EvidenceValue value={details} />
          </div>
        )}
        {details !== null && (
          <DisclosureSection title={t("rawEvidence")} lifetime="lazy">
            <p className="mb-3 text-sm text-slate-500">
              {t("rawEvidenceHelp")}
            </p>
            <StoredEvidenceJson value={details} />
          </DisclosureSection>
        )}
      </section>
    </div>
  );
}
