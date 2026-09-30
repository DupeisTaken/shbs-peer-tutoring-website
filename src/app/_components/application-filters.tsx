"use client";

import { useTranslations } from "next-intl";
import {
  emptyApplicationFilters,
  type ApplicationFilters as Filters,
} from "~/lib/application-filters";

export function ApplicationFilters({
  value,
  onChange,
  subjects,
  count,
  total,
}: {
  value: Filters;
  onChange: (value: Filters) => void;
  subjects: { id: string; label: string }[];
  count: number;
  total: number;
}) {
  const t = useTranslations("admin.applications");
  const allT = useTranslations();
  const update = (field: keyof Filters, next: string) =>
    onChange({ ...value, [field]: next });
  const active = Object.values(value).some(Boolean);
  return (
    <section className="card space-y-3 p-4" aria-label={t("filters.heading")}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0">
          <span className="label">{t("filters.search")}</span>
          <input
            type="search"
            className="input min-h-11 w-full lg:min-h-10"
            value={value.search}
            onChange={(event) => update("search", event.target.value)}
          />
        </label>
        <label className="min-w-0">
          <span className="label">{t("filters.status")}</span>
          <select
            className="select min-h-11 w-full lg:min-h-10"
            value={value.status}
            onChange={(event) => update("status", event.target.value)}
          >
            <option value="">{t("filters.allStatuses")}</option>
            {(
              [
                "PENDING",
                "INTERVIEW",
                "ACCEPTED",
                "REJECTED",
                "RECALLED",
              ] as const
            ).map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="label">{t("filters.type")}</span>
          <select
            className="select min-h-11 w-full lg:min-h-10"
            value={value.type}
            onChange={(event) => update("type", event.target.value)}
          >
            <option value="">{t("filters.allTypes")}</option>
            {(["INITIAL", "ADDITIONAL_SUBJECT", "HIGHER_LEVEL"] as const).map(
              (type) => (
                <option key={type} value={type}>
                  {allT(`qualificationRequests.${type}`)}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="min-w-0">
          <span className="label">{t("filters.subject")}</span>
          <select
            className="select min-h-11 w-full lg:min-h-10"
            value={value.subjectId}
            onChange={(event) => update("subjectId", event.target.value)}
          >
            <option value="">{t("filters.allSubjects")}</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="muted text-sm" role="status">
          {t("filters.count", { count, total })}
        </p>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={!active}
          onClick={() => onChange(emptyApplicationFilters)}
        >
          {t("filters.reset")}
        </button>
      </div>
    </section>
  );
}
