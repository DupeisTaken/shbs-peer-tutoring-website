"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  evidenceChildPath,
  recordedEvidenceDiff,
  type RecordedEvidenceChange,
} from "~/lib/recorded-evidence-diff";
import { Button } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import { ReviewDisclosure } from "./review-disclosure";
import { auditChangeSummary } from "~/lib/audit-change-summary";
import {
  auditCapturedName,
  auditComparisonFacts,
  auditComparisonIdentity,
  auditCapturedReferences,
  auditDirectField,
} from "~/lib/audit-review-presentation";
import {
  auditEntityLabelKey,
  auditFieldLabelKey,
  auditEnumLabelKey,
  auditReferenceEntity,
} from "~/lib/review-vocabulary";
import { reviewInstant } from "~/lib/review-instant";
import { minToHm } from "~/lib/time";
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
/** Difference markers decorate the original reader; they never replace stored values. */
function EvidenceValue({
  value,
  depth = 0,
  path = "",
  changes,
}: {
  value: unknown;
  depth?: number;
  path?: string;
  changes?: ReadonlyMap<string, RecordedEvidenceChange>;
}) {
  const t = useTranslations("auditEventDetails");
  const change =
    changes?.get(path) ??
    (depth >= 4 &&
    changes &&
    [...changes.keys()].some((key) => key.startsWith(`${path}/`))
      ? "changed"
      : undefined);
  const colors = {
    added: "border-emerald-300 bg-emerald-50",
    removed: "border-red-300 bg-red-50",
    changed: "border-amber-300 bg-amber-50",
  };
  return (
    <div
      className={
        change ? "min-w-0 rounded-md border p-2 " + colors[change] : "min-w-0"
      }
    >
      {change && (
        <p className="mb-1 text-xs font-semibold text-slate-800">
          {t("difference." + change)}
        </p>
      )}
      <EvidenceContent
        value={value}
        depth={depth}
        path={path}
        changes={changes}
      />
    </div>
  );
}

