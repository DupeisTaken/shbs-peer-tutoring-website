"use client";
import { EmailDetails } from "~/app/_components/email-details";
import { QualificationReview } from "~/app/_components/qualification-review";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";
import { useDialog } from "~/app/_components/confirm-dialog";
import { InterviewManagement } from "~/app/_components/interview-management";

import { ApplicationFilters } from "~/app/_components/application-filters";
import {
  InterviewPanelEditor,
  type PanelTutor,
} from "~/app/_components/interview-panel-editor";
import {
  emptyApplicationFilters,
  matchesApplicationFilters,
} from "~/lib/application-filters";

type Status = "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED" | "RECALLED";

function StatusBadge({ status }: { status: Status }) {
  const t = useTranslations();
  const cls =
    status === "ACCEPTED"
      ? "badge-green"
      : status === "PENDING"
        ? "badge-amber"
        : status === "INTERVIEW"
          ? "badge bg-accent-100 text-accent-700"
          : "badge-slate";
  return (
    <span className={cls}>{t(`admin.applications.status.${status}`)}</span>
  );
}

type Application = {
  type: "INITIAL" | "ADDITIONAL_SUBJECT" | "HIGHER_LEVEL";
  requestedTutorId: string | null;
  qualificationReason: string | null;
  qualificationSnapshot: unknown;
  id: string;
  name: string;
  email: string;
  preferredContact: string | null;
  status: Status;
  updatedAt: Date;
  interviewAt: Date | null;
  subjectIntents: {
    subjectId: string;
    taken: boolean;
    grade: string | null;
    hasApScore: boolean;
    apScore: string | null;
    selfStudied: boolean;
    selfStudyNote: string | null;
    subject: { name: string; level: { name: string } | null };
  }[];
  interviewers: {
    isHead: boolean;
    tutor: { id: string; englishName: string };
  }[];
  votes: {
    accept: boolean;
    comment: string | null;
    tutor: { englishName: string };
  }[];
  decisionComment: string | null;
  decidedByTutor: { englishName: string } | null;
};

const PANEL_SIZE = 3;

