"use client";
import { Button } from "~/app/_components/ui/button";
import { WorkloadAssignmentConfirmation } from "~/app/_components/assignment-workload";
import { invalidateWorkloads } from "~/lib/workload-cache";
import { isAssignableTutor } from "~/lib/assignment-qualification";
import { QualifiedTutorSelect } from "~/app/_components/qualified-tutor-select";
import { EmailDetails } from "~/app/_components/email-details";
import { StudentRequestBoard } from "./student-request-board";
import { SignupSourceBadge } from "~/app/_components/signup-source-badge";
import { SignupInvalidityControls } from "~/app/_components/request-invalidity-controls";
import {
  InvalidityBadge,
  InvalidityFilter,
  InvalidityNotice,
  type InvalidityFilterValue,
  type InvalidityRecord,
} from "~/app/_components/request-invalidity";

import { useEffect, useId, useMemo, useState } from "react";
import {
  useSessionAccessDenied,
  useSessionPageScroll,
  useSessionViewState,
} from "~/app/_components/session-view-state";
import { viewEnum } from "~/lib/session-view-state";
import {
  ParticipantName,
  participantNameLabel,
} from "~/app/_components/participant-name";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  isCurrentManualSignup,
  signupRequestGroup,
} from "~/lib/signup-request-groups";

