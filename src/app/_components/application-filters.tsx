"use client";

import { useTranslations } from "next-intl";
import {
  emptyApplicationFilters,
  type ApplicationFilters as Filters,
} from "~/lib/application-filters";
import { Button } from "./ui/button";
import { FilterToolbar } from "./ui/patterns";

// Native input padding follows the shared control declarations; retain the
// compact desktop baseline explicitly while leaving touch targets at 44 px.
const filterControl =
  "input control-compact mt-1 w-full min-h-11 lg:min-h-8 lg:py-1";

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
    <div className="card p-4">
      <FilterToolbar
        label={t("filters.heading")}
        summary={<p role="status">{t("filters.count", { count, total })}</p>}
        actions={
          <Button
            variant="ghost"
            size="compact"
            disabled={!active}
            onClick={() => onChange(emptyApplicationFilters)}
          >
            {t("filters.reset")}
          </Button>
        }
      >
        <label className="min-w-0 flex-[2_1_16rem]">
          <span className="label">{t("filters.search")}</span>
          <input
            type="search"
            className={filterControl}
            value={value.search}
            onChange={(event) => update("search", event.target.value)}
          />
        </label>
        <label className="min-w-0 flex-[1_1_10rem]">
          <span className="label">{t("filters.status")}</span>
          <select
            className={filterControl}
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
        <label className="min-w-0 flex-[1_1_12rem]">
          <span className="label">{t("filters.type")}</span>
          <select
            className={filterControl}
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
        <label className="min-w-0 flex-[1_1_12rem]">
          <span className="label">{t("filters.subject")}</span>
          <select
            className={filterControl}
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
      </FilterToolbar>
    </div>
  );
}
