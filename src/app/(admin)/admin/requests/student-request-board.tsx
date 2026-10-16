"use client";
import { Button } from "~/app/_components/ui/button";
import { isAssignableTutor } from "~/lib/assignment-qualification";
import { QualifiedTutorSelect } from "~/app/_components/qualified-tutor-select";
import { AssignmentConfirmation } from "~/app/_components/assignment-confirmation";
import { useReadOnly } from "~/app/_components/read-only";
import { EmailDetails } from "~/app/_components/email-details";
import { SignupSourceBadge } from "~/app/_components/signup-source-badge";
import { StudentRequestInvalidityControls } from "~/app/_components/request-invalidity-controls";
import {
  InvalidityBadge,
  InvalidityFilter,
  InvalidityNotice,
  RequestInvalidityHost,
  type InvalidityFilterValue,
} from "~/app/_components/request-invalidity";
import { useState, type ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  bySignupPriority,
  signupRequestGroup,
  type RequestTab,
} from "~/lib/signup-request-groups";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { formatWeekday, minToHm } from "~/lib/time";

import { SectionTabs } from "~/app/_components/ui/section-tabs";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import { useSessionAccessDenied, useSessionPageScroll, useSessionViewState } from "~/app/_components/session-view-state";
import { viewEnum } from "~/lib/session-view-state";
import { ParticipantName, participantNameLabel } from "~/app/_components/participant-name";

