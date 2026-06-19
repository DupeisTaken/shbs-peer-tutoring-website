"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export default function TuteesPage() {
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const [name, setName] = useState("");
  const create = api.admin.createTutee.useMutation({
    onSuccess: async () => {
      setName("");
      await utils.admin.tutees.invalidate();
    },
  });
  const update = api.admin.updateTutee.useMutation({
    onSuccess: () => utils.admin.tutees.invalidate(),
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Tutees</h1>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ englishName: name.trim() });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New tutee name"
          className="rounded border px-3 py-2"
        />
        <button className="rounded bg-indigo-600 px-4 py-2 font-semibold text-white">
          Add
        </button>
      </form>

      <ul className="mt-6 divide-y rounded-lg border bg-white">
        {(tutees.data ?? []).map((t) => (
          <li key={t.id} className="p-3">
            <input
              defaultValue={t.englishName}
              className="rounded border px-2 py-1"
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== t.englishName)
                  update.mutate({ id: t.id, englishName: e.target.value.trim() });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
