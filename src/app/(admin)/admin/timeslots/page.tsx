"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, hmToMin, minToHm } from "~/lib/time";

const EMPTY = { label: "", dayOfWeek: 1, startTime: "15:30", endTime: "16:30" };

export default function TimeSlotsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const slots = api.admin.timeSlots.useQuery();
  const [form, setForm] = useState(EMPTY);

  const invalidate = () => utils.admin.timeSlots.invalidate();
  const create = api.admin.createTimeSlot.useMutation({
    onSuccess: async () => {
      setForm(EMPTY);
      await invalidate();
    },
  });
  const update = api.admin.updateTimeSlot.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteTimeSlot.useMutation({ onSuccess: invalidate });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.timeslots.title")}</h1>
        <p className="muted mt-1">{t("admin.timeslots.description")}</p>
      </div>

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
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder={t("admin.timeslots.labelPlaceholder")}
            className="input"
          />
        </label>
        <label className="space-y-1">
          <span className="label">{t("admin.timeslots.day")}</span>
          <select
            value={form.dayOfWeek}
            onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))}
            className="select"
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
            onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
            className="input"
          />
        </label>
        <label className="space-y-1">
          <span className="label">{t("admin.timeslots.end")}</span>
          <input
            type="time"
            value={form.endTime}
            onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
            className="input"
          />
        </label>
        <button className="btn-primary">{t("admin.timeslots.addSlot")}</button>
      </form>
      {(create.error ?? del.error) && (
        <p className="text-sm text-red-600">{(create.error ?? del.error)?.message}</p>
      )}

      <div className="card overflow-hidden">
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
              <tr key={s.id}>
                <td>
                  <input
                    defaultValue={s.label}
                    className="input max-w-[12rem]"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== s.label)
                        update.mutate({
                          id: s.id,
                          label: v,
                          dayOfWeek: s.dayOfWeek,
                          startMin: s.startMin,
                          endMin: s.endMin,
                          active: s.active,
                        });
                    }}
                  />
                </td>
                <td>{DAY_NAMES[s.dayOfWeek]}</td>
                <td>
                  {minToHm(s.startMin)}–{minToHm(s.endMin)}
                </td>
                <td>
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
                </td>
                <td className="text-right">
                  <button className="link-danger" onClick={() => del.mutate({ id: s.id })}>
                    {t("admin.timeslots.delete")}
                  </button>
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
