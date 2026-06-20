"use client";

import { useRef, useState } from "react";

import { api } from "~/trpc/react";

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

export default function CoursesPage() {
  const utils = api.useUtils();
  const courses = api.admin.courses.useQuery();
  const levels = api.admin.courseLevels.useQuery();

  const invalidate = () =>
    Promise.all([utils.admin.courses.invalidate(), utils.admin.courseLevels.invalidate()]);

  const create = api.admin.createCourse.useMutation({ onSuccess: invalidate });
  const update = api.admin.updateCourse.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteCourse.useMutation({ onSuccess: invalidate });
  const batch = api.admin.batchUpdateCourses.useMutation({
    onSuccess: async () => {
      setSelected(new Set());
      await invalidate();
    },
  });
  const importCourses = api.admin.importCourses.useMutation({
    onSuccess: async (r) => {
      setImportMsg(`Imported ${r.created} of ${r.received} (duplicates skipped).`);
      if (fileRef.current) fileRef.current.value = "";
      await invalidate();
    },
  });
  const createLevel = api.admin.createCourseLevel.useMutation({ onSuccess: invalidate });
  const updateLevel = api.admin.updateCourseLevel.useMutation({ onSuccess: invalidate });
  const delLevel = api.admin.deleteCourseLevel.useMutation({ onSuccess: invalidate });

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
      setImportMsg("No course rows found in that file.");
      return;
    }
    importCourses.mutate({ courses: rows });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Courses &amp; levels</h1>
        <p className="muted mt-1">
          Subjects tutees can request. Levels are an admin-managed catalogue; a level marked
          “AP-scored” lets its courses carry an AP exam score on tutor applications.
        </p>
      </div>

      {/* Level catalogue */}
      <section className="card p-5">
        <h2 className="font-semibold text-slate-900">Level catalogue</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {levelList.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1"
            >
              <input
                defaultValue={l.name}
                className="input h-8 w-28"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== l.name) updateLevel.mutate({ id: l.id, name: v });
                }}
              />
              <input
                type="number"
                defaultValue={l.rank}
                className="input h-8 w-14"
                title="rank"
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== l.rank) updateLevel.mutate({ id: l.id, rank: v });
                }}
              />
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={l.apScored}
                  onChange={(e) => updateLevel.mutate({ id: l.id, apScored: e.target.checked })}
                />
                AP-scored
              </label>
              <button
                className="link-danger text-xs"
                onClick={() => {
                  if (confirm(`Delete level "${l.name}"? Courses keep existing but lose it.`))
                    delLevel.mutate({ id: l.id });
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <form
            className="flex items-center gap-1"
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
              placeholder="New level"
              className="input h-8 w-28"
            />
            <button className="btn-secondary btn-sm">Add</button>
          </form>
        </div>
      </section>

      {/* Add a course + CSV import */}
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
            placeholder="New course name"
            className="input max-w-xs"
          />
          <select className="select w-40" value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            <option value="">— no level —</option>
            {levelList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button className="btn-primary">Add course</button>
        </form>

        <label className="btn-secondary btn-sm cursor-pointer">
          {importCourses.isPending ? "Importing…" : "Upload CSV"}
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
        CSV format: one course per line as <code>name,level</code> (level matched by name; a
        header row is optional).
      </p>
      {importMsg && <p className="text-sm text-green-600">{importMsg}</p>}
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
      {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}

      {/* Batch toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <span className="text-sm font-medium text-indigo-800">{selected.size} selected</span>
          <select
            className="select w-40"
            value={batchLevel}
            onChange={(e) => setBatchLevel(e.target.value)}
          >
            <option value="">— no level —</option>
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
            Set level
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => batch.mutate({ ids: [...selected], active: true })}
          >
            Activate
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => batch.mutate({ ids: [...selected], active: false })}
          >
            Deactivate
          </button>
          <button className="link text-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(list.map((c) => c.id)))
                  }
                />
              </th>
              <th>Name</th>
              <th>Level</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                </td>
                <td>
                  <input
                    defaultValue={c.name}
                    className="input max-w-xs"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== c.name)
                        update.mutate({ id: c.id, name: v, active: c.active });
                    }}
                  />
                </td>
                <td>
                  <select
                    className="select w-40"
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
                    <option value="">—</option>
                    {levelList.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={c.active}
                    onChange={(e) =>
                      update.mutate({ id: c.id, name: c.name, active: e.target.checked })
                    }
                  />
                </td>
                <td className="text-right">
                  <button className="link-danger" onClick={() => del.mutate({ id: c.id })}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  No courses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
