"use client";
import { InlineNotice } from "./ui/patterns";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { formText } from "~/lib/form-values";
export function SchoolCalendar() {
  const t = useTranslations("workflows");
  const approvals = useTranslations("approvals");
  const identity = api.account.me.useQuery();
  const canEdit = !identity.error && ["HEAD", "ADMIN", "COORDINATOR"].includes(identity.data?.role ?? "");
  const canApply = ["HEAD", "ADMIN"].includes(identity.data?.role ?? "");
  const calendar = api.student.calendar.useQuery();
  const save = api.student.setCalendarDay.useMutation({
    onSuccess: () => calendar.refetch(),
  });
  return (
    <section className="card space-y-4 p-6">
      <h2 className="section-title">{t("calendar")}</h2>
      <p className="muted text-sm">{t("calendarHelp")}</p>
      <p className="muted text-sm">{approvals("sensitiveHelp")}</p>
      <fieldset disabled={!canEdit || save.isPending} className="min-w-0">
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canEdit || save.isPending) return;
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
          <input className="input control-standard block lg:min-h-10" type="date" name="date" required />
        </label>
        <label>
          <span className="label">{t("note")}</span>
          <input className="input control-standard block lg:min-h-10" name="note" maxLength={300} />
        </label>
        {/* Match the input box, not its label, while retaining native checkbox artwork. */}
        <label className="control-standard flex items-center gap-2">
          <input type="checkbox" name="schoolDay" />
          {t("schoolDay")}
        </label>
        <button className="btn-primary control-standard" disabled={save.isPending}>
          {canApply ? t("save") : approvals("requestAdmin")}
        </button>
      </form>
      </fieldset>
      <div className="max-h-64 space-y-2 overflow-auto">
        {calendar.data?.map((d) => (
          <p key={d.date}>
            {d.date} · {d.isSchoolDay ? "✓" : "—"} · {d.note}
          </p>
        ))}
      </div>
      {save.error?.data?.approvalId && <InlineNotice tone="warning" announcement="status">{approvals("queuedBody")}</InlineNotice>}
      {(calendar.error ?? (save.error?.data?.approvalId ? null : save.error)) && (
        <p role="alert">{(calendar.error ?? (save.error?.data?.approvalId ? null : save.error))?.message}</p>
      )}
    </section>
  );
}