import { api } from "~/trpc/react";
import { formatWeekday, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";
import { useDialog } from "~/app/_components/confirm-dialog";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";

type SlotLite = {
  id: string;
  label: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
};

type PendingTutee = InvalidityRecord & {
  id: string;
  signupSource: string;
  unverified?: boolean;
  englishName: string;
  user?: { username: string | null } | null;
  gradeLevel: string | null;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  createdAt: Date;
  signupSubmittedAt: Date | null;
  updatedAt: Date;
  signedRulebook: boolean;
  signatureName: string | null;
  firstChoice: { id: string; name: string } | null;
  secondChoice: { id: string; name: string } | null;
  availabilities: { slot: SlotLite }[];
  /** Set when this pending signup matches a tutee punishment-removed this quarter (name/email/phone). */
  bannedMatch: { name: boolean; email: boolean; phone: boolean } | null;
};

function availability(av: { slot: SlotLite }[], locale: string): string {
  if (av.length === 0) return "—";
  return av
    .map(
      (a) =>
        `${formatWeekday(a.slot.dayOfWeek, locale)} ${minToHm(a.slot.startMin)}`,
    )
    .join(", ");
}

function RequestCard({
  tutee,
  order,
  tutors,
  assigned,
  fulfilled,
  onChanged,
  onFulfilled,
}: {
  tutee: PendingTutee;
  order: number;
  tutors: {
    id: string;
    englishName: string;
    active: boolean;
    user?: { username: string | null } | null;
  }[];
  /** subject (course name) → tutor display name, for choices already assigned. */
  assigned: Map<string, string>;
  fulfilled: boolean;
  onChanged: () => Promise<unknown> | void;
  onFulfilled: (tuteeId: string) => void;
}) {
  const t = useTranslations();
  const displayName = participantNameLabel(
    tutee.englishName,
    tutee.user?.username,
    t("participantNames.unnamed"),
  );
  const format = useFormatter();
  const locale = useLocale();
  const readOnly = useReadOnly();
  const account = api.account.me.useQuery().data;
  const { confirm, dialog } = useDialog();
  const [confirmCourse, setConfirmCourse] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const assign = api.admin.assignSignup.useMutation({
    onSuccess: (data) => {
      setConfirmCourse(null);
      if (data.fulfilled) onFulfilled(tutee.id);
      return onChanged();
    },
    onError: () => onChanged(), // refresh on a stale-write conflict
  });
  const del = api.admin.deleteTutee.useMutation({
    onSuccess: () => onChanged(),
  });

  const detailsId = useId();
  const choicesId = useId();
  // Collapse fulfilled requests by default; auto-collapse once a request becomes fulfilled.
  const [collapsed, setCollapsed] = useState(fulfilled);
  useEffect(() => {
    if (fulfilled) setCollapsed(true);
  }, [fulfilled]);

  // Always show both choice positions; a position the tutee left blank renders grayed/disabled
  // so the request stays in the queue and the admin can still assign whatever was provided.
  const positions = [
    {
      key: "first",
      label: t("admin.requests.firstChoice"),
      course: tutee.firstChoice,
    },
    {
      key: "second",
      label: t("admin.requests.secondChoice"),
      course: tutee.secondChoice,
    },
  ];
  const [picks, setPicks] = useState<Record<string, string>>({});

  const assignmentPayload = confirmCourse
    ? {
        tuteeId: tutee.id,
        expectedUpdatedAt: tutee.updatedAt,
        assignments: [
          {
            subject: confirmCourse.name,
            subjectId: confirmCourse.id,
            tutorId: picks[confirmCourse.name] ?? "",
          },
        ],
      }
    : null;
  const activeTutors = tutors.filter((tu) => tu.active);

  return (
    <div
      id={`request-signup-${tutee.id}`}
      className={`card scroll-mt-6 p-5 ${fulfilled ? "bg-slate-50" : ""}`}
    >
      {assignmentPayload && !tutee.isInvalid && (
        <WorkloadAssignmentConfirmation
          operation="admin.assignSignup"
          payload={assignmentPayload}
          onCancel={() => setConfirmCourse(null)}
          busy={assign.isPending}
          tutorId={picks[confirmCourse!.name] ?? ""}
          error={assign.error?.message}
          onConfirm={(overrideTicket) =>
            assign.mutateAsync({ ...assignmentPayload, overrideTicket })
          }
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {/* The small glyph sits inside a full touch target; its color override is row-local. */}
          <Button
            variant="ghost"
            size="compact"
            className="shrink-0 px-0 lg:min-w-8 [&>span]:text-slate-600"
            aria-expanded={!collapsed}
            aria-controls={`${detailsId} ${choicesId}`}
            aria-label={
              collapsed
                ? t("admin.requests.expand")
                : t("admin.requests.collapse")
            }
            onClick={() => setCollapsed((c) => !c)}
          >
            <DisclosureIcon open={!collapsed} />
          </Button>
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
              <span className="badge-slate mr-2">#{order}</span>
              <ParticipantName
                name={tutee.englishName}
                username={tutee.user?.username}
              />
              <span className="ml-2">
                <SignupSourceBadge source={tutee.signupSource} />
              </span>
              {tutee.gradeLevel
                ? ` · ${t("admin.requests.grade", { grade: tutee.gradeLevel })}`
                : ""}
              {fulfilled && (
                <span className="badge-green ml-2 text-green-800">
                  {t("admin.requests.fulfilled")}
                </span>
              )}
              {tutee.isInvalid && <InvalidityBadge />}
              {tutee.bannedMatch && (
                <span
                  className="badge-red ml-2"
                  title={t("admin.requests.banFlagTitle", {
                    fields: [
                      tutee.bannedMatch.name
                        ? t("admin.requests.banField.name")
                        : null,
                      tutee.bannedMatch.email
                        ? t("admin.requests.banField.email")
                        : null,
                      tutee.bannedMatch.phone
                        ? t("admin.requests.banField.phone")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", "),
                  })}
                >
                  {t("admin.requests.banFlag")}
                </span>
              )}
            </p>
            <div id={detailsId}>
              {!collapsed && (
                <>
                  <p className="muted text-xs">
                    {t("admin.requests.submitted", {
                      when: format.dateTime(
                        new Date(tutee.signupSubmittedAt ?? tutee.createdAt),
                        { dateStyle: "medium", timeStyle: "short" },
                      ),
                    })}
                  </p>
                  <p className="muted">
                    {t("admin.requests.available", {
                      list: availability(tutee.availabilities, locale),
                    })}
                  </p>
                  {tutee.preferredContact && (
                    <p className="muted">
                      {t("admin.requests.reach", {
                        contact: tutee.preferredContact,
                      })}
                    </p>
                  )}
                  <p className="muted">
                    {tutee.signedRulebook
                      ? t("admin.requests.signed", {
                          name: tutee.signatureName ?? "",
                        })
                      : t("admin.requests.notSigned")}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {!readOnly &&
            !tutee.unverified &&
            tutee.signupSource === "SELF_SERVICE" && (
              <SignupInvalidityControls
                record={tutee}
                name={displayName}
                canFlag
                coordinator={account?.role === "COORDINATOR"}
              />
            )}
          {!fulfilled && !readOnly && !tutee.unverified && !tutee.isInvalid && (
            <Button
              variant="danger"
              size="compact"
              className="shrink-0"
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.requests.declineConfirm", {
                      name: displayName,
                    }),
                    confirmLabel: t("common.confirm"),
                    cancelLabel: t("common.cancel"),
                    danger: true,
                  })
                )
                  del.mutate({ id: tutee.id });
              }}
            >
              {t("admin.requests.decline")}
            </Button>
          )}
        </div>
      </div>

      {tutee.isInvalid && (
        <div className="mt-3">
          <InvalidityNotice />
        </div>
      )}
      <div id={choicesId}>
        {!collapsed && (
          <div className="mt-3 ml-[3.25rem] flex flex-wrap items-center gap-x-2 text-sm lg:ml-10">
            <span>
              {t("workflow.emailStatus", {
                status: t(
                  tutee.unverified
                    ? "admin.requests.emailUnverifiedShort"
                    : "admin.requests.emailVerifiedShort",
                ),
              })}
            </span>
            <EmailDetails contactOnly email={tutee.email} name={displayName} />
          </div>
        )}
        {/* Assign each course choice to a tutor independently (workload shown in the dropdown). */}
        {!collapsed && tutee.unverified && (
          <div className="muted mt-3 ml-[3.25rem] space-y-2 border-t border-slate-100 pt-3 lg:ml-10">
            <p>
              {t("admin.requests.firstChoice")}:{" "}
              {tutee.firstChoice?.name ?? "—"}
              {tutee.secondChoice
                ? ` · ${t("admin.requests.secondChoice")}: ${tutee.secondChoice.name}`
                : ""}
            </p>
            <p>{t("survey.awaitingHelp")}</p>
          </div>
        )}
        {!collapsed && !tutee.unverified && (
          <div className="mt-3 ml-[3.25rem] space-y-3 border-t border-slate-100 pt-3 lg:ml-10">
            {positions.map((p) => {
              const filled = !!p.course;
              const assignedTo = filled
                ? assigned.get(p.course!.name)
                : undefined;
              const isAssigned = !!assignedTo;
              return (
                <div key={p.key} className="flex flex-wrap items-center gap-2">
                  {(isAssigned || readOnly || tutee.isInvalid) && (
                    <span className="min-w-0 text-sm text-slate-700">
                      {p.label}:{" "}
                      <span className="font-medium">
                        {filled
                          ? p.course!.name
                          : t("admin.requests.notProvided")}
                      </span>
                    </span>
                  )}
                  {isAssigned ? (
                    <span className="badge-green">
                      {t("admin.requests.assignedTo", { name: assignedTo })}
                    </span>
                  ) : readOnly || tutee.isInvalid ? (
                    filled && (
                      <span className="muted text-sm">
                        {t("admin.requests.assignToTutor")}
                      </span>
                    )
                  ) : (
                    <>
                      <QualifiedTutorSelect
                        leading={
                          <span className="min-w-0 text-sm text-slate-700">
                            {p.label}:{" "}
                            <span className="font-medium">
                              {filled
                                ? p.course!.name
                                : t("admin.requests.notProvided")}
                            </span>
                          </span>
                        }
                        actions={
                          <button
                            className="btn-primary min-h-11 lg:min-h-10"
                            disabled={
                              !filled ||
                              !picks[p.course!.name] ||
                              assign.isPending
                            }
                            onClick={() => setConfirmCourse(p.course)}
                          >
                            {assign.isPending
                              ? t("admin.requests.assigning")
                              : t("admin.requests.assign")}
                          </button>
                        }
                        label={t("admin.requests.assignToTutor")}
                        disabled={!filled}
                        subjectId={p.course?.id ?? ""}
                        value={filled ? (picks[p.course!.name] ?? "") : ""}
                        onChange={(value) => {
                          setConfirmCourse(null);
                          if (filled)
                            setPicks((prev) => ({
                              ...prev,
                              [p.course!.name]: value,
                            }));
                        }}
                        tutors={activeTutors}
                      />
                    </>
                  )}
                </div>
              );
            })}
            {assign.error && (
              <p className="text-sm text-red-600">{assign.error.message}</p>
            )}
            {(del.error ?? null) && (
              <p className="text-sm text-red-600">{del.error?.message}</p>
            )}
          </div>
        )}
        {dialog}
      </div>
    </div>
  );
}

