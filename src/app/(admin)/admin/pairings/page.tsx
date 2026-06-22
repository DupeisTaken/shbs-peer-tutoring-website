"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { RoomGrid } from "~/app/_components/room-grid";

type PairingForm = {
  id: string | null;
  tutorId: string;
  roomId: string;
  timeSlotId: string;
  subject: string;
  tuteeIds: string[];
};

const EMPTY: PairingForm = {
  id: null,
  tutorId: "",
  roomId: "",
  timeSlotId: "",
  subject: "",
  tuteeIds: [],
};

export default function PairingsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const pairings = api.admin.pairings.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const tutees = api.admin.tutees.useQuery();
  const rooms = api.admin.rooms.useQuery(undefined, { staleTime: REFERENCE_STALE_TIME });
  const timeSlots = api.admin.timeSlots.useQuery(undefined, { staleTime: REFERENCE_STALE_TIME });

  const invalidate = () => utils.admin.pairings.invalidate();
  const create = api.admin.createPairing.useMutation({ onSuccess: invalidate });
  const update = api.admin.updatePairing.useMutation({ onSuccess: invalidate });
  const del = api.admin.deletePairing.useMutation({ onSuccess: invalidate });

  const [form, setForm] = useState<PairingForm>(EMPTY);
  const editing = form.id !== null;
  const set = <K extends keyof PairingForm>(k: K, v: PairingForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const activeSlots = (timeSlots.data ?? []).filter(
    (s) => s.active || s.id === form.timeSlotId,
  );

  const submit = () => {
    const base = {
      tutorId: form.tutorId,
      roomId: form.roomId || undefined,
      timeSlotId: form.timeSlotId,
      subject: form.subject,
      tuteeIds: form.tuteeIds,
    };
    if (form.id) {
      update.mutate(
        { ...base, id: form.id, roomId: form.roomId || null },
        { onSuccess: () => setForm(EMPTY) },
      );
    } else {
      create.mutate(base, { onSuccess: () => setForm(EMPTY) });
    }
  };

  const error = create.error ?? update.error ?? del.error;

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("admin.pairings.title")}</h1>

      {/* Slot × room schedule grid */}
      <section>
        <h2 className="section-title mb-2">{t("admin.pairings.roomSchedule")}</h2>
        <RoomGrid
          rooms={(rooms.data ?? []).map((r) => ({ id: r.id, name: r.name }))}
          slots={(timeSlots.data ?? []).filter((s) => s.active)}
          pairings={pairings.data ?? []}
          blocks={(rooms.data ?? []).flatMap((r) => r.unavailabilities)}
        />
      </section>

      {/* Create / edit form */}
      <section className="card p-5">
        <h2 className="section-title">
          {editing ? t("admin.pairings.editPairing") : t("admin.pairings.newPairing")}
        </h2>
        <p className="muted mt-1">{t("admin.pairings.slotHelp")}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={t("admin.pairings.tutor")}
            value={form.tutorId}
            onChange={(v) => set("tutorId", v)}
            options={(tutors.data ?? []).map((t) => ({ value: t.id, label: t.englishName }))}
          />
          <Select
            label={t("admin.pairings.roomOptional")}
            value={form.roomId}
            onChange={(v) => set("roomId", v)}
            options={[
              { value: "", label: t("admin.pairings.none") },
              ...(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <Select
            label={t("admin.pairings.timeSlot")}
            value={form.timeSlotId}
            onChange={(v) => set("timeSlotId", v)}
            options={[
              { value: "", label: t("admin.pairings.selectSlot") },
              ...activeSlots.map((s) => ({
                value: s.id,
                label: `${s.label} · ${DAY_NAMES[s.dayOfWeek]} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
              })),
            ]}
          />
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="label">{t("admin.pairings.subject")}</span>
            <input
              value={form.subject}
              onChange={(e) => set("subject", e.target.value)}
              placeholder={t("admin.pairings.subjectPlaceholder")}
              className="input"
            />
          </label>
        </div>

        <fieldset className="mt-3">
          <legend className="label">{t("admin.pairings.tutees")}</legend>
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
            disabled={!form.tutorId || !form.subject || !form.timeSlotId}
            className="btn-primary"
          >
            {editing ? t("admin.pairings.saveChanges") : t("admin.pairings.createPairing")}
          </button>
          {editing && (
            <button onClick={() => setForm(EMPTY)} className="link text-sm">
              {t("admin.pairings.cancel")}
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
              <th>{t("admin.pairings.colTutor")}</th>
              <th>{t("admin.pairings.colSubject")}</th>
              <th>{t("admin.pairings.colWhen")}</th>
              <th>{t("admin.pairings.colSlot")}</th>
              <th>{t("admin.pairings.colRoom")}</th>
              <th>{t("admin.pairings.colTutees")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(pairings.data ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.tutor.englishName}</td>
                <td>{p.subject}</td>
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
                        roomId: p.roomId ?? "",
                        timeSlotId: p.timeSlotId ?? "",
                        subject: p.subject,
                        tuteeIds: p.tutees.map((t) => t.tuteeId),
                      })
                    }
                    className="link mr-3"
                  >
                    {t("admin.pairings.edit")}
                  </button>
                  <button onClick={() => del.mutate({ id: p.id })} className="link-danger">
                    {t("admin.pairings.delete")}
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