function EvidenceContent({
  value,
  depth = 0,
  path = "",
  changes,
}: {
  value: unknown;
  depth?: number;
  path?: string;
  changes?: ReadonlyMap<string, RecordedEvidenceChange>;
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
            <EvidenceValue
              value={item}
              depth={depth + 1}
              path={evidenceChildPath(path, String(index))}
              changes={changes}
            />
          </li>
        ))}
      </ol>
    );
  }
  // Canonical audit batches record changes[n].before/after beside entity/write
  // context. Discover each recorded pair locally, rather than assuming one root
  // snapshot or reconstructing a record from current application data.
  const pair = value as Record<string, unknown>;
  let nestedChanges = changes;
  if (Object.hasOwn(pair, "before") || Object.hasOwn(pair, "after")) {
    const comparison = recordedEvidenceDiff(
      pair.before,
      pair.after,
      Object.hasOwn(pair, "before"),
      Object.hasOwn(pair, "after"),
    );
    const combined = new Map(changes);
    for (const [child, change] of comparison) {
      for (const side of ["before", "after"] as const)
        combined.set(`${evidenceChildPath(path, side)}${child}`, change);
    }
    nestedChanges = combined;
  }
  return (
    <dl className="space-y-3">
      {entries.map(([key, item]) => (
        <div key={key} className="min-w-0 border-l-2 border-slate-200 pl-3">
          <dt className="mb-1 text-xs font-medium text-slate-600">
            {key === "before" || key === "after" ? t(key) : key}
          </dt>
          <dd className="min-w-0">
            <EvidenceValue
              value={item}
              depth={depth + 1}
              path={evidenceChildPath(path, key)}
              changes={nestedChanges}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The summary decorates known stored envelopes. The original reader below stays
 * available for unknown keys, complete context, and exact JSON. */
export function AuditChangeSummary({
  summary,
}: {
  summary: ReturnType<typeof auditChangeSummary>;
}) {
  const t = useTranslations("auditEventDetails");
  const vocabulary = useTranslations();
  const format = useFormatter();
  if (!summary) return null;
  const references = auditCapturedReferences(
    summary.capturedRecords,
    (value, entity) => {
      const name = auditCapturedName(value);
      if (name) return name;
      if (entity === "TimeSlot" && value && typeof value === "object") {
        const row = value as Record<string, unknown>;
        if (
          typeof row.dayOfWeek === "number" &&
          row.dayOfWeek >= 1 &&
          row.dayOfWeek <= 7 &&
          typeof row.startMin === "number" &&
          typeof row.endMin === "number"
        )
          return `${format.dateTime(new Date(Date.UTC(2026, 0, 4 + row.dayOfWeek)), { weekday: "long", timeZone: "UTC" })} · ${minToHm(row.startMin)}–${minToHm(row.endMin)}`;
      }
      return undefined;
    },
  );
  const label = (entity: string | undefined, path: string) => {
    const field = auditDirectField(path);
    const key = field ? auditFieldLabelKey(entity, field) : null;
    return key && vocabulary.has(key)
      ? vocabulary(key)
      : path || t("presentation.fullRecord");
  };
  const value = (
    entity: string | undefined,
    field: string | null,
    item: unknown,
    side: "before" | "after",
    wholeRecord = false,
  ): ReactNode => {
    // A recorded empty identifier is a value, not evidence of an absent linked
    // record. Preserve its explicit state before attempting label resolution.
    if (item === "") return <EvidenceValue value={item} />;
    const enumKey = field ? auditEnumLabelKey(entity, field, item) : null;
    if (enumKey && vocabulary.has(enumKey)) return vocabulary(enumKey);
    if (field && Array.isArray(item) && item.length)
      return (
        <ul className="space-y-1">
          {item.map((child, index) => (
            <li key={index}>{value(entity, field, child, side)}</li>
          ))}
        </ul>
      );
    if (field && auditFieldLabelKey(entity, field)) {
      if (typeof item === "number" && ["startMin", "endMin"].includes(field))
        return minToHm(item);
      if (
        typeof item === "number" &&
        field === "dayOfWeek" &&
        item >= 1 &&
        item <= 7
      )
        return format.dateTime(new Date(Date.UTC(2026, 0, 4 + item)), {
          weekday: "long",
          timeZone: "UTC",
        });
      if (
        typeof item === "string" &&
        /(?:At|date|Date)$/.test(field) &&
        /^\d{4}-\d{2}-\d{2}T/.test(item)
      ) {
        const date = reviewInstant(item);
        if (Number.isFinite(date.getTime()))
          return (
            <span>
              {format.dateTime(date, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              <span className="mt-1 block font-mono text-xs text-slate-600">
                {item}
              </span>
            </span>
          );
      }
    }
    if (field && typeof item === "string") {
      const name = references(entity, field, item, side);
      if (name)
        return (
          <span>
            {name}
            <span className="mt-1 block font-mono text-xs text-slate-600">
              {item}
            </span>
          </span>
        );
      const target =
        field === "id" ? entity : auditReferenceEntity(entity, field);
      const targetLabel = auditEntityLabelKey(target);
      if (targetLabel)
        return (
          <span>
            {vocabulary(
              references.resolve(entity, field, item, side).state ===
                "ambiguous"
                ? "approvals.review.referenceAmbiguous"
                : "approvals.review.referenceMissing",
              {
                entity: vocabulary(targetLabel),
              },
            )}
            <span className="mt-1 block font-mono text-xs text-slate-600">
              {vocabulary("approvals.review.recordId", { id: item })}
            </span>
          </span>
        );
    }
    if (
      wholeRecord &&
      auditEntityLabelKey(entity) &&
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.keys(item).some((key) => key !== "undoData")
    )
      return (
        <dl className="space-y-2">
          {Object.entries(item as Record<string, unknown>)
            .filter(([key]) => key !== "undoData")
            .map(([key, child]) => (
              <div key={key}>
                <dt className="text-xs font-medium text-slate-600">
                  {label(
                    entity,
                    `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
                  )}
                </dt>
                <dd>{value(entity, key, child, side)}</dd>
              </div>
            ))}
        </dl>
      );
    return <EvidenceValue value={item} />;
  };
  const factText = (
    entity: string | undefined,
    key: string,
    item: unknown,
    side: "before" | "after",
  ) => {
    if (typeof item === "string") {
      const name = references(entity, key, item, side);
      if (name) return name;
      if (key.endsWith("Id")) return undefined; // IDs remain exact secondary evidence.
      const enumKey = auditEnumLabelKey(entity, key, item);
      return enumKey && vocabulary.has(enumKey) ? vocabulary(enumKey) : item;
    }
    if (typeof item === "number" && ["startMin", "endMin"].includes(key))
      return minToHm(item);
    return undefined;
  };
  return (
    <section aria-label={t("summaryTitle")} className="space-y-3">
      <h3 className="text-base font-semibold text-slate-900">
        {t("summaryTitle")}
      </h3>
      <p className="text-sm text-slate-700">
        {t("summaryCounts", summary.counts)}
      </p>
      {summary.positional && (
        <p className="text-sm text-slate-600">{t("positionalSummary")}</p>
      )}
      {!summary.comparisons.length && <p>{t("noRecordedChanges")}</p>}
      {summary.comparisons.map((comparison, index) => {
        const entityKey = auditEntityLabelKey(comparison.entity);
        const entity =
          entityKey && vocabulary.has(entityKey)
            ? vocabulary(entityKey)
            : (comparison.entity ?? t("evidence"));
        const identity = auditComparisonIdentity(comparison);
        const facts = auditComparisonFacts(comparison).flatMap((fact) => {
          const before = factText(
            comparison.entity,
            fact.key,
            fact.before,
            "before",
          );
          const after = factText(
            comparison.entity,
            fact.key,
            fact.after,
            "after",
          );
          const result =
            before && after && before !== after
              ? `${before} → ${after}`
              : (after ?? before);
          return result ? [result] : [];
        });
        const names = [
          ...new Set(
            comparison.fields.map((field) =>
              label(comparison.entity, field.path),
            ),
          ),
        ];
        const fieldNames =
          names.slice(0, 3).join(", ") +
          (names.length > 3
            ? ` · ${t("presentation.moreFields", { count: names.length - 3 })}`
            : "");
        const changeKey = comparison.fields.every(
          (field) => field.change === "added",
        )
          ? "fieldsAdded"
          : comparison.fields.every((field) => field.change === "removed")
            ? "fieldsRemoved"
            : "fieldsChanged";
        return (
          <ReviewDisclosure
            key={index}
            defaultOpen={summary.comparisons.length === 1}
            title={`${entity}${identity ? ` · ${identity}` : facts.length ? ` · ${facts.join(" · ")}` : ""} · ${t(`presentation.${changeKey}`, { fields: fieldNames })} · ${t("comparisonNumber", { number: index + 1 })}`}
          >
            {comparison.position !== undefined && (
              <p className="text-xs text-slate-600">
                {t("recordedPosition", { number: comparison.position })}
              </p>
            )}
            {(comparison.beforeId !== undefined ||
              comparison.afterId !== undefined) && (
              <p className="text-xs text-slate-600">
                {t("recordedIds", {
                  before: comparison.beforeId ?? t("notRecorded"),
                  after: comparison.afterId ?? t("notRecorded"),
                })}
              </p>
            )}
            <div className="divide-y divide-slate-200">
              {comparison.fields.map((field) => (
                <div
                  key={field.path}
                  className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">
                      {label(comparison.entity, field.path)}
                    </p>
                    {field.path && (
                      <p className="mt-1 font-mono text-xs [overflow-wrap:anywhere] text-slate-500">
                        {t("presentation.recordedPath", { path: field.path })}
                      </p>
                    )}
                    <p className="text-xs text-slate-600">
                      {t(`difference.${field.change}`)}
                    </p>
                  </div>
                  {(["before", "after"] as const).map((side) => (
                    <div key={side} className="min-w-0">
                      <p className="mb-1 text-xs font-medium text-slate-600">
                        {t(side)}
                      </p>
                      <div className="whitespace-pre-wrap">
                        {value(
                          comparison.entity,
                          auditDirectField(field.path),
                          field[side].present ? field[side].value : undefined,
                          side,
                          field.path === "",
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </ReviewDisclosure>
        );
      })}
    </section>
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
  const vocabulary = useTranslations();
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
  // Derive once from this immutable event; no present-day record reads or ID
  // matching participate in either the summary or the full evidence reader.
  const summary = auditChangeSummary(details, event.entity ?? undefined);
  const evidence =
    details && typeof details === "object" && !Array.isArray(details)
      ? details
      : null;
  const hasComparison =
    evidence !== null &&
    (Object.hasOwn(evidence, "before") || Object.hasOwn(evidence, "after"));
  const differences = hasComparison
    ? recordedEvidenceDiff(
        evidence.before,
        evidence.after,
        Object.hasOwn(evidence, "before"),
        Object.hasOwn(evidence, "after"),
      )
    : undefined;
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
            {kinds.has(event.kind) ? kinds(event.kind) : event.kind}{" "}
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
          {evidence &&
            "outcome" in evidence &&
            typeof evidence.outcome === "string" &&
            vocabulary.has(
              `auditEventDetails.presentation.outcomes.${evidence.outcome}`,
            ) && (
              <Metadata label={t("presentation.outcome")}>
                {vocabulary(
                  `auditEventDetails.presentation.outcomes.${evidence.outcome}`,
                )}
                <span className="mt-1 block font-mono text-xs text-slate-500">
                  {evidence.outcome}
                </span>
              </Metadata>
            )}
        </dl>
      </section>
      <AuditChangeSummary summary={summary} />
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
        <ReviewDisclosure title={t("fullEvidence")} defaultOpen={!summary}>
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
                      <EvidenceValue
                        value={evidence[side]}
                        changes={differences}
                      />
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
        </ReviewDisclosure>
      </section>
    </div>
  );
}
