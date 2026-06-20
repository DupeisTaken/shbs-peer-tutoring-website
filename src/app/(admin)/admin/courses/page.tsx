"use client";

import { useRef, useState } from "react";

import { api } from "~/trpc/react";

const TAGS = ["AP", "HONORS", "STANDARD"] as const;
type Tag = (typeof TAGS)[number];
const TAG_LABEL: Record<Tag, string> = { AP: "AP", HONORS: "Honors", STANDARD: "Standard" };

/** Normalise a free-text tag from a CSV cell to one of the known tags. */
function normaliseTag(raw: string | undefined): Tag {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "AP") return "AP";
  if (v.startsWith("HON")) return "HONORS";
  return "STANDARD";
}

/** Parse a simple "name,tag" CSV (optional header row) into course rows. */
function parseCsv(text: string): { name: string; tag: Tag }[] {
  const rows: { name: string; tag: Tag }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [name, tag] = trimmed.split(",").map((s) => s.trim());
    if (!name || name.toLowerCase() === "name") continue; // skip header / blank
    rows.push({ name, tag: normaliseTag(tag) });
  }
  return rows;
}

export default function CoursesPage() {
  const utils = api.useUtils();
  const courses = api.admin.courses.useQuery();
  const [name, setName] = useState("");
  const [tag, setTag] = useState<Tag>("STANDARD");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchTag, setBatchTag] = useState<Tag>("STANDARD");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidate = () => utils.admin.courses.invalidate();
  const create = api.admin.createCourse.useMutation({
    onSuccess: async () => {
      setName("");
      await invalidate();
    },
  });
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

  const list = courses.data ?? [];
  const allSelected = list.length > 0 && selected.size === list.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(list.map((c) => c.id)));

  const onCsv = async (file: File) => {
    const rows = parseCsv(await file.text());
    if (rows.length === 0) {
      setImportMsg("No course rows found in that file.");
      return;
    }
    importCourses.mutate({ courses: rows });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Courses</h1>
        <p className="muted mt-1">
          Subjects tutees can request on the signup form. Inactive courses stay on existing
          records but disappear from the form.
        </p>
      </div>

      {/* Add one + CSV import */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ name: name.trim(), tag });
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New course name"
            className="input max-w-xs"
          />
          <select className="select w-36" value={tag} onChange={(e) => setTag(e.target.value as Tag)}>
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {TAG_LABEL[t]}
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
        CSV format: one course per line as <code>name,tag</code> (tag = AP / Honors / Standard;
        a header row is optional).
      </p>
      {importMsg && <p className="text-sm text-green-600">{importMsg}</p>}
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
      {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}

      {/* Batch toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <span className="text-sm font-medium text-indigo-800">{selected.size} selected</span>
          <select
            className="select w-36"
            value={batchTag}
            onChange={(e) => setBatchTag(e.target.value as Tag)}
          >
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {TAG_LABEL[t]}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary btn-sm"
            disabled={batch.isPending}
            onClick={() => batch.mutate({ ids: [...selected], tag: batchTag })}
          >
            Set tag
          </button>
          <button
            className="btn-secondary btn-sm"
            disabled={batch.isPending}
            onClick={() => batch.mutate({ ids: [...selected], active: true })}
          >
            Activate
          </button>
          <button
            className="btn-secondary btn-sm"
            disabled={batch.isPending}
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
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>Name</th>
              <th>Tag</th>
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
                        update.mutate({ id: c.id, name: v, tag: c.tag, active: c.active });
                    }}
                  />
                </td>
                <td>
                  <select
                    className="select w-32"
                    value={c.tag}
                    onChange={(e) =>
                      update.mutate({
                        id: c.id,
                        name: c.name,
                        tag: e.target.value as Tag,
                        active: c.active,
                      })
                    }
                  >
                    {TAGS.map((t) => (
                      <option key={t} value={t}>
                        {TAG_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={c.active}
                    onChange={(e) =>
                      update.mutate({
                        id: c.id,
                        name: c.name,
                        tag: c.tag,
                        active: e.target.checked,
                      })
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
