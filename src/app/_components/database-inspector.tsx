"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import type {
  InspectedRecord,
  RecordKey,
  RecordTable,
  RecordReference,
} from "~/server/recovery/record-inspector";
import { Button } from "./ui/button";
import { useSessionAccessDenied } from "./session-view-state";
import { QueryFeedback } from "./ui/query-feedback";
import { SummaryTable, TableActions, TableDetails } from "./ui/summary-table";

function EvidenceReference({ reference }: { reference: RecordReference }) {
  return (
    <a
      className="inline-flex min-h-11 items-center [overflow-wrap:anywhere] underline lg:min-h-8"
      href={`/admin/database?table=${encodeURIComponent(reference.table)}&key=${encodeURIComponent(JSON.stringify(reference.key))}`}
    >
      {reference.table} {JSON.stringify(reference.key)}
    </a>
  );
}

/** Each page is bound to the exact selected reference; following a relationship
 * performs another ordinary masked read and never grants recovery authority. */
function RecordedEvidence({
  record,
  onBack,
  onDenied,
}: {
  record: InspectedRecord;
  onBack: () => void;
  onDenied: () => void;
}) {
  const t = useTranslations("recordInspector");
  const [cursors, setCursors] = useState<string[]>([]);
  const query = api.recordInspector.dependencies.useQuery(
    { ...record.reference, cursor: cursors.at(-1), limit: 25 },
    { retry: false },
  );
  const denied = useSessionAccessDenied(query);
  useEffect(() => {
    if (denied) onDenied();
  }, [denied, onDenied]);
  const data = denied || query.isError ? undefined : query.data;
  const hasRecordReferences = !!(
    record.evidence?.affectedRecord ?? record.evidence?.relatedRecords.length
  );
  return (
    <section className="space-y-4">
      <QueryFeedback
        hasData={!!data}
        loading={query.isLoading}
        error={query.isError}
        retrying={query.isFetching}
        loadingTitle={t("loading")}
        errorTitle={t("loadFailed")}
        retryLabel={t("retry")}
        onRetry={() => {
          void query.refetch();
        }}
      />
      {!denied && (
        <Button size="compact" onClick={onBack}>
          {t("backToRecord")}
        </Button>
      )}
      {data && (
        <>
          <h3 className="font-medium">{t("recordedEvidence")}</h3>
          <p>{t("recordedEvidenceHelp")}</p>
          <p className="font-mono text-xs">
            <EvidenceReference reference={data.source} />
          </p>
          {record.evidence && (
            <div className="space-y-2">
              {record.evidence.affectedRecord && (
                <p>
                  <EvidenceReference
                    reference={record.evidence.affectedRecord}
                  />
                </p>
              )}
              {record.evidence.relatedRecords.map((reference) => (
                <p key={JSON.stringify(reference)}>
                  <EvidenceReference reference={reference} />
                </p>
              ))}
            </div>
          )}
          {data.changes.length ? (
            <ul className="space-y-4">
              {data.changes.map((change) => (
                <li
                  className="rounded-lg border p-3"
                  key={JSON.stringify(change.key)}
                >
                  <p className="font-mono text-xs">
                    <EvidenceReference reference={change.reference} />
                  </p>
                  <pre className="mt-2 text-xs break-words whitespace-pre-wrap">
                    {JSON.stringify(change.fields, null, 2)}
                  </pre>
                  {change.evidence?.affectedRecord && (
                    <p className="mt-2">
                      <EvidenceReference
                        reference={change.evidence.affectedRecord}
                      />
                    </p>
                  )}
                  {change.evidence?.relatedRecords.map((reference) => (
                    <p className="mt-2" key={JSON.stringify(reference)}>
                      <EvidenceReference reference={reference} />
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          ) : !hasRecordReferences ? (
            <p>{t("noRecordedEvidence")}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="compact"
              disabled={!cursors.length || query.isFetching}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              {t("previous")}
            </Button>
            <span>{t("page", { page: cursors.length + 1 })}</span>
            <Button
              size="compact"
              disabled={!data.nextCursor || query.isFetching}
              onClick={() => {
                if (data.nextCursor)
                  setCursors((old) => [...old, data.nextCursor!]);
              }}
            >
              {t("next")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function RecordReader({
  record,
  onDenied,
}: {
  record: InspectedRecord;
  onDenied: () => void;
}) {
  const t = useTranslations("recordInspector");
  const [showEvidence, setShowEvidence] = useState(false);
  const [copyState, setCopyState] = useState<"ready" | "copied" | "failed">(
    "ready",
  );
  if (showEvidence)
    return (
      <RecordedEvidence
        record={record}
        onBack={() => setShowEvidence(false)}
        onDenied={onDenied}
      />
    );
  return (
    <div className="space-y-4">
      <p>{t("rawHelp")}</p>
      <Button size="compact" onClick={() => setShowEvidence(true)}>
        {t("recordedEvidence")}
      </Button>
      <div>
        <h3 className="font-medium">{t("reference")}</h3>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
          {JSON.stringify(record.reference, null, 2)}
        </pre>
        <Button
          size="compact"
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify(record.reference),
                );
                setCopyState("copied");
              } catch {
                setCopyState("failed");
              }
            })();
          }}
        >
          {t("copy")}
        </Button>
        {copyState !== "ready" && (
          <p role="status" className="mt-2">
            {t(copyState === "copied" ? "copied" : "copyFailed")}
          </p>
        )}
        <p className="muted mt-2">{t("cliHelp")}</p>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs">
          {"npm run recovery -- records inspect --table MODEL --key '<JSON>'"}
        </pre>
      </div>
      <div>
        <h3 className="font-medium">{t("persisted")}</h3>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
          {JSON.stringify(record.fields, null, 2)}
        </pre>
      </div>
      <div>
        <h3 className="font-medium">{t("omitted")}</h3>
        {record.omitted.length === 0 ? (
          <p>{t("noneOmitted")}</p>
        ) : (
          <dl className="mt-2 space-y-2">
            {record.omitted.map((field) => (
              <div key={field.field}>
                <dt className="font-mono text-xs">{field.field}</dt>
                <dd className="muted">{t(`reasons.${field.reason}`)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function parseExactKey(
  text: string,
  table: RecordTable,
): RecordKey | undefined {
  const parsed: unknown = text.trim() ? JSON.parse(text) : undefined;
  if (
    parsed !== undefined &&
    (!parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.values(parsed).some(
        (value) => !["string", "number", "boolean"].includes(typeof value),
      ) ||
      Object.keys(parsed).length !== table.keyFields.length ||
      table.keyFields.some((field) => !Object.hasOwn(parsed, field)))
  )
    throw new Error("Invalid key");
  return parsed as RecordKey | undefined;
}

function RecordBrowser({
  table,
  initialKey = "",
  onDenied,
}: {
  table: RecordTable;
  initialKey?: string;
  onDenied: () => void;
}) {
  const t = useTranslations("recordInspector");
  // URL state is only a convenience. The server validates the same exact key
  // against trusted metadata before any record query; it never grants authority.
  const [initial] = useState(() => {
    try {
      return { key: parseExactKey(initialKey, table), invalid: false };
    } catch {
      return { key: undefined, invalid: true };
    }
  });
  const [keyText, setKeyText] = useState(initialKey);
  const [key, setKey] = useState<RecordKey | undefined>(initial.key);
  const [invalid, setInvalid] = useState(initial.invalid);
  const [cursors, setCursors] = useState<string[]>([]);
  const [relationshipDenied, setRelationshipDenied] = useState(false);
  const denyRelationships = useCallback(() => {
    setRelationshipDenied(true);
    onDenied();
  }, [onDenied]);
  const records = api.recordInspector.records.useQuery(
    { table: table.name, key, cursor: cursors.at(-1), limit: 25 },
    { enabled: !invalid, retry: false },
  );
  // A failed refresh must unmount readers, including already-open identity dialogs.
  // Never keep stale privileged content visible after access is revoked.
  const denied = useSessionAccessDenied(records) || relationshipDenied;
  useEffect(() => {
    if (denied) onDenied();
  }, [denied, onDenied]);
  const data = denied || records.isError || invalid ? undefined : records.data;
  const refreshRecords = () => {
    void records.refetch().then((result) => {
      if (result.isSuccess) setRelationshipDenied(false);
    });
  };
  return (
    <div className="space-y-4">
      {!denied && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              setKey(parseExactKey(keyText, table));
              setCursors([]);
              setInvalid(false);
            } catch {
              setInvalid(true);
            }
          }}
        >
          <label className="block font-medium" htmlFor="record-key">
            {t("exactKey")}
          </label>
          <textarea
            id="record-key"
            className="input min-h-24 w-full font-mono text-xs"
            value={keyText}
            onChange={(event) => setKeyText(event.target.value)}
            aria-describedby="record-key-help"
            aria-invalid={invalid}
          />
          <p id="record-key-help" className="muted">
            {t("keyHelp", { fields: table.keyFields.join(", ") })}
          </p>
          {invalid && (
            <p role="alert" className="text-red-700">
              {t("invalidKey")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="compact">
              {t("apply")}
            </Button>
            <Button
              size="compact"
              disabled={records.isFetching}
              onClick={() => {
                void records.refetch();
              }}
            >
              {t("refresh")}
            </Button>
          </div>
        </form>
      )}
      <QueryFeedback
        hasData={!!data}
        loading={records.isLoading}
        error={records.isError || relationshipDenied}
        retrying={records.isFetching}
        loadingTitle={t("loading")}
        errorTitle={t("loadFailed")}
        retryLabel={t("retry")}
        onRetry={() => {
          refreshRecords();
        }}
      />
      {data && (
        <>
          <SummaryTable label={table.name}>
            <thead>
              <tr>
                <th>{t("primaryKey")}</th>
                <th className="table-actions-heading">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((record) => (
                <tr key={JSON.stringify(record.key)}>
                  <td className="font-mono text-xs [overflow-wrap:anywhere]">
                    {JSON.stringify(record.key)}
                  </td>
                  <TableActions>
                    <TableDetails
                      title={`${table.name} ${JSON.stringify(record.key)}`}
                      label={t("details")}
                      longReader
                    >
                      <RecordReader
                        record={record}
                        onDenied={denyRelationships}
                      />
                    </TableDetails>
                  </TableActions>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={2}>{t("empty")}</td>
                </tr>
              )}
            </tbody>
          </SummaryTable>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="compact"
              disabled={!cursors.length || records.isFetching}
              onClick={() => setCursors((value) => value.slice(0, -1))}
            >
              {t("previous")}
            </Button>
            <span>{t("page", { page: cursors.length + 1 })}</span>
            <Button
              size="compact"
              disabled={!data.nextCursor || records.isFetching}
              onClick={() => {
                if (data.nextCursor)
                  setCursors((value) => [...value, data.nextCursor!]);
              }}
            >
              {t("next")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function DatabaseInspector({
  initialTable = "",
  initialKey = "",
}: {
  initialTable?: string;
  initialKey?: string;
}) {
  const t = useTranslations("recordInspector");
  const [selected, setSelected] = useState(initialTable);
  const [readerDenied, setReaderDenied] = useState(false);
  const denyReader = useCallback(() => setReaderDenied(true), []);
  const catalog = api.recordInspector.tables.useQuery(undefined, {
    retry: false,
  });
  const denied = useSessionAccessDenied(catalog) || readerDenied;
  const tables = denied || catalog.isError ? undefined : catalog.data;
  const table = tables?.find((candidate) => candidate.name === selected);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      <QueryFeedback
        hasData={!!tables}
        loading={catalog.isLoading}
        error={catalog.isError || readerDenied}
        retrying={catalog.isFetching}
        loadingTitle={t("loading")}
        errorTitle={t("loadFailed")}
        retryLabel={t("retry")}
        onRetry={() => {
          void catalog.refetch().then((result) => {
            if (result.isSuccess) setReaderDenied(false);
          });
        }}
      />
      {tables && (
        <div className="card space-y-4 p-4 sm:p-5">
          <div>
            <label className="mb-1 block font-medium" htmlFor="record-table">
              {t("table")}
            </label>
            <select
              id="record-table"
              className="input w-full"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">{t("chooseTable")}</option>
              {tables.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                  {!item.available ? ` · ${t("operatorOnly")}` : ""}
                </option>
              ))}
            </select>
          </div>
          {table && (
            <>
              <div>
                <h2 className="section-title">{table.name}</h2>
                <p className="muted mt-1">
                  {t("keyFields", { fields: table.keyFields.join(", ") })}
                </p>
              </div>
              <details>
                <summary className="min-h-11 cursor-pointer py-3 font-medium lg:min-h-8 lg:py-1">
                  {t("schema")}
                </summary>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {table.fields.map((field) => (
                    <div key={field.name} className="rounded bg-slate-50 p-2">
                      <dt className="font-mono text-xs">
                        {field.name} · {field.type}
                      </dt>
                      <dd className="muted text-sm">
                        {field.readable
                          ? t("readable")
                          : t(`reasons.${field.reason!}`)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
              {table.available ? (
                <RecordBrowser
                  onDenied={denyReader}
                  key={table.name}
                  table={table}
                  initialKey={table.name === initialTable ? initialKey : ""}
                />
              ) : (
                <p
                  role="status"
                  className="rounded bg-amber-50 p-3 text-amber-900"
                >
                  {t("operatorHelp")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
