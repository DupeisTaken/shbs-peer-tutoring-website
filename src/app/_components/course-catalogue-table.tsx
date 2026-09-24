"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Subject = {
  id: string;
  name: string;
  levelId: string | null;
  active: boolean;
};
type Level = { id: string; name: string };
type Batch = { ids: string[]; active?: boolean; levelId?: string | null };

/** Filters are a view only. Keep selections visible in the summary, and intersect
 * them with current rows at submission so a batch never touches hidden courses. */
export function CourseCatalogueTable({
  subjects,
  levels,
  readOnly,
  pending,
  onApply,
}: {
  subjects: Subject[];
  levels: Level[];
  readOnly: boolean;
  pending: boolean;
  onApply: (input: Batch) => Promise<unknown>;
}) {
  const t = useTranslations("courseCatalogue");
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchStatus, setBatchStatus] = useState("keep");
  const [batchLevel, setBatchLevel] = useState("keep");
  const query = search.trim().toLocaleLowerCase();
  const visible = subjects.filter(
    (subject) =>
      subject.name.toLocaleLowerCase().includes(query) &&
      (level === "all" ||
        (level === "none"
          ? subject.levelId === null
          : subject.levelId === level)) &&
      (status === "all" || subject.active === (status === "active")),
  );
  const selectedIds = subjects
    .filter((s) => selected.has(s.id))
    .map((s) => s.id);
  const visibleSelected = visible
    .filter((s) => selected.has(s.id))
    .map((s) => s.id);
  const allVisibleSelected =
    visible.length > 0 && visibleSelected.length === visible.length;
  const filtered = !!search || level !== "all" || status !== "all";
  const resetFilters = () => {
    setSearch("");
    setLevel("all");
    setStatus("all");
  };
  const control = "min-h-11 w-full lg:min-h-10";
  return (
    <section
      className="card space-y-4 p-4 sm:p-5"
      aria-labelledby="catalogue-heading"
    >
      <div>
        <h2 id="catalogue-heading" className="section-title">
          {t("title")}
        </h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
      </div>
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,2fr)_1fr_1fr_auto]">
        <label className="min-w-0">
          <span className="label">{t("search")}</span>
          <input
            type="search"
            className={`input ${control}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="min-w-0">
          <span className="label">{t("level")}</span>
          <select
            className={`select ${control}`}
            aria-label={t("level")}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="all">{t("allLevels")}</option>
            <option value="none">{t("noLevel")}</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="label">{t("status")}</span>
          <select
            className={`select ${control}`}
            aria-label={t("status")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">{t("allStatuses")}</option>
            <option value="active">{t("active")}</option>
            <option value="inactive">{t("inactive")}</option>
          </select>
        </label>
        <button
          type="button"
          className="btn-secondary min-h-11 lg:min-h-10"
          disabled={!filtered}
          onClick={resetFilters}
        >
          {t("clearFilters")}
        </button>
      </div>
      <p role="status" className="text-sm text-slate-600">
        {t("count", { count: visible.length, total: subjects.length })}
      </p>
      {!readOnly && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex min-h-11 items-center gap-2 lg:min-h-10">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(node) => {
                  if (node)
                    node.indeterminate =
                      visibleSelected.length > 0 && !allVisibleSelected;
                }}
                disabled={!visible.length || pending}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const s of visible) {
                      if (checked) next.add(s.id);
                      else next.delete(s.id);
                    }
                    return next;
                  });
                }}
              />
              {t("selectAll")}
            </label>
            <span className="text-sm" aria-live="polite">
              {t("selected", {
                count: selectedIds.length,
                hidden: selectedIds.length - visibleSelected.length,
              })}
            </span>
            <button
              type="button"
              className="btn-secondary min-h-11 lg:min-h-10"
              disabled={!selectedIds.length || pending}
              onClick={() => setSelected(new Set())}
            >
              {t("clearSelection")}
            </button>
          </div>
          {selectedIds.length > 0 && (
            <form
              className="grid items-end gap-3 sm:grid-cols-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  pending ||
                  !visibleSelected.length ||
                  (batchStatus === "keep" && batchLevel === "keep")
                )
                  return;
                const ids = visibleSelected;
                try {
                  await onApply({
                    ids,
                    ...(batchStatus !== "keep"
                      ? { active: batchStatus === "active" }
                      : {}),
                    ...(batchLevel !== "keep"
                      ? { levelId: batchLevel === "none" ? null : batchLevel }
                      : {}),
                  });
                  setSelected(
                    (current) =>
                      new Set([...current].filter((id) => !ids.includes(id))),
                  );
                } catch {
                  /* The page displays mutation errors; retain selections for retry. */
                }
              }}
            >
              <label className="min-w-0">
                <span className="label">{t("batchLevel")}</span>
                <select
                  className={`select ${control}`}
                  aria-label={t("batchLevel")}
                  value={batchLevel}
                  disabled={pending}
                  onChange={(e) => setBatchLevel(e.target.value)}
                >
                  <option value="keep">{t("keep")}</option>
                  <option value="none">{t("noLevel")}</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0">
                <span className="label">{t("batchStatus")}</span>
                <select
                  className={`select ${control}`}
                  aria-label={t("batchStatus")}
                  value={batchStatus}
                  disabled={pending}
                  onChange={(e) => setBatchStatus(e.target.value)}
                >
                  <option value="keep">{t("keep")}</option>
                  <option value="active">{t("active")}</option>
                  <option value="inactive">{t("inactive")}</option>
                </select>
              </label>
              <button
                className="btn-primary min-h-11 lg:min-h-10"
                disabled={
                  pending ||
                  !visibleSelected.length ||
                  (batchLevel === "keep" && batchStatus === "keep")
                }
              >
                {t("apply", { count: visibleSelected.length })}
              </button>
              <p className="muted text-sm sm:col-span-3">{t("batchHelp")}</p>
            </form>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              {!readOnly && (
                <th className="py-3 pr-2">
                  <span className="sr-only">{t("selection")}</span>
                </th>
              )}
              <th className="px-2 py-3">{t("name")}</th>
              <th className="px-2 py-3">{t("level")}</th>
              <th className="px-2 py-3">{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((subject) => (
              <tr
                key={subject.id}
                className="border-b border-slate-100 last:border-0"
              >
                {!readOnly && (
                  <td className="pr-2">
                    <label className="flex min-h-11 min-w-11 items-center justify-center lg:min-h-10 lg:min-w-9">
                      <span className="sr-only">
                        {t("select", { name: subject.name })}
                      </span>
                      <input
                        type="checkbox"
                        checked={selected.has(subject.id)}
                        disabled={pending}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(subject.id);
                            else next.delete(subject.id);
                            return next;
                          });
                        }}
                      />
                    </label>
                  </td>
                )}
                <td className="px-2 py-3 font-medium [overflow-wrap:anywhere]">
                  {subject.name}
                </td>
                <td className="px-2 py-3">
                  {levels.find((l) => l.id === subject.levelId)?.name ??
                    t("noLevel")}
                </td>
                <td className="px-2 py-3">
                  <span className="badge-slate">
                    {subject.active ? t("active") : t("inactive")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <div className="py-6 text-center">
          <p className="font-medium">
            {t(subjects.length ? "noMatches" : "empty")}
          </p>
          {subjects.length > 0 && (
            <p className="muted mt-1 text-sm">{t("emptyHelp")}</p>
          )}
        </div>
      )}
    </section>
  );
}
