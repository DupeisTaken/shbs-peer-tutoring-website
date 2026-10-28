"use client";
import { RoomAllocationStatus } from "~/app/_components/room-allocation-status";
import { pairingScheduleText } from "~/lib/pairing-schedule";
import { formText } from "~/lib/form-values";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import {
  useSessionPageScroll,
  useSessionViewState,
} from "./session-view-state";
import { viewPage } from "~/lib/session-view-state";
import { ParticipantName } from "./participant-name";
import { ProgramCalendarNotice } from "./program-calendar";
import { SchoolCalendarNotice } from "./school-calendar-notice";
import { SessionAgenda } from "./session-agenda";

/** Pending and valid cards may be appealed once while their school-day window is open. */
export function canSubmitCardAppeal({
  reviewStatus,
  hasExistingAppeal,
  deadline,
  now = new Date(),
}: {
  reviewStatus: "PENDING" | "VALID" | "INVALID";
  hasExistingAppeal: boolean;
  deadline: Date;
  now?: Date;
}) {
  return reviewStatus !== "INVALID" && !hasExistingAppeal && deadline >= now;
}

export function StudentPortal({
  view = "all",
  viewScope = "",
}: {
  view?: "all" | "schedule" | "attendance" | "support";
  viewScope?: string;
}) {
  const programFormat = useFormatter();
  const locale = useLocale();
  const t = useTranslations("workflows");
  const recovery = useTranslations("participantRecovery");
  const cardStatus = useTranslations("admin.cards.reviewStatus");
  const cardColor = useTranslations("tutor.attendance");
  const portal = useTranslations("tuteePortal");
  const attendance = useTranslations("tutor.attendance.tuteeStatusOpt");
  const scheduling = useTranslations("scheduling");
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const [page, setPage] = useSessionViewState({
    id: "student-session-page-v1",
    scope: `${viewScope}:${view}`,
    initialState: 0,
    parse: viewPage,
    enabled: !denied,
  });
  const data = api.student.me.useQuery({ page }, { enabled: !denied });
  const authorizationDenied =
    data.error?.data?.code === "FORBIDDEN" ||
    data.error?.data?.code === "UNAUTHORIZED";
  useSessionPageScroll({
    id: "student-portal-v1",
    scope: `${viewScope}:${view}:${page}`,
    ready: !!data.data,
    enabled: !denied && !authorizationDenied,
  });
  useEffect(() => {
    if (!authorizationDenied) return;
    // Revoke every cached page of this private feed, not unrelated participant reads.
    setDenied(true);
    queryClient.removeQueries({
      queryKey: getQueryKey(api.student.me, undefined, "query"),
    });
  }, [authorizationDenied, queryClient]);
  useEffect(() => {
    if (data.isSuccess && !data.isFetching) setDenied(false);
  }, [data.isSuccess, data.isFetching]);
  const shared = api.student.feedbackSettings.useQuery(undefined, {
    enabled: view === "all" || view === "attendance",
  });
  const [appealingCard, setAppealingCard] = useState<string | null>(null);
  const [appealBody, setAppealBody] = useState("");
  const [acceptedAppeals, setAcceptedAppeals] = useState<Set<string>>(
    () => new Set(),
  );
  const submittingAppeal = useRef(false);
  const appeal = api.student.appeal.useMutation({
    onSuccess: (_result, variables) => {
      // Accepted writes are final even when the following read fails. Never offer a replay.
      setAcceptedAppeals((ids) => new Set(ids).add(variables.cardId));
      setAppealingCard(null);
      return data.refetch();
    },
    onSettled: () => {
      submittingAppeal.current = false;
    },
  });
  const retry = () => {
    void data.refetch();
  };
  const readBlocked =
    !!data.error || denied || authorizationDenied || !data.data;
  const feedback = (
    <QueryFeedback
      hasData={!!data.data}
      loading={!data.data && !data.error}
      error={!!data.error}
      retrying={data.isFetching}
      loadingTitle={recovery("loading")}
      errorTitle={recovery(data.data ? "refreshFailed" : "loadFailed")}
      retryLabel={recovery("retry")}
      onRetry={retry}
    />
  );
  if (denied || authorizationDenied)
    return (
      <StatePanel
        kind="denied"
        title={recovery("accessDenied")}
        action={
          <Button size="compact" disabled={data.isFetching} onClick={retry}>
            {recovery("retry")}
          </Button>
        }
      >
        {recovery("accessDeniedHelp")}
      </StatePanel>
    );
  if (!data.data) return feedback;
  const { schedule, sessions, cards, appeals } = data.data;
  const selectedCard = cards.find((card) => card.id === appealingCard);
  const appealAllowed =
    !readBlocked &&
    selectedCard &&
    !acceptedAppeals.has(selectedCard.id) &&
    canSubmitCardAppeal(selectedCard);
  const closeAppeal = () => {
    if (!appeal.isPending && !submittingAppeal.current) setAppealingCard(null);
  };
  return (
    <div className="space-y-6">
      {feedback}
      {appealingCard && (
        <Modal
          title={t("appeal")}
          busy={appeal.isPending}
          onClose={closeAppeal}
          footer={
            <>
              <Button disabled={appeal.isPending} onClick={closeAppeal}>
                {t("cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={
                  !appealAllowed || !appealBody.trim() || appeal.isPending
                }
                onClick={() => {
                  if (
                    !appealAllowed ||
                    !appealBody.trim() ||
                    submittingAppeal.current
                  )
                    return;
                  submittingAppeal.current = true;
                  appeal.mutate({
                    cardId: appealingCard,
                    body: appealBody.trim(),
                  });
                }}
              >
                {t("submit")}
              </Button>
            </>
          }
        >
          {/* A read failure leaves the appeal draft mounted and makes Retry reachable in the dialog. */}
          {feedback}
          <label className="block space-y-1">
            <span className="label">{t("body")}</span>
            <textarea
              data-dialog-autofocus
              disabled={appeal.isPending}
              className="textarea"
              rows={3}
              value={appealBody}
              onChange={(event) => setAppealBody(event.target.value)}
            />
          </label>
          {appeal.error && <p role="alert">{appeal.error.message}</p>}
        </Modal>
      )}
      {(view === "all" || view === "schedule") && (
        <section className="space-y-5">
          <SessionAgenda role="tutee" />
          <div className="card p-4 sm:p-5">
            <h2 className="section-title">{portal("weeklyArrangements")}</h2>
            <ProgramCalendarNotice />
            <SchoolCalendarNotice />
            {!schedule.length && (
              <p className="muted mt-3">{portal("scheduleEmpty")}</p>
            )}
            {schedule.map((p) => (
              <div key={p.id} className="mt-3 rounded-lg bg-slate-50 p-4">
                <p className="font-semibold">
                  {p.subject} ·{" "}
                  <ParticipantName
                    name={p.tutor.englishName}
                    username={p.tutor.user?.username}
                  />
                </p>
                <p className="muted">
                  {pairingScheduleText(p, scheduling("awaiting"), locale)}
                </p>
                <RoomAllocationStatus pairing={p} />
              </div>
            ))}
          </div>
        </section>
      )}
      {(view === "all" || view === "attendance") && (
        <section className="card space-y-4 p-6">
          {view === "all" && (
            <h2 className="section-title">{t("attendance")}</h2>
          )}
          {shared.error ? (
            <InlineNotice
              tone="warning"
              announcement="alert"
              action={
                <Button
                  size="compact"
                  disabled={shared.isFetching}
                  onClick={() => void shared.refetch()}
                >
                  {recovery("retry")}
                </Button>
              }
            >
              {t("feedbackVisibilityUnavailable")}
            </InlineNotice>
          ) : typeof shared.data === "boolean" ? (
            <p className="muted text-sm">
              {t(shared.data ? "sharedFeedback" : "privateFeedback")}
            </p>
          ) : (
            <p role="status" className="muted text-sm">
              {t("feedbackVisibilityLoading")}
            </p>
          )}
          {!sessions.length && <p>{t("empty")}</p>}
          {sessions.map((row) => (
            <div
              key={row.session.id}
              className="rounded-lg border border-slate-200 p-4"
            >
              <p className="font-medium">
                {programFormat.dateTime(row.session.date, {
                  dateStyle: "medium",
                  timeZone: "UTC",
                })}{" "}
                · {row.session.pairing.subject} · {attendance(row.status)}
              </p>
              <FeedbackForm
                sessionId={row.session.id}
                initial={row.feedback}
                readBlocked={readBlocked}
              />
            </div>
          ))}
        </section>
      )}
      {(view === "all" || view === "support") && (
        <>
          <section className="card space-y-4 p-6">
            <h2 className="section-title">{t("cards")}</h2>
            {!cards.length && <p className="muted">{t("empty")}</p>}
            {cards.map((card) => (
              <div
                key={card.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span
                    className={
                      card.color === "RED" ? "badge-red" : "badge-amber"
                    }
                  >
                    {cardColor(card.color === "RED" ? "red" : "yellow")}
                  </span>
                  <span
                    className={
                      card.reviewStatus === "VALID"
                        ? "badge-green"
                        : card.reviewStatus === "INVALID"
                          ? "badge-slate"
                          : "badge-amber"
                    }
                  >
                    {cardStatus(card.reviewStatus)}
                  </span>
                </p>
                <p>{card.reason}</p>
                <p className="muted text-xs">
                  {t("deadline")}:{" "}
                  {programFormat.dateTime(card.deadline, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                {card.reviewStatus !== "INVALID" && (
                  <button
                    className="btn-secondary mt-3"
                    disabled={
                      readBlocked ||
                      appeal.isPending ||
                      acceptedAppeals.has(card.id) ||
                      !canSubmitCardAppeal({
                        reviewStatus: card.reviewStatus,
                        hasExistingAppeal: card.hasExistingAppeal,
                        deadline: card.deadline,
                      })
                    }
                    onClick={() => {
                      if (readBlocked) return;
                      setAppealBody("");
                      setAppealingCard(card.id);
                    }}
                  >
                    {t("appeal")}
                  </button>
                )}
              </div>
            ))}
            {appeal.error && <p role="alert">{appeal.error.message}</p>}
          </section>
          <section className="card space-y-3 p-6">
            <h2 className="section-title">{t("appeals")}</h2>
            {!appeals.length && <p className="muted">{t("empty")}</p>}
            {appeals.map((a) => (
              <div key={a.id} className="border-b border-slate-100 py-3">
                <p>{a.body}</p>
                <p className="muted">
                  <span
                    className={
                      a.state === "PENDING" ? "badge-amber" : "badge-slate"
                    }
                  >
                    {t(
                      a.state === "PENDING"
                        ? "pendingAppeals"
                        : "resolvedAppeals",
                    )}
                  </span>
                  {a.decision && <span className="ml-2">{a.decision}</span>}
                </p>
              </div>
            ))}
          </section>
        </>
      )}
      {view !== "schedule" && (
        <Pager
          page={page}
          setPage={setPage}
          more={
            (view !== "support" && sessions.length === 20) ||
            (view !== "attendance" &&
              (cards.length === 20 || appeals.length === 20))
          }
        />
      )}
    </div>
  );
}
function FeedbackForm({
  sessionId,
  initial,
  readBlocked,
}: {
  sessionId: string;
  initial: { rating: number; body: string } | null;
  readBlocked: boolean;
}) {
  const t = useTranslations("workflows");
  const submitting = useRef(false);
  const save = api.student.feedback.useMutation({
    onSettled: () => {
      submitting.current = false;
    },
  });
  return (
    <details className="mt-3">
      <summary className="link cursor-pointer">{t("feedback")}</summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (readBlocked || save.isPending || submitting.current) return;
          const d = new FormData(e.currentTarget);
          submitting.current = true;
          save.mutate({
            sessionId,
            rating: Number(d.get("rating")),
            body: formText(d, "body"),
          });
        }}
      >
        {/* Freeze only this session's draft; uncontrolled fields survive failed saves and reads. */}
        <fieldset
          disabled={readBlocked || save.isPending}
          aria-busy={save.isPending}
          className="min-w-0 space-y-3"
          onChange={() => {
            // A receipt describes the submitted draft, not a later edit of these retained fields.
            if (!save.isPending && (save.isSuccess || save.error)) save.reset();
          }}
        >
          <label className="block">
            <span className="label">{t("rating")}</span>
            <input
              className="input w-24"
              type="number"
              name="rating"
              min={1}
              max={5}
              required
              defaultValue={initial?.rating ?? 4}
            />
          </label>
          <label className="block">
            <span className="label">{t("body")}</span>
            <textarea
              name="body"
              defaultValue={initial?.body ?? ""}
              className="input w-full"
              maxLength={2000}
              required
            />
          </label>
          <button
            className="btn-primary"
            disabled={readBlocked || save.isPending}
          >
            {t("save")}
          </button>
        </fieldset>
        {save.isSuccess && <p role="status">{t("saved")}</p>}
        {save.error && <p role="alert">{save.error.message}</p>}
      </form>
    </details>
  );
}
export function Pager({
  page,
  setPage,
  more,
  label,
}: {
  page: number;
  setPage: (p: number) => void;
  more: boolean;
  label?: string;
}) {
  const t = useTranslations("workflows");
  return (
    <nav
      aria-label={label ?? t("pagination")}
      className="flex flex-wrap items-center gap-2"
    >
      {/* APIs expose only a next-page signal; never imply an unknown total. */}
      <Button size="compact" disabled={!page} onClick={() => setPage(page - 1)}>
        {t("previous")}
      </Button>
      <span role="status" className="muted text-sm">
        {t("page", { page: page + 1 })}
      </span>
      <Button size="compact" disabled={!more} onClick={() => setPage(page + 1)}>
        {t("next")}
      </Button>
    </nav>
  );
}
