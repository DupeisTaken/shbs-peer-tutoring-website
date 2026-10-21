"use client";
import { participantNameLabel } from "~/app/_components/participant-name";
import { ApplicationAccountSetupButton } from "~/app/_components/application-account-setup";
import { EmailDetails } from "~/app/_components/email-details";
import { Button } from "~/app/_components/ui/button";
import { QualificationReview } from "~/app/_components/qualification-review";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useNotificationRecordReveal,
  type NotificationRecordArrival,
} from "~/app/_components/use-notification-record-reveal";
import { InlineNotice } from "~/app/_components/ui/patterns";
import {
  useSessionAccessDenied,
  useSessionPageScroll,
  useSessionViewState,
  useSessionViewVerified,
} from "~/app/_components/session-view-state";
import { viewEnum, viewFields, viewSearch } from "~/lib/session-view-state";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";
import { useDialog } from "~/app/_components/confirm-dialog";
import { InterviewManagement } from "~/app/_components/interview-management";

import { ApplicationFilters } from "~/app/_components/application-filters";
import { ApplicationInvalidityControls } from "~/app/_components/request-invalidity-controls";
import {
  InvalidityBadge,
  InvalidityFilter,
  InvalidityNotice,
  RequestInvalidityHost,
  type InvalidityFilterValue,
  type InvalidityRecord,
} from "~/app/_components/request-invalidity";
import {
  InterviewPanelEditor,
  type PanelTutor,
} from "~/app/_components/interview-panel-editor";
import {
  APPLICATION_COMPLETIONS,
  APPLICATION_SORTS,
  emptyApplicationFilters,
  matchesApplicationFilters,
  sortApplications,
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

type Application = InvalidityRecord & {
  type: "INITIAL" | "ADDITIONAL_SUBJECT" | "HIGHER_LEVEL";
  requestedTutorId: string | null;
  setupTutorId: string | null;
  qualificationReason: string | null;
  qualificationSnapshot: unknown;
  id: string;
  name: string;
  email: string;
  preferredContact: string | null;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
  interviewAt: Date | null;
  interviewCompletedAt: Date | null;
  interviewDurationMin: number | null;
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
    attended: boolean;
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
  onInterviewApprovalActive,
}: {
  app: Application;
  tutors: PanelTutor[];
  onChanged: (reportErrors?: boolean) => Promise<unknown> | void;
  onInterviewApprovalActive: (id: string, active: boolean) => void;
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const retainInterviewApproval = useCallback(
    (active: boolean) => onInterviewApprovalActive(app.id, active),
    [app.id, onInterviewApprovalActive],
  );
  // Only current labels use a fallback. Intake/search/mutation records stay unchanged.
  const displayName = participantNameLabel(
    app.name,
    tutors.find((tutor) => tutor.id === app.requestedTutorId)?.username,
    t("participantNames.unnamed"),
  );
  const readOnly = useReadOnly();
  const account = api.account.me.useQuery().data;
  const additional = app.type !== "INITIAL";
  const canEditPanel =
    !readOnly &&
    !app.isInvalid &&
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
    !app.isInvalid &&
    features?.INTERVIEWS === false &&
    !hasInterviewHistory &&
    app.status !== "ACCEPTED";
  const canScreenReject =
    !additional &&
    !readOnly &&
    !app.isInvalid &&
    !hasInterviewHistory &&
    app.status === "PENDING";

  return (
    <div id={`application-${app.id}`} className="card scroll-mt-6 p-4">
      {/* Give identity and actions their own mobile rows so badges and long
          translated labels never compete for the same narrow flex space. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="grid min-h-11 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 text-left lg:min-h-8 lg:w-auto lg:flex-1"
          aria-expanded={open}
          aria-controls={`application-panel-${app.id}`}
          onClick={() => setDisclosure(open ? "closed" : "open")}
        >
          <DisclosureIcon open={open} />
          {/* Wrapped metadata shares the name edge, independent of the disclosure artwork. */}
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 font-semibold break-words text-slate-900">
              {displayName}
            </span>
            <StatusBadge status={app.status} />
            {app.isInvalid && <InvalidityBadge />}
            <span className="badge-slate">
              {t(`qualificationRequests.${app.type}`)}
            </span>
            <span className="muted block w-full text-xs [overflow-wrap:anywhere]">
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
            {app.interviewCompletedAt ? (
              <span className="muted block w-full text-xs">
                {t("admin.applications.filters.completedOn", {
                  date: programFormat.dateTime(app.interviewCompletedAt, {
                    dateStyle: "medium",
                  }),
                })}
              </span>
            ) : hasInterviewHistory ? (
              <span className="muted block w-full text-xs">
                {t(
                  "admin.applications.filters.completionOptions.NOT_COMPLETED",
                )}
              </span>
            ) : null}
          </span>
        </button>
        {/* Put account setup before boxed decisions in DOM/keyboard order, with Delete
         * last. Wrapping preserves that order and each owner's existing guards. */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto">
          {!readOnly &&
            !additional &&
            !app.isInvalid &&
            app.status === "ACCEPTED" && (
              <ApplicationAccountSetupButton
                applicationId={app.id}
                name={displayName}
              />
            )}
          {!readOnly && !additional && (
            <ApplicationInvalidityControls
              record={app}
              name={displayName}
              canFlag
              coordinator={account?.role === "COORDINATOR"}
            />
          )}
          {canDirectAccept && (
            <Button
              size="compact"
              onClick={() =>
                setStatus.mutate({
                  id: app.id,
                  status: "ACCEPTED",
                  expectedUpdatedAt: app.updatedAt,
                })
              }
            >
              {t("admin.applications.accept")}
            </Button>
          )}
          {canScreenReject && (
            <Button
              size="compact"
              onClick={() =>
                setStatus.mutate({
                  id: app.id,
                  status: "REJECTED",
                  expectedUpdatedAt: app.updatedAt,
                })
              }
            >
              {t("admin.applications.reject")}
            </Button>
          )}
          {!readOnly && !additional && !app.isInvalid && (
            <Button
              size="compact"
              variant="danger"
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.applications.confirmDelete", {
                      name: displayName,
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
            </Button>
          )}
        </div>
      </div>
      {app.isInvalid && (
        <div className="mt-3">
          <InvalidityNotice />
        </div>
      )}
      {disclosure !== "new" && (
        <div
          hidden={!open}
          id={`application-panel-${app.id}`}
          className="mt-3 border-t border-slate-100 pt-3"
        >
          <EmailDetails contactOnly email={app.email} name={displayName} />
          {app.preferredContact && (
            <p className="muted text-xs">
              {t("admin.applications.reach", { contact: app.preferredContact })}
            </p>
          )}

          {/* Course intents */}
          {additional && (
            <QualificationReview
              app={app}
              displayName={displayName}
              onChanged={onChanged}
              onInterviewApprovalActive={retainInterviewApproval}
            />
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
  const locale = useLocale();
  const [activeInterviewApprovals, setActiveInterviewApprovals] = useState<
    Set<string>
  >(() => new Set());
  const retainInterviewApproval = useCallback((id: string, active: boolean) => {
    setActiveInterviewApprovals((current) => {
      if (current.has(id) === active) return current;
      const next = new Set(current);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const [noticeTargetMissing, setNoticeTargetMissing] = useState(false);
  const arrivalSequence = useRef(0);
  const [arrival, setArrival] = useState<
    (NotificationRecordArrival & { selected?: boolean }) | null
  >(null);
  const utils = api.useUtils();
  const apps = api.admin.tutorApplications.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const features = api.program.features.useQuery();
  const readOnly = useReadOnly();
  const [interviewScene, setInterviewScene] = useState({
    ready: false,
    scope: "",
    denied: false,
  });
  const onInterviewView = useCallback(
    (ready: boolean, scope: string, denied: boolean) => {
      setInterviewScene((old) =>
        old.ready === ready && old.scope === scope && old.denied === denied
          ? old
          : { ready, scope, denied },
      );
    },
    [],
  );
  // Qualification decisions distinguish a committed write from failed cache
  // synchronization. Other callers retain their existing refresh behavior.
  const invalidate = (reportErrors = false) =>
    settleRefreshes(
      [
        utils.admin.tutorApplications,
        utils.interviewManagement.options,
        utils.tutor.myInterviews,
      ].map(
        (view) => () =>
          reportErrors ? invalidateAndReport(view) : view.invalidate(),
      ),
    );

  const denied = useSessionAccessDenied(apps, tutors, features);
  const verified = useSessionViewVerified();
  const [filters, setFilters] = useSessionViewState({
    id: "applications.filters.v1",
    initialState: emptyApplicationFilters,
    enabled: !denied,
    restoreReady: !!apps.data,
    parse: viewFields({
      search: viewSearch,
      status: viewEnum([
        "",
        "PENDING",
        "INTERVIEW",
        "ACCEPTED",
        "REJECTED",
        "RECALLED",
      ]),
      type: viewEnum(["", "INITIAL", "ADDITIONAL_SUBJECT", "HIGHER_LEVEL"]),
      subjectId: viewEnum([
        "",
        ...(apps.data ?? []).flatMap((app) =>
          app.subjectIntents.map((intent) => intent.subjectId),
        ),
      ]),
      // Older saved views predate these controls. Preserve their existing
      // criteria, but reject unknown new values instead of adopting them.
      completion: (value) =>
        value === undefined ? "" : viewEnum(APPLICATION_COMPLETIONS)(value),
      sort: (value) =>
        value === undefined ? "" : viewEnum(APPLICATION_SORTS)(value),
    }),
  });
  const [invalidity, setInvalidity] =
    useSessionViewState<InvalidityFilterValue>({
      id: "applications.invalidity.v1",
      initialState: "valid",
      enabled: !denied,
      parse: viewEnum(["valid", "invalid", "all"]),
    });
  useSessionPageScroll({
    id: "applications",
    scope: JSON.stringify([filters, invalidity, interviewScene.scope]),
    ready:
      !!apps.data &&
      !!tutors.data &&
      !!features.data &&
      (readOnly || interviewScene.ready),
    enabled: !denied && !interviewScene.denied,
  });
  // History links reveal their destination even when a previous filter hid it.
  // Ordinary filtering does not otherwise change the selected criteria.
  useEffect(() => {
    const reveal = () => {
      const hash = window.location.hash;
      const target = /^#application-([a-zA-Z0-9_-]{1,128})$/.exec(hash);
      setNoticeTargetMissing(false);
      setArrival(
        verified && !denied && target
          ? {
              hash,
              pathname: window.location.pathname,
              sequence: ++arrivalSequence.current,
            }
          : null,
      );
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [verified, denied]);
  useEffect(() => {
    if (arrival && !arrival.selected && !apps.isFetching && apps.data) {
      setFilters(emptyApplicationFilters);
      setInvalidity("all");
      const exists = apps.data.some(
        (app) => `#application-${app.id}` === arrival.hash,
      );
      setNoticeTargetMissing(!exists);
      setArrival(exists ? { ...arrival, selected: true } : null);
    }
  }, [arrival, apps.data, apps.isFetching, setFilters, setInvalidity]);
  useNotificationRecordReveal(
    arrival,
    !denied &&
      !!arrival?.selected &&
      invalidity === "all" &&
      Object.entries(emptyApplicationFilters).every(
        ([key, value]) => filters[key as keyof typeof filters] === value,
      ),
    (cancelled) =>
      setArrival((current) =>
        current?.sequence === cancelled.sequence ? null : current,
      ),
  );
  const list = denied ? [] : (apps.data ?? []);
  const filtered = list.filter(
    (app) =>
      matchesApplicationFilters(app, filters) &&
      (invalidity === "all" || !!app.isInvalid === (invalidity === "invalid")),
  );
  // Acceptance can move a row outside the current status filter before its
  // dialog finishes synchronization. Keep that feature owner mounted until
  // deliberate Close; authoritative access denial still conceals the whole page.
  const matchingIds = new Set(filtered.map((app) => app.id));
  const visible = sortApplications(
    list.filter(
      (app) => matchingIds.has(app.id) || activeInterviewApprovals.has(app.id),
    ),
    filters.sort,
    locale,
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

  if (denied)
    return (
      <p role="alert">
        {apps.error?.message ??
          tutors.error?.message ??
          features.error?.message ??
          t("uiPatterns.loadFailed")}
      </p>
    );
  return (
    <RequestInvalidityHost>
      {noticeTargetMissing && (
        <InlineNotice tone="info">
          {t("workflow.noticeTargetMissing")}
        </InlineNotice>
      )}
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
        {apps.data && (
          <InvalidityFilter value={invalidity} onChange={setInvalidity} />
        )}
        <div className="space-y-3">
          {apps.isLoading && <p role="status">{t("workflows.loading")}</p>}
          {apps.error && <p role="alert">{apps.error.message}</p>}
          {tutors.error && <p role="alert">{tutors.error.message}</p>}
          {visible.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              tutors={tutors.data ?? []}
              onChanged={invalidate}
              onInterviewApprovalActive={retainInterviewApproval}
            />
          ))}
          {!apps.isLoading &&
            !apps.error &&
            list.length > 0 &&
            visible.length === 0 && (
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
              onViewReadyChange={onInterviewView}
              enabled={features.data.INTERVIEWS}
              hoursEnabled={features.data.SERVICE_HOURS}
              onManageApplicant={() => {
                setFilters(emptyApplicationFilters);
                setInvalidity("all");
              }}
            />
          </div>
        )}
      </div>
    </RequestInvalidityHost>
  );
}
