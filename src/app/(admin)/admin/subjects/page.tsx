"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { courseName } from "~/lib/course-catalogue";
import { useReadOnly } from "~/app/_components/read-only";

type Group = RouterOutputs["admin"]["courseGroups"][number];
type Level = RouterOutputs["admin"]["subjectLevels"][number];
type Variant = RouterOutputs["admin"]["subjects"][number];

/** Local drafts keep toggles, per-level names and previews together until a deliberate save. */
function GroupEditor({
  group,
  levels,
  variants,
  done,
  invalidate,
}: {
  group?: Group;
  levels: Level[];
  variants: Variant[];
  done: () => void;
  invalidate: () => Promise<unknown>;
}) {
  const t = useTranslations("courseGroups");
  const [name, setName] = useState(group?.name ?? "");
  const [offers, setOffers] = useState<
    Record<string, { baseName: string; subjectId?: string }>
  >(() =>
    Object.fromEntries(
      (group?.subjects ?? [])
        .filter((s) => s.active)
        .map((s) => [
          s.levelId ?? "",
          { baseName: s.baseName || s.name, subjectId: s.id },
        ]),
    ),
  );
  const save = api.admin.saveCourseGroup.useMutation({
    onSuccess: async () => {
      await invalidate();
      done();
    },
  });
  const choices = [
    ...levels.map((l) => ({ id: l.id, name: l.name, prefix: l.prefix })),
    ...(offers[""] || group?.subjects.some((s) => !s.levelId)
      ? [{ id: "", name: t("noLevel"), prefix: "" }]
      : []),
  ];
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          id: group?.id,
          name,
          offerings: Object.entries(offers).map(([levelId, value]) => ({
            ...value,
            levelId: levelId || null,
          })),
        });
      }}
    >
      <label className="block">
        <span className="label">{t("groupName")}</span>
        <input
          className="input min-h-11 w-full lg:min-h-9"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <fieldset className="space-y-3">
        <legend className="label">{t("offeredLevels")}</legend>
        {choices.map((level) => (
          <div
            key={level.id}
            className="rounded-lg border border-slate-200 p-3"
          >
            <label className="flex min-h-11 items-center gap-3 lg:min-h-8">
              <input
                type="checkbox"
                checked={!!offers[level.id]}
                onChange={(e) =>
                  setOffers((current) => {
                    const next = { ...current };
                    if (e.target.checked) {
                      const existing = group?.subjects.find(
                        (s) => s.levelId === level.id,
                      );
                      next[level.id] = {
                        baseName: (existing?.baseName ?? "") || name,
                        subjectId: existing?.id,
                      };
                    } else delete next[level.id];
                    return next;
                  })
                }
              />
              <span className="font-medium">{level.name}</span>
            </label>
            {offers[level.id] && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="label">
                    {t("baseName", { level: level.name })}
                  </span>
                  <input
                    className="input min-h-11 w-full lg:min-h-9"
                    required
                    maxLength={160}
                    value={offers[level.id]!.baseName}
                    onChange={(e) =>
                      setOffers({
                        ...offers,
                        [level.id]: {
                          ...offers[level.id]!,
                          baseName: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  <span className="label">{t("existingVariant")}</span>
                  <select
                    className="select min-h-11 w-full lg:min-h-9"
                    value={offers[level.id]!.subjectId ?? ""}
                    onChange={(e) => {
                      const subject = variants.find(
                        (s) => s.id === e.target.value,
                      );
                      setOffers({
                        ...offers,
                        [level.id]: {
                          baseName:
                            (subject?.baseName ?? "") ||
                            (subject?.name ?? name),
                          subjectId: subject?.id,
                        },
                      });
                    }}
                  >
                    <option value="">{t("newVariant")}</option>
                    {variants
                      .filter((s) => (s.levelId ?? "") === level.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="text-sm text-slate-600 sm:col-span-2">
                  {t("preview")}:{" "}
                  <strong>
                    {courseName(offers[level.id]!.baseName, level.prefix)}
                  </strong>
                </p>
              </div>
            )}
          </div>
        ))}
      </fieldset>
      <p className="muted text-sm">{t("archiveHelp")}</p>
      {save.error && (
        <p role="alert" className="text-sm text-red-600">
          {save.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary min-h-11 lg:min-h-9"
          disabled={save.isPending || !Object.keys(offers).length}
        >
          {t("save")}
        </button>
        <button
          className="btn-secondary min-h-11 lg:min-h-9"
          type="button"
          onClick={done}
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

export default function SubjectsPage() {
  const t = useTranslations("courseGroups");
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const groups = api.admin.courseGroups.useQuery();
  const levels = api.admin.subjectLevels.useQuery();
  const variants = api.admin.subjects.useQuery();
  const [editing, setEditing] = useState<string | null>(null);
  const [newLevel, setNewLevel] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const invalidate = () =>
    Promise.all([
      utils.admin.courseGroups.invalidate(),
      utils.admin.subjectLevels.invalidate(),
      utils.admin.subjects.invalidate(),
    ]);
  const reorder = api.admin.reorderCatalogue.useMutation({
    onSuccess: invalidate,
  });
  const updateLevel = api.admin.updateSubjectLevel.useMutation({
    onSuccess: invalidate,
  });
  const createLevel = api.admin.createSubjectLevel.useMutation({
    onSuccess: async () => {
      setNewLevel("");
      await invalidate();
    },
  });
  const removeLevel = api.admin.deleteSubjectLevel.useMutation({
    onSuccess: invalidate,
  });
  const importSubjects = api.admin.importSubjects.useMutation({
    onSuccess: async (result) => {
      setImportMessage(t("importResult", result));
      await invalidate();
    },
  });
  const move = (
    kind: "groups" | "levels",
    index: number,
    direction: number,
  ) => {
    const ids = (
      kind === "groups" ? (groups.data ?? []) : (levels.data ?? [])
    ).map((row) => row.id);
    [ids[index], ids[index + direction]] = [
      ids[index + direction]!,
      ids[index]!,
    ];
    reorder.mutate({ kind, ids });
  };
  const errors = [
    groups.error,
    levels.error,
    variants.error,
    reorder.error,
    updateLevel.error,
    createLevel.error,
    removeLevel.error,
    importSubjects.error,
  ].filter(Boolean);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {errors.map((error, index) => (
        <p key={index} role="alert" className="card p-4 text-red-600">
          {error!.message}
        </p>
      ))}
      {(groups.isLoading || levels.isLoading || variants.isLoading) && (
        <p role="status">{t("loading")}</p>
      )}
      <section
        className="card space-y-4 p-4 sm:p-5"
        aria-labelledby="levels-heading"
      >
        <div>
          <h2 id="levels-heading" className="section-title">
            {t("levels")}
          </h2>
          <p className="text-accent-700 mt-1 font-medium">{t("direction")}</p>
          <p className="muted mt-1 text-sm">{t("snapshotHelp")}</p>
        </div>
        <ol className="space-y-3">
          {(levels.data ?? []).map((level, index) => (
            <li
              key={`${level.id}-${level.name}-${level.prefix}`}
              className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3"
            >
              <span className="flex min-h-11 items-center font-semibold text-slate-500 lg:min-h-9">
                {index + 1}
              </span>
              <label className="min-w-28 flex-1">
                <span className="label">{t("levelName")}</span>
                <input
                  aria-label={t("levelLabel", { name: level.name })}
                  className="input min-h-11 w-full lg:min-h-9"
                  defaultValue={level.name}
                  readOnly={readOnly}
                  onBlur={(e) => {
                    if (
                      e.target.value.trim() &&
                      e.target.value.trim() !== level.name
                    )
                      updateLevel.mutate({
                        id: level.id,
                        name: e.target.value.trim(),
                      });
                  }}
                />
              </label>
              <label className="min-w-28 flex-1">
                <span className="label">{t("prefix")}</span>
                <input
                  aria-label={t("prefixLabel", { name: level.name })}
                  className="input min-h-11 w-full lg:min-h-9"
                  defaultValue={level.prefix}
                  readOnly={readOnly}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== level.prefix)
                      updateLevel.mutate({
                        id: level.id,
                        prefix: e.target.value.trim(),
                      });
                  }}
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-9">
                <input
                  type="checkbox"
                  checked={level.apScored}
                  disabled={readOnly || updateLevel.isPending}
                  onChange={(e) =>
                    updateLevel.mutate({
                      id: level.id,
                      apScored: e.target.checked,
                    })
                  }
                />
                {t("apScore")}
              </label>
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-secondary min-h-11 lg:min-h-9"
                    aria-label={t("moveUp", { name: level.name })}
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move("levels", index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="btn-secondary min-h-11 lg:min-h-9"
                    aria-label={t("moveDown", { name: level.name })}
                    disabled={
                      index === (levels.data?.length ?? 0) - 1 ||
                      reorder.isPending
                    }
                    onClick={() => move("levels", index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="btn-secondary min-h-11 lg:min-h-9"
                    disabled={removeLevel.isPending}
                    onClick={() => removeLevel.mutate({ id: level.id })}
                  >
                    {t("remove")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
        {!readOnly && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              createLevel.mutate({
                name: newLevel,
                rank:
                  Math.max(-1, ...(levels.data ?? []).map((l) => l.rank)) + 1,
              });
            }}
          >
            <label className="min-w-28 flex-1">
              <span className="label">{t("newLevel")}</span>
              <input
                className="input min-h-11 w-full lg:min-h-9"
                required
                maxLength={60}
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value)}
              />
            </label>
            <button
              className="btn-secondary min-h-11 lg:min-h-9"
              disabled={!newLevel.trim() || createLevel.isPending}
            >
              {t("addLevel")}
            </button>
          </form>
        )}
      </section>
      <section className="space-y-4" aria-labelledby="groups-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="groups-heading" className="section-title">
            {t("groups")}
          </h2>
          {!readOnly && (
            <button
              className="btn-primary min-h-11 lg:min-h-9"
              onClick={() => setEditing("new")}
            >
              {t("addGroup")}
            </button>
          )}
        </div>
        {editing === "new" && (
          <div className="card p-4 sm:p-5">
            <GroupEditor
              levels={levels.data ?? []}
              variants={variants.data ?? []}
              done={() => setEditing(null)}
              invalidate={invalidate}
            />
          </div>
        )}
        {(groups.data ?? []).map((group, index) => (
          <article className="card space-y-3 p-4 sm:p-5" key={group.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">{group.name}</h3>
              {!readOnly && (
                <div className="flex gap-2">
                  <button
                    className="btn-secondary min-h-11 lg:min-h-9"
                    aria-label={t("moveUp", { name: group.name })}
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move("groups", index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="btn-secondary min-h-11 lg:min-h-9"
                    aria-label={t("moveDown", { name: group.name })}
                    disabled={
                      index === (groups.data?.length ?? 0) - 1 ||
                      reorder.isPending
                    }
                    onClick={() => move("groups", index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="btn-secondary min-h-11 lg:min-h-9"
                    onClick={() => setEditing(group.id)}
                  >
                    {t("edit")}
                  </button>
                </div>
              )}
            </div>
            {editing === group.id ? (
              <GroupEditor
                group={group}
                levels={levels.data ?? []}
                variants={variants.data ?? []}
                done={() => setEditing(null)}
                invalidate={invalidate}
              />
            ) : (
              <ul className="flex flex-wrap gap-2">
                {group.subjects.map((subject) => (
                  <li
                    className={
                      subject.active ? "badge-slate" : "badge-slate opacity-60"
                    }
                    key={subject.id}
                  >
                    {subject.name}
                    {!subject.active && ` · ${t("inactive")}`}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
        {groups.data?.length === 0 && (
          <p className="card p-5 text-slate-500">{t("empty")}</p>
        )}
      </section>
      {!readOnly && (
        <section className="card space-y-3 p-4">
          <h2 className="section-title">{t("import")}</h2>
          <p className="muted text-sm">{t("importHelp")}</p>
          <label className="block">
            <span className="label">{t("csvFile")}</span>
            <input
              className="min-h-11 max-w-full"
              type="file"
              accept=".csv,text/csv"
              disabled={importSubjects.isPending}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const rows = (await file.text())
                  .split(/\r?\n/)
                  .map((line) => line.split(",").map((cell) => cell.trim()))
                  .filter(([name]) => name && name.toLowerCase() !== "name")
                  .map(([name, level]) => ({
                    name: name!,
                    level: level ?? undefined,
                  }));
                if (rows.length) importSubjects.mutate({ subjects: rows });
              }}
            />
          </label>
          {importMessage && <p role="status">{importMessage}</p>}
        </section>
      )}
    </div>
  );
}
