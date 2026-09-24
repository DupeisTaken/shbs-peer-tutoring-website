"use client";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { formText } from "~/lib/form-values";
export function SchoolCalendar() {
  const t = useTranslations("workflows");
  const calendar = api.student.calendar.useQuery();
  const save = api.student.setCalendarDay.useMutation({
    onSuccess: () => calendar.refetch(),
  });
  return (
    <section className="card space-y-4 p-6">
      <h2 className="section-title">{t("calendar")}</h2>
      <p className="muted text-sm">{t("calendarHelp")}</p>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.mutate({
            date: formText(f, "date"),
            isSchoolDay: f.has("schoolDay"),
            note: formText(f, "note"),
          });
        }}
      >
        <label>
          <span className="label">{t("date")}</span>
          <input className="input block" type="date" name="date" required />
        </label>
        <label>
          <span className="label">{t("note")}</span>
          <input className="input block" name="note" maxLength={300} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="schoolDay" />
          {t("schoolDay")}
        </label>
        <button className="btn-primary" disabled={save.isPending}>
          {t("save")}
        </button>
      </form>
      <div className="max-h-64 space-y-2 overflow-auto">
        {calendar.data?.map((d) => (
          <p key={d.date}>
            {d.date} · {d.isSchoolDay ? "✓" : "—"} · {d.note}
          </p>
        ))}
      </div>
      {(calendar.error ?? save.error) && (
        <p role="alert">{(calendar.error ?? save.error)?.message}</p>
      )}
    </section>
  );
}
