"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { api } from "~/trpc/react";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { useReadOnly } from "~/app/_components/read-only";
import { useDialog } from "~/app/_components/confirm-dialog";

/** Parse a simple "name,level" CSV (optional header row) into rows. */
function parseCsv(text: string): { name: string; level?: string }[] {
  const rows: { name: string; level?: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [name, level] = trimmed.split(",").map((s) => s.trim());
    if (!name || name.toLowerCase() === "name") continue; // skip header / blank
    rows.push({ name, level: level && level.length > 0 ? level : undefined });
  }
  return rows;
}

export default function SubjectsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const { confirm, dialog } = useDialog();
  const utils = api.useUtils();
  const courses = api.admin.subjects.useQuery(undefined, { staleTime: REFERENCE_STALE_TIME });
  const levels = api.admin.subjectLevels.useQuery();

  const invalidate = () =>
    Promise.all([utils.admin.subjects.invalidate(), utils.admin.subjectLevels.invalidate()]);

  const create = api.admin.createSubject.useMutation({ onSuccess: invalidate });
  const update = api.admin.updateSubject.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteSubject.useMutation({ onSuccess: invalidate });
  const batch = api.admin.batchUpdateSubjects.useMutation({
    onSuccess: async () => {
      setSelected(new Set());
      await invalidate();
    },
  });
  const importSubjects = api.admin.importSubjects.useMutation({
    onSuccess: async (r) => {
      setImportMsg(t("admin.courses.import.result", { created: r.created, received: r.received }));
      if (fileRef.current) fileRef.current.value = "";
      await invalidate();
    },
  });
  const createLevel = api.admin.createSubjectLevel.useMutation({ onSuccess: invalidate });
  const updateLevel = api.admin.updateSubjectLevel.useMutation({ onSuccess: invalidate });
  const delLevel = api.admin.deleteSubjectLevel.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState("");
  const [levelId, setLevelId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchLevel, setBatchLevel] = useState("");
  const [newLevel, setNewLevel] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const levelList = levels.data ?? [];
  const list = courses.data ?? [];
  const allSelected = list.length > 0 && selected.size === list.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onCsv = async (file: File) => {
    const rows = parseCsv(await file.text());
    if (rows.length === 0) {
      setImportMsg(t("admin.courses.import.empty"));
      return;
    }
    importSubjects.mutate({ subjects: rows });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{t("admin.courses.title")}</h1>
        <p className="muted mt-1">{t("admin.courses.subtitle")}</p>
      </div>

      {/* Levels */}
      <section className="card p-5">
        <h2 className="section-title">{t("admin.courses.levels.title")}</h2>
        <p className="muted mt-1 text-xs">{t("admin.courses.levels.description")}</p>
        <div className="mt-3 space-y-2">
          {levelList.map((l) => (
            <div
              key={l.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
            >
              {readOnly ? (
                <span className="min-w-40">{l.name}</span>
              ) : (
                <input
                  defaultValue={l.name}
                  className="input field-auto h-8 min-w-40"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== l.name) updateLevel.mutate({ id: l.id, name: v });
                  }}
                />
              )}
              {readOnly ? (
                l.apScored && (
                  <span className="text-sm text-slate-600">
                    {t("admin.courses.levels.apScored")}
                  </span>
                )
              ) : (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={l.apScored}
                    onChange={(e) => updateLevel.mutate({ id: l.id, apScored: e.target.checked })}
                  />
                  {t("admin.courses.levels.apScored")}
                </label>
              )}
              {!readOnly && (
                <button
                  className="link-danger ml-auto text-sm"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t("admin.courses.levels.confirmDelete", { name: l.name }),
                        confirmLabel: t("common.delete"),
                        cancelLabel: t("common.cancel"),
                        danger: true,
                      })
                    )
                      delLevel.mutate({ id: l.id });
                  }}
                >
                  {t("admin.courses.levels.remove")}
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <form
              className="flex items-center gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newLevel.trim())
                  createLevel.mutate(
                    { name: newLevel.trim(), rank: levelList.length },
                    { onSuccess: () => setNewLevel("") },
                  );
              }}
            >
              <input
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value)}
                placeholder={t("admin.courses.levels.addPlaceholder")}
                className="input field-auto h-8 min-w-44"
              />
              <button
                className="btn-secondary btn-sm"
                disabled={!newLevel.trim() || createLevel.isPending}
              >
                {t("admin.courses.levels.add")}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Add a course + CSV import */}
      {!readOnly && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim())
                  create.mutate(
                    { name: name.trim(), levelId: levelId || null },
                    { onSuccess: () => setName("") },
                  );
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("admin.courses.add.namePlaceholder")}
                className="input field-auto min-w-48"
              />
              <select
                className="select field-auto min-w-40"
                value={levelId}
                onChange={(e) => setLevelId(e.target.value)}
              >
                <option value="">{t("admin.courses.noLevel")}</option>
                {levelList.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button className="btn-primary" disabled={!name.trim() || create.isPending}>
                {t("admin.courses.add.submit")}
              </button>
            </form>

            <label className="btn-secondary btn-sm cursor-pointer">
              {importSubjects.isPending ? t("admin.courses.import.importing") : t("admin.courses.import.upload")}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onCsv(f);
                }}
              />
            </label>
          </div>
          <p className="muted text-xs">
            {t("admin.courses.import.formatPrefix")} <code>name,level</code>{" "}
            {t("admin.courses.import.formatSuffix")}
          </p>
          {importMsg && <p className="text-sm text-green-600">{importMsg}</p>}
          {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
          {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}
        </>
      )}

      {/* Batch toolbar */}
      {!readOnly && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2">
          <span className="text-sm font-medium text-accent-800">{t("admin.courses.batch.selected", { count: selected.size })}</span>
          <select
            className="select field-auto min-w-40"
            value={batchLevel}
            onChange={(e) => setBatchLevel(e.target.value)}
          >
            <option value="">{t("admin.courses.noLevel")}</option>
            {levelList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary btn-sm"
            disabled={batch.isPending}
            onClick={() => batch.mutate({ ids: [...selected], levelId: batchLevel || null })}
          >
            {t("admin.courses.batch.setLevel")}
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => batch.mutate({ ids: [...selected], active: true })}
          >
            {t("admin.courses.batch.activate")}
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => batch.mutate({ ids: [...selected], active: false })}
          >
            {t("admin.courses.batch.deactivate")}
          </button>
          <button className="link text-sm" onClick={() => setSelected(new Set())}>
            {t("admin.courses.batch.clear")}
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {!readOnly && (
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(list.map((c) => c.id)))
                    }
                  />
                </th>
              )}
              <th>{t("admin.courses.table.name")}</th>
              <th>{t("admin.courses.table.level")}</th>
              <th>{t("admin.courses.table.active")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                {!readOnly && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                  </td>
                )}
                <td>
                  {readOnly ? (
                    <span>{c.name}</span>
                  ) : (
                    <input
                      defaultValue={c.name}
                      className="input field-auto min-w-40"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== c.name)
                          update.mutate({ id: c.id, name: v, active: c.active });
                      }}
                    />
                  )}
                </td>
                <td>
                  {readOnly ? (
                    <span>{c.level?.name ?? t("admin.courses.table.noLevelShort")}</span>
                  ) : (
                    <select
                      className="select field-auto min-w-40"
                      value={c.level?.id ?? ""}
                      onChange={(e) =>
                        update.mutate({
                          id: c.id,
                          name: c.name,
                          levelId: e.target.value || null,
                          active: c.active,
                        })
                      }
                    >
                      <option value="">{t("admin.courses.table.noLevelShort")}</option>
                      {levelList.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  {readOnly ? (
                    <input type="checkbox" checked={c.active} disabled readOnly />
                  ) : (
                    <input
                      type="checkbox"
                      checked={c.active}
                      onChange={(e) =>
                        update.mutate({ id: c.id, name: c.name, active: e.target.checked })
                      }
                    />
                  )}
                </td>
                <td className="text-right">
                  {!readOnly && (
                    <button className="link-danger" onClick={() => del.mutate({ id: c.id })}>
                      {t("admin.courses.table.delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 4 : 5} className="text-slate-500">
                  {t("admin.courses.table.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  );
}
