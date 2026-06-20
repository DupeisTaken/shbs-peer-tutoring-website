"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, hmToMin, minToHm } from "~/lib/time";

type Block = {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  reason: string | null;
};

function RoomCard({
  room,
  onChanged,
}: {
  room: { id: string; name: string; unavailabilities: Block[] };
  onChanged: () => Promise<unknown> | void;
}) {
  const t = useTranslations();
  const update = api.admin.updateRoom.useMutation({ onSuccess: () => onChanged() });
  const del = api.admin.deleteRoom.useMutation({ onSuccess: () => onChanged() });
  const addBlock = api.admin.createRoomUnavailability.useMutation({
    onSuccess: () => onChanged(),
  });
  const delBlock = api.admin.deleteRoomUnavailability.useMutation({
    onSuccess: () => onChanged(),
  });

  const [day, setDay] = useState(1);
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:00");
  const [reason, setReason] = useState("");

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <input
          defaultValue={room.name}
          className="input max-w-xs"
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value !== room.name)
              update.mutate({ id: room.id, name: e.target.value.trim() });
          }}
        />
        <button onClick={() => del.mutate({ id: room.id })} className="link-danger">
          {t("admin.rooms.deleteRoom")}
        </button>
      </div>
      {del.error && <p className="mt-1 text-sm text-red-600">{del.error.message}</p>}

      {/* Blackout periods */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          {t("admin.rooms.unavailablePeriods")}
        </p>
        {room.unavailabilities.length === 0 ? (
          <p className="muted mt-1">{t("admin.rooms.alwaysAvailable")}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {room.unavailabilities.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"
              >
                {DAY_NAMES[b.dayOfWeek]} {minToHm(b.startMin)}–{minToHm(b.endMin)}
                {b.reason ? ` · ${b.reason}` : ""}
                <button
                  onClick={() => delBlock.mutate({ id: b.id })}
                  className="text-red-600 hover:text-red-700"
                  aria-label={t("admin.rooms.removePeriod")}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addBlock.mutate({
              roomId: room.id,
              dayOfWeek: day,
              startMin: hmToMin(start),
              endMin: hmToMin(end),
              reason: reason.trim() || undefined,
            });
            setReason("");
          }}
        >
          <select
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="select w-28"
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </select>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="input w-28" />
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="input w-28" />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("admin.rooms.reasonPlaceholder")}
            className="input w-40"
          />
          <button className="btn-secondary btn-sm">{t("admin.rooms.block")}</button>
        </form>
        {addBlock.error && (
          <p className="mt-1 text-sm text-red-600">{addBlock.error.message}</p>
        )}
      </div>
    </div>
  );
}

export default function RoomsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const rooms = api.admin.rooms.useQuery();
  const invalidate = () => utils.admin.rooms.invalidate();
  const [name, setName] = useState("");
  const create = api.admin.createRoom.useMutation({
    onSuccess: async () => {
      setName("");
      await invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.rooms.title")}</h1>
        <p className="muted mt-1">{t("admin.rooms.description")}</p>
      </div>

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
          placeholder={t("admin.rooms.namePlaceholder")}
          className="input max-w-xs"
        />
        <button className="btn-primary">{t("admin.rooms.addRoom")}</button>
      </form>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}

      <div className="space-y-4">
        {(rooms.data ?? []).map((r) => (
          <RoomCard key={r.id} room={r} onChanged={invalidate} />
        ))}
        {rooms.data?.length === 0 && <p className="muted">{t("admin.rooms.empty")}</p>}
      </div>
    </div>
  );
}
