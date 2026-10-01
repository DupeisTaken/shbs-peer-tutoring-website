"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  TRANSFER_MAX_BYTES,
  transferFilesSchema,
  type TransferFile,
} from "~/lib/record-transfer";

export function RecordTransfer() {
  const t = useTranslations("recordTransfer");
  const history = useTranslations("tuteeHistory");
  const utils = api.useUtils();
  const [files, setFiles] = useState<TransferFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const selection = useRef(0);
  const preview = api.recordTransfer.preview.useMutation();
  const importer = api.recordTransfer.import.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
    },
  });
  const exporter = api.recordTransfer.export.useMutation();
  const busy =
    reading || preview.isPending || importer.isPending || exporter.isPending;
  const summary = importer.data?.summary ?? preview.data?.summary;
  const error =
    fileError ??
    preview.error?.message ??
    importer.error?.message ??
    exporter.error?.message;

  async function download(templates: boolean) {
    setFileError(null);
    try {
      const result = await exporter.mutateAsync({ templates });
      // ZIP code is loaded only when needed; other management pages do not pay for it.
      const { createRecordArchive } =
        await import("~/lib/record-transfer-archive");
      const bytes = createRecordArchive(result.files);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = templates
        ? "program-csv-templates.zip"
        : `program-records-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : t("readError"));
    }
  }

  async function selectFiles(selected: FileList | null) {
    const generation = ++selection.current;
    setFiles([]);
    setFileError(null);
    setConfirmed(false);
    preview.reset();
    importer.reset();
    exporter.reset();
    if (!selected?.length) return;
    setReading(true);
    try {
      const source = Array.from(selected);
      if (source.reduce((n, f) => n + f.size, 0) > TRANSFER_MAX_BYTES)
        throw new Error(t("limits"));
      let parsed: TransferFile[];
      if (
        source.length === 1 &&
        source[0]!.name.toLowerCase().endsWith(".zip")
      ) {
        const { readRecordArchive } =
          await import("~/lib/record-transfer-archive");
        parsed = readRecordArchive(
          new Uint8Array(await source[0]!.arrayBuffer()),
        );
      } else
        parsed = transferFilesSchema.parse(
          await Promise.all(
            source.map(async (f) => ({ name: f.name, text: await f.text() })),
          ),
        );
      if (generation === selection.current) setFiles(parsed);
    } catch (err) {
      if (generation === selection.current)
        setFileError(err instanceof Error ? err.message : t("readError"));
    } finally {
      if (generation === selection.current) setReading(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{t("title")}</h1>
          <p className="muted mt-2 max-w-2xl">{t("subtitle")}</p>
          <p className="mt-3 max-w-2xl rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">{history("importHelp")}</p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
          {t("headOnly")}
        </span>
      </div>
      <section className="card p-5 sm:p-6" aria-labelledby="export-heading">
        <h2 id="export-heading" className="section-title">
          {t("exportTitle")}
        </h2>
        <p className="muted mt-2 text-sm">{t("exportHelp")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={busy}
            onClick={() => void download(false)}
          >
            {exporter.isPending ? t("working") : t("exportButton")}
          </button>
          <button
            className="btn-secondary min-h-11 lg:min-h-10"
            disabled={busy}
            onClick={() => void download(true)}
          >
            {t("templates")}
          </button>
        </div>
      </section>
      <section
        className="card space-y-4 p-5 sm:p-6"
        aria-labelledby="import-heading"
      >
        <div>
          <h2 id="import-heading" className="section-title">
            {t("importTitle")}
          </h2>
          <p className="muted mt-2 text-sm">{t("importHelp")}</p>
        </div>
        <label className="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <span className="label">{t("select")}</span>
          <input
            type="file"
            multiple
            accept=".csv,.zip,text/csv,application/zip"
            className="mt-3 block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-white file:px-3 file:font-medium"
            disabled={busy}
            onChange={(e) => void selectFiles(e.target.files)}
            aria-describedby="transfer-limits"
          />
          <span id="transfer-limits" className="muted mt-2 block text-xs">
            {t("limits")}
          </span>
        </label>
        {files.length > 0 && (
          <p className="muted text-sm">
            {t("selected", { count: files.length })}
          </p>
        )}
        <button
          className="btn-secondary min-h-11 lg:min-h-10"
          disabled={busy || !files.length || !!importer.data}
          onClick={() => {
            setConfirmed(false);
            importer.reset();
            preview.mutate({ files });
          }}
        >
          {preview.isPending ? t("working") : t("preview")}
        </button>
        {summary && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="data-table">
              <caption className="px-4 py-3 text-left text-sm font-semibold">
                {importer.data ? t("complete") : t("previewTitle")}
              </caption>
              <thead>
                <tr>
                  <th>{t("recordType")}</th>
                  <th>{t("new")}</th>
                  <th>{t("skipped")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.table}>
                    <td>{row.table}</td>
                    <td>{row.created}</td>
                    <td>{row.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {preview.data && !importer.data && (
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>{t("confirm")}</span>
            </label>
            <button
              className="btn-primary min-h-11 lg:min-h-10"
              disabled={!confirmed || busy}
              onClick={() =>
                importer.mutate({ files, ticket: preview.data.ticket })
              }
            >
              {importer.isPending ? t("working") : t("importButton")}
            </button>
          </div>
        )}
        {importer.data && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {t("success")}
          </p>
        )}
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm break-words text-red-800"
        >
          {error}
        </p>
      )}
      <p className="muted text-sm">{t("scope")}</p>
    </div>
  );
}