function ApplicationCard({
  app,
  tutors,
  onChanged,
}: {
  app: Application;
  tutors: PanelTutor[];
  onChanged: () => Promise<unknown> | void;
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const account = api.account.me.useQuery().data;
  const additional = app.type !== "INITIAL";
  const canEditPanel =
    !readOnly &&
    (!additional ||
      (!!account &&
        ["ADMIN", "HEAD"].includes(account.role) &&
        account.tutorId !== app.requestedTutorId &&
        app.status === "PENDING"));
  const { confirm, dialog } = useDialog();
  // Mount details lazily, then retain the editor while collapsed so panel drafts
  // survive reopening without fetching qualifications for every unopened card.
  const [disclosure, setDisclosure] = useState<"new" | "open" | "closed">(
    "new",
  );
  const open = disclosure === "open";
  // A link from interview history opens the existing editor for this exact
  // application; do not duplicate panel mutations in a competing workflow.
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === `#application-${app.id}`) {
        setDisclosure("open");
        document
          .getElementById(`application-${app.id}`)
          ?.scrollIntoView({ block: "start" });
      }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [app.id]);
  const features = api.program.features.useQuery().data;
  const setStatus = api.admin.setApplicationStatus.useMutation({
    onSuccess: () => onChanged(),
    onError: () => onChanged(),
  });
  const del = api.admin.deleteApplication.useMutation({
    onSuccess: () => onChanged(),
  });

  const accepts = app.votes.filter((v) => v.accept).length;
  const courseNames =
    app.subjectIntents.map((ci) => ci.subject.name).join(", ") ||
    t("admin.applications.noCourses");
  const hasInterviewHistory =
    app.status === "INTERVIEW" ||
    app.interviewers.length > 0 ||
    app.decidedByTutor != null;
  // Generic status controls are only for screening. A panel outcome belongs to its chair.
  const canDirectAccept =
    !additional &&
    !readOnly &&
    features?.INTERVIEWS === false &&
    !hasInterviewHistory &&
    app.status !== "ACCEPTED";
  const canScreenReject =
    !additional &&
    !readOnly &&
    !hasInterviewHistory &&
    app.status === "PENDING";

  return (
    <div id={`application-${app.id}`} className="card scroll-mt-6 p-4">
      {/* Give identity and actions their own mobile rows so badges and long
          translated labels never compete for the same narrow flex space. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="flex min-h-11 w-full min-w-0 flex-wrap items-center gap-2 text-left lg:min-h-8 lg:w-auto lg:flex-1"
          aria-expanded={open}
          aria-controls={`application-panel-${app.id}`}
          onClick={() => setDisclosure(open ? "closed" : "open")}
        >
          <DisclosureIcon open={open} />
          <span className="min-w-0 font-medium break-words text-slate-900">
            {app.name}
          </span>
          <StatusBadge status={app.status} />
          <span className="badge-slate">
            {t(`qualificationRequests.${app.type}`)}
          </span>
          <span className="muted hidden truncate text-xs sm:inline">
            {courseNames}
            {(features?.INTERVIEWS === true || hasInterviewHistory) && (
              <>
                {" · "}
                {t("admin.applications.panelSummary", {
                  n: app.interviewers.length,
                  total: PANEL_SIZE,
                })}
                {app.votes.length > 0
                  ? ` · ${t("admin.applications.votesSummary", {
                      accepts,
                      total: app.votes.length,
                    })}`
                  : ""}
              </>
            )}
          </span>
        </button>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto">
          {!additional && app.status === "ACCEPTED" && (
            <Link
              href="/admin/users"
              className="link inline-flex min-h-11 max-w-full items-center text-sm break-words lg:min-h-8"
            >
              {t("admin.applications.setupAccount")}
            </Link>
          )}
          {canDirectAccept && (
            <button
              className="btn-secondary btn-sm"
              onClick={() =>
                setStatus.mutate({
                  id: app.id,
                  status: "ACCEPTED",
                  expectedUpdatedAt: app.updatedAt,
                })
              }
            >
              {t("admin.applications.accept")}
            </button>
          )}
          {canScreenReject && (
            <button
              className="btn-secondary btn-sm"
              onClick={() =>
                setStatus.mutate({
                  id: app.id,
                  status: "REJECTED",
                  expectedUpdatedAt: app.updatedAt,
                })
              }
            >
              {t("admin.applications.reject")}
            </button>
          )}
          {!readOnly && !additional && (
            <button
              className="btn-danger btn-sm"
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.applications.confirmDelete", {
                      name: app.name,
                    }),
                    confirmLabel: t("common.delete"),
                    cancelLabel: t("common.cancel"),
                    danger: true,
                  })
                )
                  del.mutate({ id: app.id });
              }}
            >
              {t("admin.applications.delete")}
            </button>
          )}
        </div>
      </div>

      {disclosure !== "new" && (
        <div
          hidden={!open}
          id={`application-panel-${app.id}`}
          className="mt-3 border-t border-slate-100 pt-3"
        >
          <EmailDetails contactOnly email={app.email} name={app.name} />
          {app.preferredContact && (
            <p className="muted text-xs">
              {t("admin.applications.reach", { contact: app.preferredContact })}
            </p>
          )}

          {/* Course intents */}
          {additional && (
            <QualificationReview app={app} onChanged={onChanged} />
          )}
          <ul className="mt-3 flex flex-wrap gap-2">
            {app.subjectIntents.map((ci, i) => {
              const quals: string[] = [];
              const na = t("admin.applications.na");
              if (ci.taken)
                quals.push(
                  t("admin.applications.qual.took", { grade: ci.grade ?? na }),
                );
              if (ci.hasApScore)
                quals.push(
                  t("admin.applications.qual.ap", { score: ci.apScore ?? na }),
                );
              if (ci.selfStudied)
                quals.push(
                  t("admin.applications.qual.selfStudied", {
                    note: ci.selfStudyNote ?? na,
                  }),
                );
              return (
                <li
                  key={i}
                  className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
                >
                  <span className="font-medium">{ci.subject.name}</span>
                  {ci.subject.level && (
                    <span className="badge-slate ml-1 align-middle">
                      {ci.subject.level.name}
                    </span>
                  )}
                  {/* Additional requests use their reason and recorded grant result above;
                      the initial-signup grade checklist must not imply they lack approval. */}
                  {!additional && (
                    <>
                      {" · "}
                      {quals.length
                        ? quals.join(" · ")
                        : t("admin.applications.noQualification")}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Panels retain three to eight slots and one chair; edits stay hidden when interviews are off. */}
          {(features?.INTERVIEWS === true || hasInterviewHistory) && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {t("admin.applications.panelHeading", { n: PANEL_SIZE })}
              </p>
              {app.interviewAt && (
                <p className="muted mt-1">
                  {t("admin.applications.scheduled", {
                    when: programFormat.dateTime(new Date(app.interviewAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </p>
              )}
              {canEditPanel && features?.INTERVIEWS && (
                <>
                  <InterviewPanelEditor
                    applicationId={app.id}
                    updatedAt={app.updatedAt}
                    requestedTutorId={app.requestedTutorId}
                    subjects={app.subjectIntents.map((intent) => ({
                      id: intent.subjectId,
                      label: [intent.subject.name, intent.subject.level?.name]
                        .filter(Boolean)
                        .join(" · "),
                    }))}
                    interviewers={app.interviewers}
                    tutors={tutors}
                    onChanged={onChanged}
                  />
                  <p className="muted my-3 text-sm">
                    {t("workflows.allVotes")}{" "}
                    <Link
                      className="link inline-flex min-h-11 items-center lg:min-h-8"
                      href="/admin/subject-availability"
                    >
                      {t("subjectAvailability.title")}
                    </Link>
                  </p>
                </>
              )}
            </div>
          )}

          {/* Panel votes + head decision (recorded on the head's dashboard; hidden when off) */}
          {(app.votes.length > 0 || app.decisionComment) && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {t("admin.applications.votesDecisionHeading")}
              </p>
              {app.votes.length > 0 ? (
                <>
                  <p className="muted mt-1 text-sm">
                    {t("admin.applications.voteTally", {
                      accepts,
                      rejects: app.votes.length - accepts,
                    })}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {app.votes.map((v, i) => (
                      <li key={i} className="text-xs text-slate-600">
                        {v.accept ? "👍" : "👎"} {v.tutor.englishName}
                        {v.comment ? ` — ${v.comment}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted mt-1 text-sm">
                  {t("admin.applications.noVotes")}
                </p>
              )}
              {app.decisionComment && (
                <p className="mt-2 text-sm text-slate-700">
                  {t("admin.applications.decision", {
                    comment: app.decisionComment,
                  })}
                  {app.decidedByTutor
                    ? ` — ${t("admin.applications.decidedByHead", {
                        name: app.decidedByTutor.englishName,
                      })}`
                    : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

export default function ApplicationsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const apps = api.admin.tutorApplications.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const features = api.program.features.useQuery();
  const readOnly = useReadOnly();
  const invalidate = () =>
    Promise.all([
      utils.admin.tutorApplications.invalidate(),
      utils.interviewManagement.options.invalidate(),
    ]);

  const [filters, setFilters] = useState(emptyApplicationFilters);
  // History links reveal their destination even when a previous filter hid it.
  // Ordinary filtering does not otherwise change the selected criteria.
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash.startsWith("#application-"))
        setFilters(emptyApplicationFilters);
    };
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  const list = apps.data ?? [];
  const filtered = list.filter((app) =>
    matchesApplicationFilters(app, filters),
  );
  // Build choices from the full queue so applying one filter never erases another.
  const subjects = Array.from(
    new Map(
      list.flatMap((app) =>
        app.subjectIntents.map(
          (intent) =>
            [
              intent.subjectId,
              {
                id: intent.subjectId,
                label: [intent.subject.name, intent.subject.level?.name]
                  .filter(Boolean)
                  .join(" · "),
              },
            ] as const,
        ),
      ),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6 max-lg:[&_button]:min-h-11 max-lg:[&_select]:min-h-11">
      <div>
        <h1 className="page-title">{t("admin.applications.title")}</h1>
        <p className="muted mt-1">
          {t("admin.applications.intro", { n: PANEL_SIZE })}
        </p>
      </div>

      {apps.data && (
        <ApplicationFilters
          value={filters}
          onChange={setFilters}
          subjects={subjects}
          count={filtered.length}
          total={list.length}
        />
      )}
      <div className="space-y-3">
        {apps.isLoading && <p role="status">{t("workflows.loading")}</p>}
        {apps.error && <p role="alert">{apps.error.message}</p>}
        {tutors.error && <p role="alert">{tutors.error.message}</p>}
        {filtered.map((app) => (
          <ApplicationCard
            key={app.id}
            app={app}
            tutors={tutors.data ?? []}
            onChanged={invalidate}
          />
        ))}
        {!apps.isLoading &&
          !apps.error &&
          list.length > 0 &&
          filtered.length === 0 && (
            <p className="muted card p-6 text-center">
              {t("admin.applications.filters.noMatches")}
            </p>
          )}
        {!apps.isLoading && !apps.error && list.length === 0 && (
          <p className="muted">{t("admin.applications.empty")}</p>
        )}
      </div>
      {/* Completion stays staff-only; the server retains the same permission checks. */}
      {!readOnly && features.data && (
        <div
          id="interview-records"
          className="scroll-mt-6 border-t border-slate-200 pt-6"
        >
          <InterviewManagement
            enabled={features.data.INTERVIEWS}
            onManageApplicant={() => setFilters(emptyApplicationFilters)}
          />
        </div>
      )}
    </div>
  );
}
