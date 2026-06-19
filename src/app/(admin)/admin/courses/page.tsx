"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

const TAGS = ["AP", "HONORS", "STANDARD"] as const;
type Tag = (typeof TAGS)[number];
const TAG_LABEL: Record<Tag, string> = { AP: "AP", HONORS: "Honors", STANDARD: "Standard" };

export default function CoursesPage() {
  const utils = api.useUtils();
  const courses = api.admin.courses.useQuery();
  const [name, setName] = useState("");
  const [tag, setTag] = useState<Tag>("STANDARD");

  const invalidate = () => utils.admin.courses.invalidate();
  const create = api.admin.createCourse.useMutation({
    onSuccess: async () => {
      setName("");
      await invalidate();
    },
  });
  const update = api.admin.updateCourse.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteCourse.useMutation({ onSuccess: invalidate });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Courses</h1>
        <p className="muted mt-1">
          Subjects tutees can request on the signup form. Inactive courses stay on existing
          records but disappear from the form.
        </p>
      </div>

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
        <select
          className="select w-36"
          value={tag}
          onChange={(e) => setTag(e.target.value as Tag)}
        >
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {TAG_LABEL[t]}
            </option>
          ))}
        </select>
        <button className="btn-primary">Add course</button>
      </form>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
      {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Tag</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(courses.data ?? []).map((c) => (
              <tr key={c.id}>
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
            {courses.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="text-slate-500">
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
