"use client";

import { useMemo, useState } from "react";

import { api } from "~/trpc/react";
import { DAY_NAMES, hmToMin, minToHm } from "~/lib/time";

type PairingForm = {
  id: string | null;
  tutorId: string;
  termId: string;
  roomId: string;
  timeSlotId: string;
  subject: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  tuteeIds: string[];
};

const EMPTY: PairingForm = {
  id: null,
  tutorId: "",
  termId: "",
  roomId: "",
  timeSlotId: "",
  subject: "",
  dayOfWeek: 1,
  startTime: "15:30",
  endTime: "16:30",
  tuteeIds: [],
};

export default function PairingsPage() {
  const utils = api.useUtils();
  const pairings = api.admin.pairings.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const tutees = api.admin.tutees.useQuery();
  const rooms = api.admin.rooms.useQuery();
  const terms = api.admin.terms.useQuery();
  const timeSlots = api.admin.timeSlots.useQuery();

  const invalidate = () => utils.admin.pairings.invalidate();
  const create = api.admin.createPairing.useMutation({ onSuccess: invalidate });
  const update = api.admin.updatePairing.useMutation({ onSuccess: invalidate });
  const del = api.admin.deletePairing.useMutation({ onSuccess: invalidate });

  const [form, setForm] = useState<PairingForm>(EMPTY);
  const editing = form.id !== null;
  const set = <K extends keyof PairingForm>(k: K, v: PairingForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const activeSlots = (timeSlots.data ?? []).filter((s) => s.active || s.id === form.timeSlotId);

  // Picking a reference slot conveniently pre-fills day/start/end (still editable).
  const pickSlot = (slotId: string) => {
    const slot = (timeSlots.data ?? []).find((s) => s.id === slotId);
    setForm((f) => ({
      ...f,
      timeSlotId: slotId,
      ...(slot
        ? {
            dayOfWeek: slot.dayOfWeek,
            startTime: minToHm(slot.startMin),
            endTime: minToHm(slot.endMin),
          }
        : {}),
    }));
  };

  const submit = () => {
    const base = {
      tutorId: form.tutorId,
      termId: form.termId,
      roomId: form.roomId || undefined,
      timeSlotId: form.timeSlotId || undefined,
      subject: form.subject,
      dayOfWeek: form.dayOfWeek,
      startMin: hmToMin(form.startTime),
      endMin: hmToMin(form.endTime),
      tuteeIds: form.tuteeIds,
    };
    if (form.id) {
      update.mutate(
        { ...base, id: form.id, roomId: form.roomId || null, timeSlotId: form.timeSlotId || null },
        { onSuccess: () => setForm(EMPTY) },
      );
    } else {
      create.mutate(base, { onSuccess: () => setForm(EMPTY) });
    }
  };

  const error = create.error ?? update.error ?? del.error;

  return (
    <div className="space-y-6">
      <h1 className="page-title">Pairings</h1>

      {/* Room x day grid */}
      <RoomGrid pairings={pairings.data ?? []} />

      {/* Create / edit form */}
      <section className="card p-5">
        <h2 className="font-semibold text-slate-900">
          {editing ? "Edit pairing" : "New pairing"}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Tutor"
            value={form.tutorId}
            onChange={(v) => set("tutorId", v)}
            options={(tutors.data ?? []).map((t) => ({ value: t.id, label: t.englishName }))}
          />
          <Select
            label="Term"
            value={form.termId}
            onChange={(v) => set("termId", v)}
            options={(terms.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
          />
          <Select
            label="Room (optional)"
            value={form.roomId}
            onChange={(v) => set("roomId", v)}
            options={[
              { value: "", label: "— none —" },
              ...(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <Select
            label="Time slot (optional, reference)"
            value={form.timeSlotId}
            onChange={pickSlot}
            options={[
              { value: "", label: "— none —" },
              ...activeSlots.map((s) => ({
                value: s.id,
                label: `${s.label} · ${DAY_NAMES[s.dayOfWeek]} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
              })),
            ]}
          />
          <label className="space-y-1 text-sm">
            <span className="label">Subject</span>
            <input
              value={form.subject}
              onChange={(e) => set("subject", e.target.value)}
              className="input"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="label">Day</span>
            <select
              value={form.dayOfWeek}
              onChange={(e) => set("dayOfWeek", Number(e.target.value))}
              className="select"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {DAY_NAMES[d]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex-1 space-y-1 text-sm">
              <span className="label">Start</span>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
                className="input"
              />
            </label>
            <label className="flex-1 space-y-1 text-sm">
              <span className="label">End</span>
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                className="input"
              />
            </label>
          </div>
        </div>

        <fieldset className="mt-3">
          <legend className="label">Tutees</legend>
          <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {(tutees.data ?? []).map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.tuteeIds.includes(t.id)}
                  onChange={(e) =>
                    set(
                      "tuteeIds",
                      e.target.checked
                        ? [...form.tuteeIds, t.id]
                        : form.tuteeIds.filter((id) => id !== t.id),
                    )
                  }
                />
                {t.englishName}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!form.tutorId || !form.termId || !form.subject}
            className="btn-primary"
          >
            {editing ? "Save changes" : "Create pairing"}
          </button>
          {editing && (
            <button onClick={() => setForm(EMPTY)} className="link text-sm">
              Cancel
            </button>
          )}
          {error && <span className="text-sm text-red-600">{error.message}</span>}
        </div>
      </section>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Tutor</th>
              <th>When</th>
              <th>Slot</th>
              <th>Room</th>
              <th>Tutees</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(pairings.data ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.subject}</td>
                <td>{p.tutor.englishName}</td>
                <td>
                  {DAY_NAMES[p.dayOfWeek]} {minToHm(p.startMin)}–{minToHm(p.endMin)}
                </td>
                <td className="text-slate-500">{p.timeSlot?.label ?? "—"}</td>
                <td>{p.room?.name ?? "—"}</td>
                <td>{p.tutees.map((t) => t.tutee.englishName).join(", ")}</td>
                <td className="text-right whitespace-nowrap">
                  <button
                    onClick={() =>
                      setForm({
                        id: p.id,
                        tutorId: p.tutorId,
                        termId: p.termId,
                        roomId: p.roomId ?? "",
                        timeSlotId: p.timeSlotId ?? "",
                        subject: p.subject,
                        dayOfWeek: p.dayOfWeek,
                        startTime: minToHm(p.startMin),
                        endTime: minToHm(p.endMin),
                        tuteeIds: p.tutees.map((t) => t.tuteeId),
                      })
                    }
                    className="link mr-3"
                  >
                    Edit
                  </button>
                  <button onClick={() => del.mutate({ id: p.id })} className="link-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select">
        {!options.some((o) => o.value === "") && <option value="">—</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type GridPairing = {
  id: string;
  subject: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  roomId: string | null;
  room: { name: string } | null;
  tutor: { englishName: string };
};

function RoomGrid({ pairings }: { pairings: GridPairing[] }) {
  const days = [1, 2, 3, 4, 5];
  const rooms = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pairings) {
      if (p.room) map.set(p.roomId!, p.room.name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [pairings]);

  const cell = (roomId: string | null, day: number) =>
    pairings.filter((p) => p.roomId === roomId && p.dayOfWeek === day);

  return (
    <section className="card overflow-x-auto p-4">
      <h2 className="font-semibold text-slate-900">Room grid (Mon–Fri)</h2>
      <table className="mt-2 w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="border border-slate-200 p-2 text-left">Room</th>
            {days.map((d) => (
              <th key={d} className="border border-slate-200 p-2">
                {DAY_NAMES[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rooms.map(([roomId, roomName]) => (
            <tr key={roomId}>
              <td className="border border-slate-200 p-2 font-medium">{roomName}</td>
              {days.map((d) => (
                <td key={d} className="border border-slate-200 p-2 align-top">
                  {cell(roomId, d).map((p) => (
                    <div key={p.id} className="mb-1">
                      {minToHm(p.startMin)} {p.subject} ({p.tutor.englishName})
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
          {pairings.some((p) => !p.roomId) && (
            <tr>
              <td className="border border-slate-200 p-2 font-medium text-slate-400">
                No room
              </td>
              {days.map((d) => (
                <td key={d} className="border border-slate-200 p-2 align-top">
                  {cell(null, d).map((p) => (
                    <div key={p.id} className="mb-1">
                      {minToHm(p.startMin)} {p.subject} ({p.tutor.englishName})
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