export default function RequestsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const readOnly = useReadOnly();
  const tutees = api.admin.tutees.useQuery();
  const managed = api.studentWorkflow.adminRequests.useQuery(undefined, {
    enabled: !readOnly,
  });
  const tutors = api.admin.tutors.useQuery();
  const currentPeriod = api.admin.currentPeriod.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const pairings = api.admin.pairings.useQuery();
  const denied = useSessionAccessDenied(
    tutees,
    tutors,
    currentPeriod,
    pairings,
    ...(readOnly ? [] : [managed]),
  );
  const viewScope = currentPeriod.data?.termId ?? "no-active-period";
  const [observerInvalidity, setObserverInvalidity] =
    useSessionViewState<InvalidityFilterValue>({
      id: "requests.observer-invalidity.v1",
      initialState: "valid",
      parse: viewEnum(["valid", "invalid", "all"]),
      enabled: readOnly && !denied,
      scope: viewScope,
    });
  useSessionPageScroll({
    id: "requests-observer",
    scope: JSON.stringify([viewScope, observerInvalidity]),
    ready:
      !!tutees.data &&
      !!tutors.data &&
      !!pairings.data &&
      !currentPeriod.isLoading,
    enabled: readOnly && !denied,
  });

  const invalidate = () =>
    Promise.all([
      utils.admin.tutees.invalidate(),
      utils.admin.pairings.invalidate(),
      invalidateWorkloads(utils),
    ]);

  const hasPeriod = !!currentPeriod.data;

  // Requests fulfilled in this session stay visible (tagged + collapsed) instead of vanishing,
  // so the numbering of the remaining queue doesn't jump around mid-processing.
  const [retained, setRetained] = useState<Set<string>>(new Set());
  const onFulfilled = (id: string) =>
    setRetained((prev) => new Set(prev).add(id));

  // subject already assigned per tutee → tutor display name (from existing pairings).
  const assignedByTutee = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const p of pairings.data ?? []) {
      for (const pt of p.tutees) {
        const inner = m.get(pt.tutee.id) ?? new Map<string, string>();
        inner.set(
          p.subject,
          participantNameLabel(
            p.tutor.englishName,
            tutors.data?.find((tutor) => tutor.id === p.tutorId)?.user
              ?.username,
            t("participantNames.unnamed"),
          ),
        );
        m.set(pt.tutee.id, inner);
      }
    }
    return m;
  }, [pairings.data, tutors.data, t]);

  // Display = still-pending requests plus any retained-this-session (now ACTIVE) ones, earliest
  // first. Earliest-first keeps the priority order; retained items hold their original slot.
  const display = useMemo(
    () =>
      (tutees.data ?? [])
        .filter((t2) => !managed.data?.some((r) => r.tuteeId === t2.id))
        .filter((t2) =>
          isCurrentManualSignup(
            t2,
            currentPeriod.data?.termId,
            assignedByTutee.has(t2.id),
            retained.has(t2.id),
          ),
        )
        .sort(
          (a, b) =>
            +new Date(a.signupSubmittedAt ?? a.createdAt) -
            +new Date(b.signupSubmittedAt ?? b.createdAt),
        ),
    [
      tutees.data,
      managed.data,
      retained,
      currentPeriod.data?.termId,
      assignedByTutee,
    ],
  );

  const isFulfilled = (tutee: PendingTutee) => {
    const assigned = assignedByTutee.get(tutee.id) ?? new Map<string, string>();
    const provided = [tutee.firstChoice?.name, tutee.secondChoice?.name].filter(
      (n): n is string => !!n,
    );
    return provided.length > 0 && provided.every((c) => assigned.has(c));
  };

  if (denied)
    return (
      <p role="alert">
        {tutees.error?.message ??
          tutors.error?.message ??
          currentPeriod.error?.message ??
          pairings.error?.message ??
          managed.error?.message ??
          t("uiPatterns.loadFailed")}
      </p>
    );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.requests.title")}</h1>
        <p className="muted mt-1">{t("admin.requests.help")}</p>
      </div>
      <DisclosureSection title={t("workflow.sourceGuide")} lifetime="lazy">
        <p className="muted text-sm">{t("workflow.sourceHelp")}</p>
      </DisclosureSection>

      {!currentPeriod.isLoading && !hasPeriod && (
        <p className="text-sm text-red-600">{t("admin.requests.noTerm")}</p>
      )}

      {tutees.error && (
        <p role="alert" className="text-red-700">
          {tutees.error.message}
        </p>
      )}
      {!readOnly ? (
        <StudentRequestBoard
          viewScope={viewScope}
          viewDenied={denied}
          additionalLoading={
            tutees.isLoading ||
            managed.isLoading ||
            pairings.isLoading ||
            currentPeriod.isLoading
          }
          additionalEntries={
            hasPeriod
              ? display.map((t2, i) => ({
                  id: `manual-${t2.id}`,
                  sourceId: t2.id,
                  submittedAt: t2.signupSubmittedAt ?? t2.createdAt,
                  invalid: t2.isInvalid,
                  group: signupRequestGroup(
                    "OPEN",
                    [t2.firstChoice?.name, t2.secondChoice?.name].filter(
                      (name): name is string => !!name,
                    ),
                    [...(assignedByTutee.get(t2.id)?.keys() ?? [])],
                  ),
                  content: (
                    <RequestCard
                      tutee={t2}
                      order={i + 1}
                      tutors={(tutors.data ?? []).map((tu) => ({
                        id: tu.id,
                        englishName: tu.englishName,
                        user: tu.user,
                        active: isAssignableTutor(tu),
                      }))}
                      assigned={assignedByTutee.get(t2.id) ?? new Map()}
                      fulfilled={isFulfilled(t2)}
                      onChanged={invalidate}
                      onFulfilled={onFulfilled}
                    />
                  ),
                }))
              : []
          }
        />
      ) : (
        <div className="space-y-3">
          <InvalidityFilter
            value={observerInvalidity}
            onChange={setObserverInvalidity}
          />
          {hasPeriod &&
            display
              .filter(
                (row) =>
                  observerInvalidity === "all" ||
                  !!row.isInvalid === (observerInvalidity === "invalid"),
              )
              .map((t2, i) => (
                <RequestCard
                  key={t2.id}
                  tutee={t2}
                  order={i + 1}
                  tutors={[]}
                  assigned={assignedByTutee.get(t2.id) ?? new Map()}
                  fulfilled={isFulfilled(t2)}
                  onChanged={invalidate}
                  onFulfilled={onFulfilled}
                />
              ))}
        </div>
      )}
    </div>
  );
}
