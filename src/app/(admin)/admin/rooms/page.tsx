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
    <div className="space-y-6">
      <h1 className="page-title">Rooms</h1>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim() });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New room name"
          className="input max-w-xs"
        />
        <button className="btn-primary">Add</button>
      </form>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}

      <div className="card overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {(rooms.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <input
                defaultValue={r.name}
                className="input max-w-xs"
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== r.name)
                    update.mutate({ id: r.id, name: e.target.value.trim() });
                }}
              />
              <button onClick={() => del.mutate({ id: r.id })} className="link-danger">
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
      {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}
    </div>
  );
}
