"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export default function RoomsPage() {
  const utils = api.useUtils();
  const rooms = api.admin.rooms.useQuery();
  const [name, setName] = useState("");
  const create = api.admin.createRoom.useMutation({
    onSuccess: async () => {
      setName("");
      await utils.admin.rooms.invalidate();
    },
  });
  const update = api.admin.updateRoom.useMutation({
    onSuccess: () => utils.admin.rooms.invalidate(),
  });
  const del = api.admin.deleteRoom.useMutation({
    onSuccess: () => utils.admin.rooms.invalidate(),
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Rooms</h1>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim() });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New room name"
          className="rounded border px-3 py-2"
        />
        <button className="rounded bg-indigo-600 px-4 py-2 font-semibold text-white">
          Add
        </button>
      </form>
      {create.error && <p className="mt-1 text-sm text-red-600">{create.error.message}</p>}

      <ul className="mt-6 divide-y rounded-lg border bg-white">
        {(rooms.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between p-3">
            <input
              defaultValue={r.name}
              className="rounded border px-2 py-1"
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== r.name)
                  update.mutate({ id: r.id, name: e.target.value.trim() });
              }}
            />
            <button
              onClick={() => del.mutate({ id: r.id })}
              className="text-sm text-red-600 hover:underline"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {del.error && <p className="mt-2 text-sm text-red-600">{del.error.message}</p>}
    </div>
  );
}
