"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  type AnnouncementAudience,
  type AnnouncementCandidate,
  selectAnnouncementRecipients,
} from "~/lib/announcement-recipients";

/** A filter preview and manual overrides use the same selector as server publication. */
export function RecipientPicker({
  candidates,
  audience,
  onChange,
  loading,
}: {
  candidates: AnnouncementCandidate[];
  audience: AnnouncementAudience;
  onChange: (audience: AnnouncementAudience) => void;
  loading: boolean;
}) {
  const t = useTranslations("admin.announcements.recipients");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const recipients = selectAnnouncementRecipients(candidates, audience);
  const recipientIds = new Set(recipients.map((tutor) => tutor.id));
  const subjects = [
    ...new Set(candidates.flatMap((tutor) => tutor.subjects)),
  ].sort();
  const grades = [
    ...new Set(
      candidates.flatMap((tutor) =>
        tutor.gradeLevel === null ? [] : [tutor.gradeLevel],
      ),
    ),
  ].sort((a, b) => a - b);
  const statuses = [
    "ACTIVE",
    "PENDING",
    "OPTED_OUT",
    "GRADUATED",
    "ARCHIVED",
  ] as const;
  const toggle = <T,>(values: T[], value: T) =>
    values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="btn-secondary btn-sm"
        aria-expanded={open}
        aria-controls="announcement-recipients"
        onClick={() => setOpen(!open)}
      >
        {t("button")} ·{" "}
        {loading ? t("loading") : t("count", { count: recipients.length })}
      </button>
      {open && (
        <section
          id="announcement-recipients"
          aria-label={t("button")}
          className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-900">{t("button")}</h3>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setOpen(false)}
            >
              {t("done")}
            </button>
          </div>
          <p className="muted text-sm">{t("explanation")}</p>
          <label className="block space-y-1 text-sm font-medium">
            {t("mode")}
            <select
              className="input w-full"
              value={audience.mode}
              onChange={(event) =>
                onChange({
                  ...audience,
                  mode: event.target.value as AnnouncementAudience["mode"],
                })
              }
            >
              <option value="all">{t("all")}</option>
              <option value="filtered">{t("filtered")}</option>
              <option value="specific">{t("specific")}</option>
            </select>
          </label>
          {audience.mode === "filtered" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">{t("grades")}</legend>
                <div className="flex flex-wrap gap-3">
                  {grades.map((grade) => (
                    <label
                      key={grade}
                      className="flex items-center gap-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={audience.grades.includes(grade)}
                        onChange={() =>
                          onChange({
                            ...audience,
                            grades: toggle(audience.grades, grade),
                          })
                        }
                      />
                      G{grade}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">
                  {t("statuses")}
                </legend>
                <div className="flex flex-wrap gap-3">
                  {statuses.map((status) => (
                    <label
                      key={status}
                      className="flex items-center gap-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={audience.statuses.includes(status)}
                        onChange={() =>
                          onChange({
                            ...audience,
                            statuses: toggle(audience.statuses, status),
                          })
                        }
                      />
                      {t(`status.${status}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">
                  {t("subjects")}
                </legend>
                <div className="flex max-h-32 flex-wrap gap-3 overflow-y-auto">
                  {subjects.map((subject) => (
                    <label
                      key={subject}
                      className="flex items-center gap-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={audience.subjects.includes(subject)}
                        onChange={() =>
                          onChange({
                            ...audience,
                            subjects: toggle(audience.subjects, subject),
                          })
                        }
                      />
                      {subject}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="space-y-1 text-sm font-medium">
                {t("assignment")}
                <select
                  className="input w-full"
                  value={audience.assignment}
                  onChange={(event) =>
                    onChange({
                      ...audience,
                      assignment: event.target
                        .value as AnnouncementAudience["assignment"],
                    })
                  }
                >
                  <option value="any">{t("any")}</option>
                  <option value="with">{t("with")}</option>
                  <option value="without">{t("without")}</option>
                </select>
              </label>
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p role="status" className="text-sm font-semibold">
              {t("count", { count: recipients.length })}
            </p>
            <p className="mt-1 max-h-24 overflow-y-auto text-sm text-slate-600">
              {recipients.map((tutor) => tutor.name).join(", ") || t("empty")}
            </p>
          </div>
          <label className="block text-sm font-medium">
            {t("search")}
            <input
              className="input mt-1 w-full"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <p className="muted text-xs">{t("overrideHelp")}</p>
          <div className="max-h-64 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 bg-white">
            {candidates
              .filter((tutor) =>
                tutor.name
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
              )
              .map((tutor) => {
                const override = audience.excludeTutorIds.includes(tutor.id)
                  ? "exclude"
                  : audience.includeTutorIds.includes(tutor.id)
                    ? "include"
                    : "auto";
                return (
                  <div
                    key={tutor.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {tutor.name}{" "}
                        {recipientIds.has(tutor.id) && (
                          <span className="badge-green ml-1">
                            {t("selected")}
                          </span>
                        )}
                      </p>
                      <p className="muted text-xs">
                        {tutor.gradeLevel ? `G${tutor.gradeLevel} · ` : ""}
                        {t("tutees", { count: tutor.activeTutees })}
                      </p>
                    </div>
                    <select
                      aria-label={t("overrideFor", { name: tutor.name })}
                      className="input w-auto"
                      value={override}
                      onChange={(event) =>
                        onChange({
                          ...audience,
                          includeTutorIds: [
                            ...audience.includeTutorIds.filter(
                              (id) => id !== tutor.id,
                            ),
                            ...(event.target.value === "include"
                              ? [tutor.id]
                              : []),
                          ],
                          excludeTutorIds: [
                            ...audience.excludeTutorIds.filter(
                              (id) => id !== tutor.id,
                            ),
                            ...(event.target.value === "exclude"
                              ? [tutor.id]
                              : []),
                          ],
                        })
                      }
                    >
                      <option value="auto">
                        {audience.mode === "specific"
                          ? t("notSelected")
                          : t("auto")}
                      </option>
                      <option value="include">{t("include")}</option>
                      <option value="exclude">{t("exclude")}</option>
                    </select>
                  </div>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
