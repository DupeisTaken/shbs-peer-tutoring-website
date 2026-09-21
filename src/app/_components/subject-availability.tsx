"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { tutorSubjectRows } from "~/lib/subject-availability";
import { DisclosureIcon } from "./icons";

export function SubjectAvailability() {
  const t = useTranslations("subjectAvailability");
  const workflow = useTranslations("workflows");
  const data = api.subjectAvailability.options.useQuery();
  const utils = api.useUtils();
  const refresh = () =>
    Promise.all([
      utils.subjectAvailability.options.invalidate(),
      utils.admin.subjectEligibility.invalidate(),
    ]);
  // Retain the qualification mutation path so queued approvals and replay remain valid.
  const qualify = api.interviewManagement.qualify.useMutation({
    onSuccess: refresh,
  });
  const willingness = api.subjectAvailability.setWillingness.useMutation({
    onSuccess: refresh,
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (data.error) return <p role="alert">{data.error.message}</p>;
  if (!data.data) return <p role="status">{workflow("loading")}</p>;
  const {
    tutors,
    subjects,
    qualifications,
    grants,
    willingness: intents,
  } = data.data;
  const needle = search.trim().toLocaleLowerCase();
  const groups = tutors
    .map((tutor) => ({
      ...tutor,
      rows: tutorSubjectRows(
        tutor.id,
        subjects,
        qualifications,
        grants,
        intents,
      ),
    }))
    .filter(
      (tutor) =>
        tutor.status === "ACTIVE" ||
        tutor.rows.some(
          (row) => row.qualification !== null || row.willing !== null || row.qualified,
        ),
    )
    .map((tutor) => ({
      ...tutor,
      visible: tutor.rows.filter(
        (row) =>
          (!needle ||
            [
              tutor.englishName,
              row.name,
              row.group?.name ?? "",
              row.level?.name ?? "",
            ].some((text) => text.toLocaleLowerCase().includes(needle))) &&
          (filter === "ALL" ||
            (filter === "QUALIFIED" && row.qualified) ||
            (filter === "WILLING" && row.willing === true) ||
            (filter === "AVAILABLE" &&
              row.qualified &&
              row.willing === true &&
              row.active &&
              tutor.status === "ACTIVE" &&
              !tutor.user?.tutorAccessRevoked)),
      ),
    }))
    .filter(
      (tutor) => tutor.visible.length > 0 || (!needle && filter === "ALL"),
    );
  const pending = qualify.isPending || willingness.isPending;
  return (
    <div className="space-y-4 max-lg:[&_button]:min-h-11 max-lg:[&_input]:min-h-11 max-lg:[&_select]:min-h-11">
      <div className="card grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label>
          <span className="label">{t("search")}</span>
          <input
            className="input w-full"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="label">{t("filter")}</span>
          <select
            className="select w-full"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="ALL">{t("all")}</option>
            <option value="QUALIFIED">{t("qualified")}</option>
            <option value="WILLING">{t("willing")}</option>
            <option value="AVAILABLE">{t("available")}</option>
          </select>
        </label>
      </div>
      {(qualify.error ?? willingness.error) && (
        <p role="alert">{(qualify.error ?? willingness.error)?.message}</p>
      )}
      {(qualify.isSuccess || willingness.isSuccess) && (
        <p role="status">{workflow("saved")}</p>
      )}
      {groups.map((tutor) => {
        const open = expanded.has(tutor.id);
        const id = `subject-availability-${tutor.id}`;
        return (
          <section className="card overflow-hidden" key={tutor.id}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => toggle(tutor.id)}
              className="flex min-h-11 w-full items-center gap-3 p-4 text-left"
            >
              <DisclosureIcon open={open} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block font-semibold">{tutor.englishName}</span>
                {" "}
                <span className="muted mt-1 block text-sm">
                  {t("summary", {
                    qualified: tutor.rows.filter((row) => row.qualified).length,
                    willing: tutor.rows.filter((row) => row.willing === true)
                      .length,
                  })}
                </span>
              </span>
              {(tutor.status !== "ACTIVE" ||
                tutor.user?.tutorAccessRevoked) && (
                <span className="badge-slate">{t("inactiveTutor")}</span>
              )}
            </button>
            {/* Mount only expanded catalogues; large rosters should not create hidden form trees. */}
            {open && (
              <div id={id} className="space-y-3 border-t border-slate-100 p-4">
                {tutor.visible.map((row) => (
                  <article
                    key={row.id}
                    className="grid gap-4 rounded-lg border border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
                    aria-label={row.name}
                  >
                    <div className="min-w-0">
                      <p className="muted text-xs">
                        {row.group?.name ?? t("ungrouped")}
                        {row.level ? ` · ${row.level.name}` : ""}
                      </p>
                      <h3 className="mt-1 font-semibold [overflow-wrap:anywhere]">
                        {row.name}
                      </h3>
                      {!row.active && (
                        <span className="badge-slate mt-2">
                          {t("inactiveSubject")}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="label">{t("qualification")}</p>
                      <span
                        className={
                          row.qualified ? "badge-green" : "badge-slate"
                        }
                      >
                        {t(row.qualified ? "qualified" : "notQualified")}
                      </span>
                      {row.qualification && (
                        <p className="text-sm">
                          {t("sourceStatus", {
                            status: t(`status.${row.qualification}`),
                          })}
                        </p>
                      )}
                      {row.inheritedFrom.length > 0 && (
                        <p className="muted text-sm">
                          {t("inherited", {
                            subjects: row.inheritedFrom.join(", "),
                          })}
                        </p>
                      )}
                      <div>
                        {row.qualification === "APPROVED" ? (
                          <button
                            className="btn-secondary btn-sm"
                            disabled={pending}
                            onClick={() =>
                              qualify.mutate({
                                tutorId: tutor.id,
                                subjectId: row.id,
                                qualified: false,
                              })
                            }
                          >
                            {t("removeSource")}
                          </button>
                        ) : (
                          row.active &&
                          tutor.status === "ACTIVE" && (
                            <button
                              className="btn-secondary btn-sm"
                              disabled={pending}
                              onClick={() =>
                                qualify.mutate({
                                  tutorId: tutor.id,
                                  subjectId: row.id,
                                  qualified: true,
                                })
                              }
                            >
                              {t("approveSource")}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    <div>
                      <label>
                        <span className="label">{t("willingness")}</span>
                        <select
                          className="select w-full"
                          aria-label={t("willingnessFor", {
                            subject: row.name,
                          })}
                          value={
                            row.willing === null
                              ? "UNKNOWN"
                              : row.willing
                                ? "YES"
                                : "NO"
                          }
                          disabled={pending}
                          onChange={(event) =>
                            willingness.mutate({
                              tutorId: tutor.id,
                              subjectId: row.id,
                              willing: event.target.value === "YES",
                            })
                          }
                        >
                          <option value="UNKNOWN" disabled>
                            {t("notRecorded")}
                          </option>
                          <option value="YES" disabled={!row.active}>
                            {t("willing")}
                          </option>
                          <option value="NO">{t("notWilling")}</option>
                        </select>
                      </label>
                      <p className="muted mt-2 text-xs">{t("independent")}</p>
                    </div>
                  </article>
                ))}
                {tutor.visible.length === 0 && (
                  <p className="muted">{t("emptySubjects")}</p>
                )}
              </div>
            )}
          </section>
        );
      })}
      {groups.length === 0 && <p className="muted card p-4">{t("empty")}</p>}
    </div>
  );
}