type Row = RouterOutputs["studentWorkflow"]["adminRequests"][number];
type Tutor = { id: string; englishName: string; user?: { username: string | null } | null };
export type AdditionalRequestEntry = {
  id: string;
  submittedAt: Date;
  group: Exclude<RequestTab, "reviews">;
  content: ReactNode;
  invalid?: boolean;
};
export function StudentRequestBoard({
  additionalEntries = [],
  additionalLoading = false,
  viewScope = "",
  viewDenied = false,
}: {
  additionalEntries?: AdditionalRequestEntry[];
  additionalLoading?: boolean;
  viewScope?: string;
  viewDenied?: boolean;
}) {
  const t = useTranslations("workflow");
  const ui = useTranslations("uiPatterns");
  const rows = api.studentWorkflow.adminRequests.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const tutors = api.admin.tutors.useQuery();
  const legacyReviews = api.studentWorkflow.legacyReviews.useQuery();
  const legacyProcessed = (legacyReviews.data ?? []).filter(
    (r) => r.state !== "PENDING",
  );
  const queryDenied = useSessionAccessDenied(rows, tutors, legacyReviews);
  const denied = viewDenied || queryDenied;
  const [tab, setTab] = useSessionViewState({ id: "requests.tab.v1", initialState: "matching",
    parse: viewEnum(["matching", "assigned", "reviews", "processed"]), scope: viewScope,
    // A static panel choice is usable before its queue reads finish; only scroll waits for content.
    enabled: !denied });
  const [invalidity, setInvalidity] = useSessionViewState<InvalidityFilterValue>({ id: "requests.invalidity.v1", initialState: "valid",
    parse: viewEnum(["valid", "invalid", "all"]), scope: viewScope, enabled: !denied });
  useSessionPageScroll({ id: "requests", scope: JSON.stringify([viewScope, tab, invalidity]),
    ready: !additionalLoading && !!rows.data && !!tutors.data && !!legacyReviews.data, enabled: !denied });
  const matchingValidity = (invalid: boolean) =>
    invalidity === "all" || invalid === (invalidity === "invalid");
  const visibleRows = (rows.data ?? []).filter((row) =>
    matchingValidity(row.isInvalid),
  );
  const visibleAdditional = additionalEntries.filter((entry) =>
    matchingValidity(!!entry.invalid),
  );
  const groups = {
    matching: visibleRows.filter(
      (r) =>
        signupRequestGroup(
          r.state,
          r.subjects.map((s) => s.name),
          r.pairings.map((p) => p.subject),
        ) === "matching",
    ),
    assigned: visibleRows.filter(
      (r) =>
        signupRequestGroup(
          r.state,
          r.subjects.map((s) => s.name),
          r.pairings.map((p) => p.subject),
        ) === "assigned",
    ),
    reviews: [
      ...(rows.data ?? []).flatMap((row) =>
        row.reviews
          .filter((review) => review.state === "PENDING")
          .map((review) => ({ row, review })),
      ),
      ...(legacyReviews.data ?? [])
        .filter((r) => r.state === "PENDING")
        .map((review) => ({ row: { name: review.name }, review })),
    ],
    processed: visibleRows.filter((r) => r.state !== "OPEN"),
  };
  if (denied) return <p role="alert">{rows.error?.message ?? legacyReviews.error?.message ?? tutors.error?.message ?? ui("loadFailed")}</p>;
  return (
    <RequestInvalidityHost>
      <section className="space-y-4">
        <DisclosureSection title={t("boardGuide")} lifetime="lazy">
          <p className="muted max-w-3xl text-sm">{t("boardHelp")}</p>
        </DisclosureSection>
        {rows.error && (
          <p role="alert" className="text-red-700">
            {rows.error.message}
          </p>
        )}
        {legacyReviews.error && (
          <p role="alert" className="text-red-700">
            {legacyReviews.error.message}
          </p>
        )}
        {/* Counts and priority remain feature-owned; shared tabs supply manual keyboard activation. */}
        <SectionTabs
          label={t("navigation")}
          items={(
            ["matching", "assigned", "reviews", "processed"] as const
          ).map((value) => ({
            value,
            label: `${t(value)} ${groups[value].length + visibleAdditional.filter((entry) => entry.group === value).length + (value === "processed" && invalidity !== "invalid" ? legacyProcessed.length : 0)}`,
          }))}
          value={tab}
          onChange={setTab}
        >
          {tab !== "reviews" && (
            <InvalidityFilter value={invalidity} onChange={setInvalidity} />
          )}
          <div className="space-y-3">
            {rows.isLoading || additionalLoading ? (
              <p>{t("loading")}</p>
            ) : tab === "reviews" ? (
              groups.reviews.map(({ row, review }) => (
                <ReviewCard key={review.id} row={row} review={review} />
              ))
            ) : (
              bySignupPriority([
                ...groups[tab].map((row) => ({
                  id: row.id,
                  submittedAt: row.submittedAt,
                  content: (
                    <RequestCard
                      row={row}
                      tutors={(tutors.data ?? []).filter(isAssignableTutor)}
                    />
                  ),
                })),
                ...visibleAdditional.filter((entry) => entry.group === tab),
              ]).map((entry) => <div key={entry.id}>{entry.content}</div>)
            )}
            {tab === "processed" &&
              invalidity !== "invalid" &&
              legacyProcessed.map((r) => (
                <article key={r.id} className="card space-y-2 p-5">
                  <h3 className="font-semibold">
                    {r.name} ·{" "}
                    {t(
                      r.kind === "STUDENT_ABORT"
                        ? "applyAbort"
                        : "scheduleReject",
                    )}
                  </h3>
                  <span className="badge-slate">
                    {t(`reviewState.${r.state}`)}
                  </span>
                  <p className="muted text-sm">{r.reason}</p>
                </article>
              ))}
            {!rows.isLoading &&
              !additionalLoading &&
              !visibleAdditional.some((entry) => entry.group === tab) &&
              !groups[tab].length &&
              !(
                tab === "processed" &&
                invalidity !== "invalid" &&
                legacyProcessed.length
              ) && (
                <p className="muted rounded-xl border border-dashed border-slate-200 p-8 text-center">
                  {t("emptySection")}
                </p>
              )}
          </div>
        </SectionTabs>
      </section>
    </RequestInvalidityHost>
  );
}
function RequestCard({ row, tutors }: { row: Row; tutors: Tutor[] }) {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations("workflow");
  const requests = useTranslations("admin.requests");
  const names = useTranslations("participantNames");
  const displayName = participantNameLabel(row.name, row.username, names("unnamed"));
  const utils = api.useUtils();
  const readOnly = useReadOnly();
  const account = api.account.me.useQuery().data;
  const resend = api.studentWorkflow.resend.useMutation({
    onSuccess: () => utils.studentWorkflow.adminRequests.invalidate(),
  });
  return (
    <article className="card space-y-4 p-5">
      <header className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold break-words"><ParticipantName name={row.name} username={row.username} /></h3>
            <SignupSourceBadge source="SELF_SERVICE" />
            {row.isInvalid && <InvalidityBadge />}
            {row.state !== "OPEN" && (
              <span className="badge-slate">{t(`state.${row.state}`)}</span>
            )}
            {row.editedAt && <span className="badge-amber">{t("edited")}</span>}
          </div>
          <p className="muted text-xs">
            {t("priority", {
              time: format.dateTime(new Date(row.submittedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
          {/* Verification belongs once in the contact summary, not a second
           * identity badge. Contextual labels avoid "Email: Email verified". */}
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <span>
              {t("emailStatus", {
                status: requests(
                  row.confirmedAt
                    ? "emailVerifiedShort"
                    : "emailUnverifiedShort",
                ),
              })}
            </span>
            <EmailDetails contactOnly email={row.email} name={displayName} />
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {!readOnly && (
            <StudentRequestInvalidityControls
              record={row}
              name={displayName}
              canFlag={row.state === "OPEN" || row.isInvalid}
              coordinator={account?.role === "COORDINATOR"}
            />
          )}
          {!readOnly && row.state === "OPEN" && !row.confirmedAt && (
            <Button
              size="compact"
              className="self-start"
              disabled={resend.isPending || row.isInvalid}
              onClick={() => resend.mutate({ id: row.id })}
            >
              {t("resend")}
            </Button>
          )}
        </div>
      </header>
      {row.isInvalid && <InvalidityNotice />}
      {!row.confirmedAt && row.verificationDueAt && row.state === "OPEN" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t("deadline", {
            time: format.dateTime(new Date(row.verificationDueAt), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
      )}
      {resend.isSuccess && (
        <p role="status" className="text-sm">
          {t(resend.data.emailSent ? "resendSent" : "resendFailed")}
        </p>
      )}
      {resend.error && (
        <p role="alert" className="text-red-700">
          {resend.error.message}
        </p>
      )}
      <div className="grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
        <div>
          <p className="muted break-words">{row.contact}</p>
        </div>
        <div>
          <p className="font-medium">{t("availability")}</p>
          <p className="muted mt-1">
            {row.slots
              .map(
                (s) =>
                  `${formatWeekday(s.dayOfWeek, locale)} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
              )
              .join(", ")}
          </p>
        </div>
      </div>
      {row.state === "OPEN" ? (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          {row.subjects.map((subject) => (
            <Assignment
              key={subject.id}
              row={row}
              subject={subject}
              tutors={tutors}
            />
          ))}
        </div>
      ) : (
        <p className="muted text-sm">
          {t(row.state === "ABORTED" ? "abortFinal" : "closedFinal")}
        </p>
      )}
      {row.reviews.some((r) => r.state !== "PENDING") && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">
            {t("reviewHistory")}
          </summary>
          <ul className="mt-3 space-y-2">
            {row.reviews
              .filter((r) => r.state !== "PENDING")
              .map((r) => (
                <li key={r.id}>
                  {t(
                    r.kind === "STUDENT_ABORT"
                      ? "applyAbort"
                      : "scheduleReject",
                  )}{" "}
                  · {t(`reviewState.${r.state}`)}
                  <p className="muted">{r.reason}</p>
                </li>
              ))}
          </ul>
        </details>
      )}
    </article>
  );
}
function Assignment({
  row,
  subject,
  tutors,
}: {
  row: Row;
  subject: { id: string; name: string };
  tutors: Tutor[];
}) {
  const t = useTranslations("workflow");
  const names = useTranslations("participantNames");
  const utils = api.useUtils();
  const [tutorId, setTutorId] = useState("");
  const [open, setOpen] = useState(false);
  const [consequenceTicket, setConsequenceTicket] = useState<string | null>(
    null,
  );
  const readOnly = useReadOnly();
  const assign = api.studentWorkflow.assign.useMutation({
    onSuccess: async () => {
      setOpen(false);
      setConsequenceTicket(null);
      await Promise.all([
        utils.studentWorkflow.adminRequests.invalidate(),
        utils.admin.tutees.invalidate(),
        utils.admin.pairings.invalidate(),
      ]);
    },
  });
  const pairing = row.pairings.find((p) => p.subject === subject.name);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {(pairing !== undefined || readOnly || row.isInvalid) && (
        <span className="min-w-0 text-sm font-medium">{subject.name}</span>
      )}
      {pairing ? (
        <span className="badge-green"><ParticipantName name={pairing.tutor.englishName} username={pairing.tutor.user?.username} /></span>
      ) : !readOnly && !row.isInvalid ? (
        <>
          <QualifiedTutorSelect
            leading={<span className="font-medium">{subject.name}</span>}
            actions={
              <button
                className="btn-primary min-h-11 lg:min-h-10"
                disabled={!tutorId}
                onClick={() => setOpen(true)}
              >
                {t("assign")}
              </button>
            }
            label={t("chooseTutor", { subject: subject.name })}
            tutors={tutors}
            optionLabel={(id) => {
              const tutor = tutors.find((candidate) => candidate.id === id);
              return participantNameLabel(tutor?.englishName, tutor?.user?.username, names("unnamed"));
            }}
            subjectId={subject.id}
            value={tutorId}
            onChange={(value) => {
              setOpen(false);
              setConsequenceTicket(null);
              setTutorId(value);
            }}
          />
        </>
      ) : null}
      {assign.isSuccess && !assign.data.emailSent && (
        <p role="status" className="text-amber-800">
          {t("resendFailed")}
        </p>
      )}
      {consequenceTicket && !row.isInvalid && (
        <AssignmentConfirmation
          operation="studentWorkflow.assign"
          payload={{
            id: row.id,
            subjectId: subject.id,
            tutorId,
            ticket: consequenceTicket,
          }}
          busy={assign.isPending}
          error={assign.error?.message}
          onCancel={() => setConsequenceTicket(null)}
          onConfirm={(overrideTicket) =>
            assign.mutate({
              id: row.id,
              subjectId: subject.id,
              tutorId,
              ticket: consequenceTicket,
              overrideTicket,
            })
          }
        />
      )}
      {open && !row.isInvalid && (
        <TimedActionDialog
          key={`${row.id}:${subject.id}:${tutorId}`}
          action="ASSIGN"
          target={row.id}
          title={t("assignTitle", { name: participantNameLabel(row.name, row.username, names("unnamed")) })}
          message={`${subject.name} → ${participantNameLabel(tutors.find((tu) => tu.id === tutorId)?.englishName, tutors.find((tu) => tu.id === tutorId)?.user?.username, names("unnamed"))}\n\n${t(row.confirmedAt ? "assignVerifiedConsequences" : "assignConsequences")}`}
          busy={assign.isPending}
          error={assign.error?.message}
          onCancel={() => setOpen(false)}
          onConfirm={(ticket) => {
            setOpen(false);
            setConsequenceTicket(ticket);
          }}
        />
      )}
    </div>
  );
}
function ReviewCard({
  row,
  review,
}: {
  row: Pick<Row, "name">;
  review: Row["reviews"][number];
}) {
  const t = useTranslations("workflow");
  const utils = api.useUtils();
  const [decision, setDecision] = useState<boolean | null>(null);
  const resolve = api.studentWorkflow.resolveReview.useMutation({
    onSuccess: async () => {
      setDecision(null);
      await Promise.all([
        utils.studentWorkflow.adminRequests.invalidate(),
        utils.studentWorkflow.legacyReviews.invalidate(),
        utils.admin.tutees.invalidate(),
        utils.admin.pairings.invalidate(),
      ]);
    },
  });
  return (
    <article className="card space-y-4 p-5">
      <div>
        <span className="badge-amber">{t("needsReview")}</span>
        <h3 className="mt-2 font-semibold">
          {row.name} ·{" "}
          {t(review.kind === "STUDENT_ABORT" ? "applyAbort" : "scheduleReject")}
        </h3>
        {review.assignment && (
          <p className="muted mt-2 text-sm">
            {review.assignment.subject} · {review.assignment.tutor.englishName}
          </p>
        )}
      </div>
      <p className="rounded-lg bg-slate-50 p-4 text-sm whitespace-pre-wrap">
        {review.reason}
      </p>
      <div className="flex gap-3">
        <button className="btn-danger btn-sm" onClick={() => setDecision(true)}>
          {t("approve")}
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={() => setDecision(false)}
        >
          {t("deny")}
        </button>
      </div>
      {decision !== null && (
        <TimedActionDialog
          action={decision ? "APPROVE" : "DENY"}
          target={review.id}
          title={t(decision ? "approve" : "deny")}
          message={`${row.name}${review.assignment ? ` · ${review.assignment.subject} · ${review.assignment.tutor.englishName}` : ""}\n\n${t(
            !decision
              ? "denyConsequences"
              : review.kind === "STUDENT_ABORT"
                ? "approveAbortConsequences"
                : "approveScheduleConsequences",
          )}`}
          busy={resolve.isPending}
          error={resolve.error?.message}
          onCancel={() => setDecision(null)}
          onConfirm={(ticket) =>
            resolve.mutate({ id: review.id, approve: decision, ticket })
          }
        />
      )}
    </article>
  );
}
