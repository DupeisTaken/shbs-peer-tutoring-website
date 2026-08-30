"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, hmToMin, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { useReadOnly } from "~/app/_components/read-only";

const EMPTY = { label: "", dayOfWeek: 1, startTime: "15:30", endTime: "16:30" };

type SlotDraft = typeof EMPTY & { id: string; active: boolean };

export default function TimeSlotsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const slots = api.admin.timeSlots.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<SlotDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const invalidate = () =>
    Promise.all([
      utils.admin.timeSlots.invalidate(),
      utils.admin.pairings.invalidate(),
      utils.tutor.myPairings.invalidate(),
      utils.tutor.schedule.invalidate(),
    ]);
  const create = api.admin.createTimeSlot.useMutation({
    onSuccess: async () => {
      setForm(EMPTY);
      await invalidate();
    },
  });
  const update = api.admin.updateTimeSlot.useMutation({
    onSuccess: async (result) => {
      setEditing(null);
      setNotice(
        t("admin.timeslots.updated", {
          pairings: result.updatedPairings,
          sessions: result.updatedSessions,
        }),
      );
      await invalidate();
    },
  });
  const del = api.admin.deleteTimeSlot.useMutation({ onSuccess: invalidate });
  const editingIsValid =
    editing !== null &&
    editing.label.trim().length > 0 &&
    hmToMin(editing.endTime) > hmToMin(editing.startTime);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.timeslots.title")}</h1>
        <p className="muted mt-1">{t("admin.timeslots.description")}</p>
      </div>

      {!readOnly && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-semibold">
            {t("admin.timeslots.propagationTitle")}
          </p>
          <p className="mt-0.5 text-sky-800">
            {t("admin.timeslots.propagationNote")}
          </p>
        </div>
      )}

      {!readOnly && (
        <form
          className="card flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.label.trim()) return;
            create.mutate({
              label: form.label.trim(),
              dayOfWeek: form.dayOfWeek,
              startMin: hmToMin(form.startTime),
              endMin: hmToMin(form.endTime),
            });
          }}
        >
          <label className="space-y-1">
            <span className="label">{t("admin.timeslots.label")}</span>
            <input
              value={form.label}
              onChange={(e) =>
                setForm((f) => ({ ...f, label: e.target.value }))
              }
              placeholder={t("admin.timeslots.labelPlaceholder")}
              className="input field-auto min-w-44"
            />
          </label>
          <label className="space-y-1">
            <span className="label">{t("admin.timeslots.day")}</span>
            <select
              value={form.dayOfWeek}
              onChange={(e) =>
                setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))
              }
              className="select field-auto min-w-32"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {DAY_NAMES[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="label">{t("admin.timeslots.start")}</span>
            <input
              type="time"
              value={form.startTime}
              onChange={(e) =>
                setForm((f) => ({ ...f, startTime: e.target.value }))
              }
              className="input field-auto min-w-28"
            />
          </label>
          <label className="space-y-1">
            <span className="label">{t("admin.timeslots.end")}</span>
            <input
              type="time"
              value={form.endTime}
              onChange={(e) =>
                setForm((f) => ({ ...f, endTime: e.target.value }))
              }
              className="input field-auto min-w-28"
            />
          </label>
          <button
            className="btn-primary"
            disabled={!form.label.trim() || create.isPending}
          >
            {t("admin.timeslots.addSlot")}
          </button>
        </form>
      )}
      {!readOnly && (create.error ?? update.error ?? del.error) && (
        <p className="text-sm text-red-600">
          {(create.error ?? update.error ?? del.error)?.message}
        </p>
      )}
      {!readOnly && notice && !update.error && (
        <p role="status" className="text-sm font-medium text-emerald-700">
          {notice}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.timeslots.colLabel")}</th>
              <th>{t("admin.timeslots.colDay")}</th>
              <th>{t("admin.timeslots.colTime")}</th>
              <th>{t("admin.timeslots.colActive")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(slots.data ?? []).map((s) => (
              <tr
                key={s.id}
                className={editing?.id === s.id ? "bg-sky-50/70" : undefined}
              >
                <td>
                  {readOnly ? (
                    <span>{s.label}</span>
                  ) : editing?.id === s.id ? (
                    <input
                      value={editing.label}
                      aria-label={t("admin.timeslots.label")}
                      className="input field-auto min-w-40"
                      onChange={(event) =>
                        setEditing((draft) =>
                          draft
                            ? { ...draft, label: event.target.value }
                            : draft,
                        )
                      }
                    />
                  ) : (
                    <span className="font-medium text-slate-900">
                      {s.label}
                    </span>
                  )}
                </td>
                <td>
                  {editing?.id === s.id ? (
                    <select
                      value={editing.dayOfWeek}
                      aria-label={t("admin.timeslots.day")}
                      className="select field-auto min-w-28"
                      onChange={(event) =>
                        setEditing((draft) =>
                          draft
                            ? {
                                ...draft,
                                dayOfWeek: Number(event.target.value),
                              }
                            : draft,
                        )
                      }
                    >
                      {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                        <option key={day} value={day}>
                          {DAY_NAMES[day]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    DAY_NAMES[s.dayOfWeek]
                  )}
                </td>
                <td>
                  {editing?.id === s.id ? (
                    <div className="flex min-w-64 items-center gap-2">
                      <input
                        type="time"
                        value={editing.startTime}
                        aria-label={t("admin.timeslots.start")}
                        className="input field-auto min-w-28"
                        onChange={(event) =>
                          setEditing((draft) =>
                            draft
                              ? { ...draft, startTime: event.target.value }
                              : draft,
                          )
                        }
                      />
                      <span aria-hidden className="text-slate-400">
                        –
                      </span>
                      <input
                        type="time"
                        value={editing.endTime}
                        aria-label={t("admin.timeslots.end")}
                        className="input field-auto min-w-28"
                        onChange={(event) =>
                          setEditing((draft) =>
                            draft
                              ? { ...draft, endTime: event.target.value }
                              : draft,
                          )
                        }
                      />
                    </div>
                  ) : (
                    <span className="font-mono text-slate-700">
                      {minToHm(s.startMin)}–{minToHm(s.endMin)}
                    </span>
                  )}
                </td>
                <td>
                  {readOnly ? (
                    <span>{s.active ? "✓" : "✗"}</span>
                  ) : editing?.id === s.id ? (
                    <input
                      type="checkbox"
                      checked={editing.active}
                      aria-label={t("admin.timeslots.colActive")}
                      onChange={(event) =>
                        setEditing((draft) =>
                          draft
                            ? { ...draft, active: event.target.checked }
                            : draft,
                        )
                      }
                    />
                  ) : (
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) =>
                        update.mutate({
                          id: s.id,
                          label: s.label,
                          dayOfWeek: s.dayOfWeek,
                          startMin: s.startMin,
                          endMin: s.endMin,
                          active: e.target.checked,
                        })
                      }
                    />
                  )}
                </td>
                <td>
                  {!readOnly && editing?.id === s.id ? (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!editingIsValid || update.isPending}
                        onClick={() => {
                          if (!editingIsValid) return;
                          setNotice(null);
                          update.mutate({
                            id: editing.id,
                            label: editing.label.trim(),
                            dayOfWeek: editing.dayOfWeek,
                            startMin: hmToMin(editing.startTime),
                            endMin: hmToMin(editing.endTime),
                            active: editing.active,
                          });
                        }}
                      >
                        {update.isPending
                          ? t("admin.timeslots.saving")
                          : t("admin.timeslots.save")}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={update.isPending}
                        onClick={() => {
                          update.reset();
                          setEditing(null);
                        }}
                      >
                        {t("admin.timeslots.cancel")}
                      </button>
                    </div>
                  ) : !readOnly ? (
                    <div className="flex justify-end gap-3 whitespace-nowrap">
                      <button
                        type="button"
                        className="link"
                        disabled={update.isPending}
                        onClick={() => {
                          update.reset();
                          setNotice(null);
                          setEditing({
                            id: s.id,
                            label: s.label,
                            dayOfWeek: s.dayOfWeek,
                            startTime: minToHm(s.startMin),
                            endTime: minToHm(s.endMin),
                            active: s.active,
                          });
                        }}
                      >
                        {t("admin.timeslots.edit")}
                      </button>
                      <button
                        type="button"
                        className="link-danger"
                        disabled={del.isPending || update.isPending}
                        onClick={() => del.mutate({ id: s.id })}
                      >
                        {t("admin.timeslots.delete")}
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {slots.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  {t("admin.timeslots.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
