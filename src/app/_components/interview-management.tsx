"use client";
import { formText, formTexts } from "~/lib/form-values";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations, useTimeZone, useFormatter } from "next-intl";
import { api } from "~/trpc/react";
import { programDateTimeInput, parseProgramDateTime } from "~/lib/program-time";
import {
  groupTutorQualifications,
  filterTutorQualifications,
} from "~/lib/interview-groups";
import { DisclosureIcon } from "./icons";

/** Explicit disclosure state survives filtering; form state stays mounted while collapsed. */
function InterviewDisclosure({
  id,
  open,
  toggle,
  summary,
  children,
}: {
  id: string;
  open: boolean;
  toggle: () => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="flex w-full min-w-0 items-start gap-3 p-4 text-left hover:bg-slate-50"
      >
        <span className="mt-1 shrink-0">
          <DisclosureIcon open={open} />
        </span>{" "}
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {summary}
        </span>
      </button>
      <div id={id} hidden={!open} className="border-t border-slate-100 p-4">
        {children}
      </div>
    </div>
  );
}

export function InterviewManagement() {
  const t = useTranslations("workflows");
  const allT = useTranslations();
  const format = useFormatter();
  const timeZone = useTimeZone();
  const [inputError, setInputError] = useState("");
  const utils = api.useUtils();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [qualificationSearch, setQualificationSearch] = useState("");
  const [qualificationStatus, setQualificationStatus] = useState<
    "ALL" | "QUALIFIED" | "NONE"
  >("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [completion, setCompletion] = useState<"OPEN" | "COMPLETED" | "ALL">(
    "OPEN",
  );
  const data = api.interviewManagement.options.useQuery({
    page,
    search,
    completion,
  });
  const qualify = api.interviewManagement.qualify.useMutation({
    onSuccess: () => data.refetch(),
  });
  const complete = api.interviewManagement.complete.useMutation({
    onSuccess: async () => {
      setPage(0);
      await utils.interviewManagement.options.invalidate();
    },
  });
  if (data.error) return <p role="alert">{data.error.message}</p>;
  if (!data.data) return <p>{t("loading")}</p>;
  const { tutors, subjects, qualifications, applications } = data.data;
  const groups = filterTutorQualifications(
    groupTutorQualifications(tutors, subjects, qualifications),
    qualificationSearch,
    qualificationStatus,
  );
  const first = applications.total === 0 ? 0 : page * applications.pageSize + 1;
  const last = Math.min(applications.total, (page + 1) * applications.pageSize);
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="muted max-w-3xl text-sm">{t("allVotes")}</p>
        <Link href="/admin/applications" className="btn-secondary btn-sm">
          {t("managePanels")}
        </Link>
      </div>
      {inputError && <p role="alert">{inputError}</p>}
      <section className="space-y-3" aria-labelledby="qualification-heading">
        <h2 id="qualification-heading" className="section-title">
          {t("qualified")}
        </h2>
        <div className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
          <label className="min-w-0">
            <span className="label">{t("qualificationSearch")}</span>
            <input
              className="input w-full"
              value={qualificationSearch}
              onChange={(event) => setQualificationSearch(event.target.value)}
            />
          </label>
          <label>
            <span className="label">{t("qualificationFilter")}</span>
            <select
              className="select w-full"
              value={qualificationStatus}
              onChange={(event) =>
                setQualificationStatus(
                  event.target.value as typeof qualificationStatus,
                )
              }
            >
              <option value="ALL">{t("allTutors")}</option>
              <option value="QUALIFIED">{t("hasQualifications")}</option>
              <option value="NONE">{t("noQualifications")}</option>
            </select>
          </label>
        </div>
        {groups.map((group) => {
          const id = `qualifications-${group.id}`;
          return (
            <InterviewDisclosure
              key={id}
              id={id}
              open={expanded.has(id)}
              toggle={() => toggle(id)}
              summary={
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{group.englishName}</span>{" "}
                    <span className="badge-slate">
                      {t("qualificationCount", {
                        count: group.subjects.length,
                      })}
                    </span>
                  </span>{" "}
                  <span className="muted mt-1 block text-sm">
                    {group.subjects
                      .map((subject) => subject.name)
                      .join(" · ") || t("noQualifications")}
                  </span>
                </>
              }
            >
              <div className="space-y-3">
                {group.subjects.map((subject) => (
                  <div
                    key={subject.subjectId}
                    className="flex flex-wrap items-center justify-between gap-3 text-sm"
                  >
                    <span>{subject.name}</span>
                    <button
                      className="btn-secondary btn-sm"
                      disabled={qualify.isPending}
                      onClick={() =>
                        qualify.mutate({
                          tutorId: group.id,
                          subjectId: subject.subjectId,
                          qualified: false,
                        })
                      }
                    >
                      {t("removeQualification")}
                    </button>
                  </div>
                ))}
                {group.status === "ACTIVE" && (
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      qualify.mutate({
                        tutorId: group.id,
                        subjectId: formText(
                          new FormData(event.currentTarget),
                          "subjectId",
                        ),
                        qualified: true,
                      });
                    }}
                  >
                    <label className="min-w-0 flex-1">
                      <span className="label">{t("subject")}</span>
                      <select
                        name="subjectId"
                        className="input w-full"
                        required
                        defaultValue=""
                      >
                        <option value="">—</option>
                        {subjects
                          .filter(
                            (subject) =>
                              subject.active &&
                              !group.subjects.some(
                                (q) => q.subjectId === subject.id,
                              ),
                          )
                          .map((subject) => (
                            <option key={subject.id} value={subject.id}>
                              {subject.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="btn-primary btn-sm"
                      disabled={qualify.isPending}
                    >
                      {t("addQualification")}
                    </button>
                  </form>
                )}
              </div>
            </InterviewDisclosure>
          );
        })}
        {groups.length === 0 && (
          <p className="muted card p-4">{t("qualificationEmpty")}</p>
        )}
      </section>
      <section className="space-y-3" aria-labelledby="interview-heading">
        <h2 id="interview-heading" className="section-title">
          {t("interviewRecords")}
        </h2>
        <div className="card grid items-end gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <form
            className="flex w-full min-w-0 flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
              setSearch(searchDraft.trim());
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="label">{t("interviewSearch")}</span>
              <input
                className="input w-full"
                maxLength={100}
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </label>
            <button className="btn-secondary" type="submit">
              {t("searchInterviews")}
            </button>
          </form>
          <label>
            <span className="label">{t("interviewFilter")}</span>
            <select
              className="select w-full"
              value={completion}
              onChange={(event) => {
                setPage(0);
                setCompletion(event.target.value as typeof completion);
              }}
            >
              <option value="OPEN">{t("interviewOpen")}</option>
              <option value="COMPLETED">{t("interviewCompleted")}</option>
              <option value="ALL">{t("interviewAll")}</option>
            </select>
          </label>
        </div>
        {applications.rows.map((a) => {
          // Application identity keeps unrelated people with matching names separate.
          const id = `interview-${a.id}`;
          const chair = a.interviewers.find((panelist) => panelist.isHead);
          return (
            <InterviewDisclosure
              key={id}
              id={id}
              open={expanded.has(id)}
              toggle={() => toggle(id)}
              summary={
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.name}</span>{" "}
                    <span
                      className={
                        a.interviewCompletedAt ? "badge-green" : "badge-amber"
                      }
                    >
                      {t(
                        a.interviewCompletedAt
                          ? "interviewCompleted"
                          : "interviewOpen",
                      )}
                    </span>{" "}
                    <span className="badge-slate">
                      {allT(`admin.applications.status.${a.status}`)}
                    </span>
                  </span>{" "}
                  <span className="muted mt-2 block text-sm">
                    {a.subjectIntents
                      .map((intent) => intent.subject.name)
                      .join(" · ") || t("noInterviewSubjects")}
                  </span>{" "}
                  <span className="mt-1 block text-sm">
                    {t("panelSummaryNames", {
                      names:
                        a.interviewers
                          .map((panelist) => panelist.tutor.englishName)
                          .join(", ") || t("unassignedPanel"),
                    })}
                  </span>{" "}
                  <span className="muted mt-1 block text-sm">
                    {t("chairSummary", {
                      name: chair?.tutor.englishName ?? t("unassignedPanel"),
                    })}
                  </span>{" "}
                  <span className="muted mt-1 block text-sm">
                    {t("scheduleSummary", {
                      date: a.interviewAt
                        ? date(a.interviewAt)
                        : t("unscheduled"),
                    })}
                  </span>
                  {a.interviewCompletedAt && (
                    <span className="mt-1 block text-sm">
                      {t("completionSummary", {
                        date: date(a.interviewCompletedAt),
                        minutes: a.interviewDurationMin ?? 0,
                      })}
                    </span>
                  )}
                </>
              }
            >
              <Link
                href={`/admin/applications#application-${a.id}`}
                className="link text-sm"
              >
                {t("manageApplicantPanel")}
              </Link>
              {a.interviewers.length === 0 ? (
                <p className="muted mt-3 text-sm">{t("panelRequired")}</p>
              ) : (
                <form
                  key={a.interviewCompletedAt?.toISOString() ?? "open"}
                  className="mt-4 space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    try {
                      setInputError("");
                      complete.mutate({
                        applicationId: a.id,
                        durationMin: Number(form.get("duration")),
                        completedAt: parseProgramDateTime(
                          formText(form, "date"),
                          timeZone,
                        ),
                        attendedTutorIds: formTexts(form, "attended"),
                        reason: formText(form, "reason"),
                      });
                    } catch (error) {
                      setInputError(
                        error instanceof Error
                          ? error.message
                          : t("invalidDate"),
                      );
                    }
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="label">{t("interviewComplete")}</span>
                      <input
                        className="input w-full"
                        type="datetime-local"
                        name="date"
                        required
                        defaultValue={
                          a.interviewCompletedAt
                            ? programDateTimeInput(
                                a.interviewCompletedAt,
                                timeZone,
                              )
                            : undefined
                        }
                      />
                    </label>
                    <label>
                      <span className="label">{t("duration")}</span>
                      <input
                        className="input w-full"
                        type="number"
                        name="duration"
                        required
                        min={1}
                        max={480}
                        defaultValue={a.interviewDurationMin ?? 30}
                      />
                    </label>
                  </div>
                  <fieldset>
                    <legend className="label">{t("attended")}</legend>
                    <div className="flex flex-wrap gap-4">
                      {a.interviewers.map((panelist) => (
                        <label className="flex gap-2" key={panelist.tutorId}>
                          <input
                            type="checkbox"
                            name="attended"
                            value={panelist.tutorId}
                            defaultChecked={panelist.attended}
                          />
                          {panelist.tutor.englishName}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block">
                    <span className="label">{t("decision")}</span>
                    <input
                      className="input w-full"
                      name="reason"
                      required
                      maxLength={1000}
                    />
                  </label>
                  <button className="btn-primary" disabled={complete.isPending}>
                    {t("save")}
                  </button>
                </form>
              )}
            </InterviewDisclosure>
          );
        })}
        {applications.rows.length === 0 && (
          <p className="muted card p-6 text-center">{t("interviewEmpty")}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            {t("previous")}
          </button>
          <span className="muted text-sm">
            {t("interviewCount", { first, last, total: applications.total })}
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={last >= applications.total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </button>
        </div>
      </section>
      {(complete.error ?? qualify.error) && (
        <p role="alert">{(complete.error ?? qualify.error)?.message}</p>
      )}
      {(complete.isSuccess || qualify.isSuccess) && (
        <p role="status">{t("saved")}</p>
      )}
    </div>
  );
}
