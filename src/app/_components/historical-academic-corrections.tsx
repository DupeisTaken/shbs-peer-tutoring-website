"use client";

import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  historicalCorrectionCsv,
  historicalCorrectionInput,
  parseHistoricalCorrectionCsv,
  type HistoricalCorrectionInput,
  type HistoricalCorrectionRow,
} from "~/lib/historical-academics";
import { ProfileDialog } from "./profile-dialog";
import { HistoricalAcademicEvidence } from "./historical-academic-evidence";
import { HistoricalCorrectionReview } from "./historical-correction-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { InlineNotice } from "./ui/patterns";

type AcademicRow =
  RouterOutputs["historicalAcademics"]["list"]["records"][number];
const control = "input min-h-11 lg:min-h-10";

/** Drafts own their exported fingerprints. Background refetches never rebase a staff edit.
 * Website and CSV use the same validated preview and all-or-nothing mutation. */
export function HistoricalAcademicCorrections({
  coordinator,
  initialSearch = "",
}: {
  coordinator: boolean;
  initialSearch?: string;
}) {
  const t = useTranslations("historicalAcademics");
  const utils = api.useUtils();
  const [kind, setKind] = useState<"TUTEE" | "TUTOR">("TUTEE");
  const [search, setSearch] = useState(initialSearch);
  const [submittedSearch, setSubmittedSearch] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<
    Record<string, { row: HistoricalCorrectionRow; record: AcademicRow }>
  >({});
  const [csv, setCsv] = useState<HistoricalCorrectionRow[] | null>(null);
  const [reading, setReading] = useState(false);
  const [reviewInput, setReviewInput] =
    useState<HistoricalCorrectionInput | null>(null);
  const [review, setReview] = useState<
    RouterOutputs["historicalAcademics"]["preview"] | null
  >(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const applyingRef = useRef(false);
  const refreshingRef = useRef(false);
  const previewingRef = useRef(false);
  const consumedReview = useRef(false);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const reviewOpener = useRef<HTMLElement | null>(null);
  const list = api.historicalAcademics.list.useQuery({
    kind,
    search: submittedSearch,
    page,
  });
  const preview = api.historicalAcademics.preview.useMutation();
  const save = api.historicalAcademics.correctBatch.useMutation();
  const busy =
    reading || preview.isPending || save.isPending || applying || refreshing;
  const selected = Object.values(drafts);
  const dirty = selected.length > 0 || csv !== null;

  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function freshRow(record: AcademicRow): HistoricalCorrectionRow {
    return {
      recordId: record.recordId,
      expectedFingerprint: record.fingerprint,
      ...record.current,
      evidence: "",
      reason: "",
    };
  }
  function change(id: string, patch: Partial<HistoricalCorrectionRow>) {
    setDrafts((previous) => ({
      ...previous,
      [id]: { ...previous[id]!, row: { ...previous[id]!.row, ...patch } },
    }));
    setNotice(null);
  }
  function showError(cause: unknown, fallback = "failed") {
    if (cause instanceof ZodError) {
      const issues = cause.issues.slice(0, 5).map((issue) => {
        const index = issue.path.find((part) => typeof part === "number");
        const field = String(issue.path.at(-1) ?? "");
        return typeof index === "number" && t.has(field)
          ? t("invalidRow", { row: index + 1, field: t(field) })
          : t.has(issue.message)
            ? t(issue.message)
            : t("invalid");
      });
      setError([...new Set(issues)].join(" "));
      return;
    }
    const message = cause instanceof Error ? cause.message : "failed";
    setError(t.has(message) ? t(message) : t(fallback));
  }
  async function openPreview(input: HistoricalCorrectionInput) {
    if (
      busy || applyingRef.current || refreshingRef.current ||
      previewingRef.current || review
    ) return;
    previewingRef.current = true;
    // The preview request disables its opener before the dialog mounts. Preserve
    // that control now rather than relying on focus captured after the request.
    reviewOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setError(null);
    setNotice(null);
    setAcknowledged(false);
    try {
      const validated = historicalCorrectionInput.parse(input);
      const result = await preview.mutateAsync(validated);
      consumedReview.current = false;
      setReviewInput(validated);
      setReview(result);
    } catch (cause) {
      showError(cause);
    } finally {
      previewingRef.current = false;
    }
  }
  function closeReview() {
    if (applyingRef.current) return;
    setReview(null);
    setReviewInput(null);
    setError(null);
    requestAnimationFrame(() => {
      if (reviewOpener.current?.isConnected) reviewOpener.current.focus();
    });
  }
  async function refreshRecords() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    // Query invalidation normally suppresses GET failures. Report them only after
    // every matching read and every affected view settles; retry performs reads only.
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.historicalAcademics),
        () => invalidateAndReport(utils.admin.tutees),
        () => invalidateAndReport(utils.tuteeHistory),
      ]);
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }
  async function apply() {
    if (
      !review || !reviewInput || !acknowledged ||
      applyingRef.current || consumedReview.current
    ) return;
    // Own both the write and its synchronization, including the same render frame.
    applyingRef.current = true;
    setApplying(true);
    setError(null);
    try {
      const result = await save.mutateAsync({
        ...reviewInput,
        ticket: review.ticket,
      });
      consumedReview.current = true;
      setReview(null);
      setReviewInput(null);
      // Only consume the reviewed workflow. A CSV save must not discard a separate
      // website draft (or vice versa); its original fingerprint still guards replay.
      if (reviewInput.method === "CSV") {
        setCsv(null);
        if (fileInput.current) fileInput.current.value = "";
      } else {
        setDrafts((previous) => {
          const remaining = { ...previous };
          for (const row of reviewInput.rows) delete remaining[row.recordId];
          return remaining;
        });
      }
      setNotice(t("saved", { count: result.count }));
      // A committed save stays a success even if network refresh fails. Never resubmit it.
      await refreshRecords();
    } catch (cause) {
      if (
        cause &&
        typeof cause === "object" &&
        "data" in cause &&
        (cause.data as { approvalId?: string } | undefined)?.approvalId
      ) {
        consumedReview.current = true;
        setReview(null);
        setReviewInput(null);
        setNotice(t("queued"));
      } else showError(cause);
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    const version = ++generation.current;
    setReading(true);
    setError(null);
    setNotice(null);
    try {
      if (file.size > 256 * 1024) throw new Error("HISTORICAL_CSV_LIMIT");
      const rows = parseHistoricalCorrectionCsv(await file.text());
      if (version === generation.current) setCsv(rows);
    } catch (cause) {
      if (version === generation.current) {
        setCsv(null);
        showError(cause, "invalid");
      }
    } finally {
      if (version === generation.current) setReading(false);
    }
  }
  function download() {
    const rows = selected.length
      ? selected.map((item) => item.row)
      : (list.data?.records ?? []).slice(0, 50).map(freshRow);
    const url = URL.createObjectURL(
      new Blob([historicalCorrectionCsv(rows)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "historical-academic-corrections.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-2 max-w-3xl">{t("intro")}</p>
      </header>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {t(coordinator ? "coordinatorHelp" : "atomicHelp")}
      </p>
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-emerald-900"
        >
          {notice}
        </p>
      )}
      {error && !review && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {refreshFailed && (
        <InlineNotice tone="warning" announcement="alert">
          {t("refreshFailed")}
        </InlineNotice>
      )}
      <section
        className="card space-y-4 p-4 sm:p-6"
        aria-labelledby="historical-csv-title"
      >
        <h2 id="historical-csv-title" className="section-title">
          {t("csvTitle")}
        </h2>
        <p className="muted text-sm">{t("csvHelp")}</p>
        <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
          <button
            className="btn-secondary min-h-11 lg:min-h-10"
            // Do not export the cached version while a deliberate refresh is pending.
            disabled={
              busy ||
              list.isFetching ||
              (!selected.length && !list.data?.records.length)
            }
            onClick={download}
          >
            {t("download")}
          </button>
          <label className="min-w-0 flex-1">
            <span className="label">{t("upload")}</span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              className="mt-1 block min-h-11 w-full min-w-0 text-sm file:mr-2 file:min-h-11 lg:min-h-10 lg:file:min-h-10"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </label>
          <button
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={busy || !csv}
            onClick={() =>
              csv && void openPreview({ rows: csv, method: "CSV" })
            }
          >
            {t("previewCsv")}
          </button>
        </div>
        {csv && (
          <p role="status" className="text-sm">
            {t("csvReady", { count: csv.length })}
          </p>
        )}
      </section>
      <section className="space-y-4" aria-labelledby="historical-website-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="historical-website-title" className="section-title">
            {t("websiteTitle")}
          </h2>
          <button
            className="btn-secondary min-h-11 lg:min-h-10"
            disabled={busy || list.isFetching}
            onClick={() => {
              if (!busy && !applyingRef.current && !refreshingRef.current)
                void (refreshFailed ? refreshRecords() : list.refetch());
            }}
          >
            {t("refresh")}
          </button>
        </div>
        <form
          className="grid gap-3 sm:flex sm:flex-wrap sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedSearch(search);
            setPage(0);
          }}
        >
          <label>
            <span className="label">{t("participantType")}</span>
            <select
              className={control}
              value={kind}
              disabled={busy}
              onChange={(event) => {
                setKind(event.target.value as "TUTEE" | "TUTOR");
                setPage(0);
              }}
            >
              <option value="TUTEE">{t("TUTEE")}</option>
              <option value="TUTOR">{t("TUTOR")}</option>
            </select>
          </label>
          <label className="min-w-0 flex-1">
            <span className="label">{t("search")}</span>
            <input
              className={control}
              value={search}
              disabled={busy}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="btn-secondary min-h-11 lg:min-h-10"
            disabled={busy}
          >
            {t("find")}
          </button>
        </form>
        {list.isLoading && <p role="status">{t("loading")}</p>}
        {list.error && (
          <p role="alert" className="text-red-700">
            {t("loadFailed")}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {list.data?.records.map((record) => (
            <article key={record.recordId} className="card min-w-0 p-4">
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={`${record.name} · ${record.recordId}`}
                  className="mt-3 h-5 w-5"
                  checked={!!drafts[record.recordId]}
                  disabled={
                    busy ||
                    record.ownershipConflict ||
                    (!drafts[record.recordId] && selected.length >= 50)
                  }
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setDrafts((previous) => {
                      const next = { ...previous };
                      if (checked)
                        next[record.recordId] = {
                          row: freshRow(record),
                          record,
                        };
                      else delete next[record.recordId];
                      return next;
                    });
                  }}
                />
                <span className="min-w-0 pt-2 font-semibold break-words">
                  {record.name}
                </span>
              </label>
              <HistoricalAcademicEvidence
                records={[record]}
                onHistory={setAuditId}
              />
              {record.ownershipConflict && (
                <p className="mt-2 text-sm text-red-700">
                  {t("HISTORICAL_OWNERSHIP_CONFLICT")}
                </p>
              )}
            </article>
          ))}
        </div>
        {!list.isLoading && list.data?.records.length === 0 && (
          <p>{t("empty")}</p>
        )}
        <div className="flex items-center gap-3">
          <button
            className="btn-secondary min-h-11 lg:min-h-8 lg:py-0"
            disabled={busy || page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            {t("previous")}
          </button>
          <span>{t("page", { page: page + 1 })}</span>
          <button
            className="btn-secondary min-h-11 lg:min-h-8 lg:py-0"
            disabled={busy || !list.data?.hasNext}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("next")}
          </button>
        </div>
      </section>
      {selected.length > 0 && (
        <section
          className="card space-y-4 p-4 sm:p-6"
          aria-labelledby="historical-drafts-title"
        >
          <h2 id="historical-drafts-title" className="section-title">
            {t("selected", { count: selected.length })}
          </h2>
          <p className="muted text-sm">{t("draftHelp")}</p>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void openPreview({
                rows: selected.map((item) => item.row),
                method: "WEBSITE",
              });
            }}
          >
            {selected.map(({ record, row }) => (
              <fieldset
                key={row.recordId}
                disabled={busy}
                className="min-w-0 rounded-lg border border-slate-200 p-3"
              >
                <legend className="px-1 font-medium">{record.name}</legend>
                <p className="muted mb-3 text-xs break-all">{row.recordId}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="label">{t("rawGrade")}</span>
                    <input
                      className={control}
                      maxLength={200}
                      value={row.rawGrade ?? ""}
                      onChange={(event) =>
                        change(row.recordId, {
                          rawGrade: event.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className="label">{t("schoolYear")}</span>
                    <input
                      className={control}
                      placeholder="24-25"
                      pattern="[0-9]{2}-[0-9]{2}"
                      value={row.schoolYear ?? ""}
                      onChange={(event) =>
                        change(row.recordId, {
                          schoolYear: event.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className="label">{t("evidence")}</span>
                    <input
                      className={control}
                      required
                      maxLength={500}
                      value={row.evidence}
                      onChange={(event) =>
                        change(row.recordId, { evidence: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span className="label">{t("reason")}</span>
                    <input
                      className={control}
                      required
                      minLength={10}
                      maxLength={500}
                      value={row.reason}
                      onChange={(event) =>
                        change(row.recordId, { reason: event.target.value })
                      }
                    />
                  </label>
                </div>
              </fieldset>
            ))}
            <button
              className="btn-primary min-h-11 lg:min-h-10"
              disabled={busy}
            >
              {preview.isPending ? t("working") : t("previewWebsite")}
            </button>
          </form>
        </section>
      )}
      {dirty && (
        <button
          className="btn-secondary min-h-11 lg:min-h-10"
          disabled={busy}
          onClick={() => setClearOpen(true)}
        >
          {t("clear")}
        </button>
      )}
      {auditId && (
        <HistoricalCorrectionAudit
          recordId={auditId}
          onClose={() => setAuditId(null)}
        />
      )}
      {clearOpen && (
        <ProfileDialog title={t("clear")} onClose={() => setClearOpen(false)}>
          <p>{t("clearConfirm")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="btn-secondary min-h-11 lg:min-h-10"
              onClick={() => setClearOpen(false)}
            >
              {t("keep")}
            </button>
            <button
              className="btn-danger min-h-11 lg:min-h-10"
              onClick={() => {
                setDrafts({});
                setCsv(null);
                setClearOpen(false);
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              {t("discard")}
            </button>
          </div>
        </ProfileDialog>
      )}
      {review && (
        <ProfileDialog
          title={t("reviewTitle")}
          size="wide"
          pending={save.isPending || applying}
          onClose={closeReview}
        >
          <HistoricalCorrectionReview records={review.records} />
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-red-800"
            >
              {error}
            </p>
          )}
          <label className="my-4 flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              disabled={save.isPending || applying}
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span className="text-sm">{t("acknowledge")}</span>
          </label>
          <button
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={!acknowledged || save.isPending || applying}
            onClick={() => void apply()}
          >
            {t(save.isPending || applying ? "working" : coordinator ? "propose" : "apply")}
          </button>
        </ProfileDialog>
      )}
    </div>
  );
}

function HistoricalCorrectionAudit({
  recordId,
  onClose,
}: {
  recordId: string;
  onClose: () => void;
}) {
  const t = useTranslations("historicalAcademics");
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const audit = api.historicalAcademics.audit.useQuery({ recordId, page });
  return (
    <ProfileDialog title={t("allCorrections")} onClose={onClose}>
      <p className="muted mb-3 text-xs break-all">{recordId}</p>
      {audit.isLoading && <p role="status">{t("loading")}</p>}
      {audit.error && <p role="alert">{t("loadFailed")}</p>}
      <ol className="space-y-4">
        {audit.data?.rows.map((row) => (
          <li
            key={row.id}
            className="rounded-lg border border-slate-200 p-3 text-sm"
          >
            <p className="font-semibold">
              {t("revision", { revision: row.revision })} ·{" "}
              {row.rawGrade ?? t("unknown")} ·{" "}
              {row.schoolYear ?? t("unknownYear")}
            </p>
            <p className="muted mt-1">
              {format.dateTime(row.correctedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              · {row.actorName}
            </p>
            <p className="mt-2 break-words">
              {t("evidence")}: {row.evidence}
            </p>
            <p className="mt-1 break-words">
              {t("reason")}: {row.reason}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex gap-3">
        <button
          className="btn-secondary min-h-11 lg:min-h-8 lg:py-0"
          disabled={page === 0}
          onClick={() => setPage((value) => value - 1)}
        >
          {t("previous")}
        </button>
        <button
          className="btn-secondary min-h-11 lg:min-h-8 lg:py-0"
          disabled={!audit.data?.hasNext}
          onClick={() => setPage((value) => value + 1)}
        >
          {t("next")}
        </button>
      </div>
    </ProfileDialog>
  );
}
