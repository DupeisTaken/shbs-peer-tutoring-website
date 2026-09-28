"use client";

import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useDialog } from "~/app/_components/confirm-dialog";

const HISTORY_FILTERS = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "RECALLED",
] as const;
type HistoryFilter = (typeof HISTORY_FILTERS)[number];

/** Self-only query supplies choices, actual grants and history; pending intents never appear approved. */
export function QualificationRequests({ active }: { active: boolean }) {
  const t = useTranslations("qualificationRequests");
  const format = useFormatter();
  const utils = api.useUtils();
  const { confirm, dialog } = useDialog();
  const query = api.qualificationApplication.mine.useQuery();
  const [subjectId, setSubjectId] = useState("");
  const [reason, setReason] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("PENDING");
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const historyId = useId();
  // Interviews are still awaiting a decision. Derive groups from fresh query data
  // so recalls/decisions update counts without resetting the tutor's chosen filter.
  const historyGroups = HISTORY_FILTERS.map((status) => ({
    status,
    requests: (query.data?.requests ?? []).filter((request) =>
      status === "PENDING"
        ? request.status === "PENDING" || request.status === "INTERVIEW"
        : request.status === status,
    ),
  }));
  const visibleRequests =
    historyGroups.find((group) => group.status === historyFilter)?.requests ??
    [];
  // Refresh both participant history and staff/panel caches after withdrawing a request.
  const refreshRecall = () =>
    Promise.all([
      utils.qualificationApplication.mine.invalidate(),
      utils.admin.tutorApplications.invalidate(),
      utils.interviewManagement.options.invalidate(),
      utils.tutor.myInterviews.invalidate(),
    ]);
  const recall = api.qualificationApplication.recall.useMutation({
    onSuccess: async () => {
      submit.reset();
      await refreshRecall();
    },
    onError: refreshRecall,
  });
  const submit = api.qualificationApplication.submit.useMutation({
    onSuccess: async () => {
      recall.reset();
      setSubjectId("");
      setReason("");
      await utils.qualificationApplication.mine.invalidate();
    },
  });
  return (
    <section
      id="qualification-requests"
      className="card scroll-mt-6 p-4 sm:p-5"
    >
      <h2 className="section-title">{t("title")}</h2>
      {dialog}
      <p className="muted mt-1">{t("help")}</p>
      {query.isLoading && (
        <p role="status" className="mt-3">
          {t("loading")}
        </p>
      )}
      {query.error && (
        <div role="alert" className="mt-3">
          <p>{query.error.message}</p>
          <button
            className="btn-secondary mt-2 min-h-11 max-w-full whitespace-normal lg:min-h-9"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </button>
        </div>
      )}
      {query.data && (
        <>
          <h3 className="mt-4 font-semibold">{t("approved")}</h3>
          <p className="mt-1 text-sm">
            {query.data.approved.map((subject) => subject.name).join(", ") ||
              t("noApproved")}
          </p>
          {active && (
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (subjectId && reason.trim())
                  submit.mutate({ subjectId, reason });
              }}
            >
              <label
                className="block text-sm font-medium"
                htmlFor="qualification-subject"
              >
                {t("subject")}
              </label>
              <select
                id="qualification-subject"
                className="select min-h-11 lg:min-h-10"
                value={subjectId}
                required
                disabled={submit.isPending || !query.data.options.length}
                onChange={(event) => setSubjectId(event.target.value)}
              >
                <option value="">{t("choose")}</option>
                {query.data.options.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name} · {t(subject.type)}
                  </option>
                ))}
              </select>
              {!query.data.options.length && (
                <p className="muted text-sm">{t("noOptions")}</p>
              )}
              <label
                className="block text-sm font-medium"
                htmlFor="qualification-reason"
              >
                {t("reason")}
              </label>
              <textarea
                id="qualification-reason"
                className="textarea w-full"
                rows={3}
                required
                maxLength={2000}
                value={reason}
                disabled={submit.isPending}
                onChange={(event) => setReason(event.target.value)}
              />
              <button
                className="btn-primary min-h-11 max-w-full whitespace-normal lg:min-h-10"
                disabled={submit.isPending || !subjectId || !reason.trim()}
              >
                {submit.isPending ? t("saving") : t("submit")}
              </button>
              {submit.error && (
                <p role="alert" className="text-sm text-red-700">
                  {submit.error.message}
                </p>
              )}
              {submit.isSuccess && (
                <p role="status" className="text-sm text-green-700">
                  {t("submitted")}
                </p>
              )}
            </form>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t("history")}</h3>
            <button
              type="button"
              className="btn-secondary min-h-11 max-w-full gap-2 whitespace-normal lg:min-h-8 lg:py-0"
              aria-expanded={historyExpanded}
              aria-controls={historyId}
              onClick={() => setHistoryExpanded((expanded) => !expanded)}
            >
              {t(historyExpanded ? "collapseHistory" : "expandHistory")}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className={`h-4 w-4 shrink-0 ${historyExpanded ? "rotate-180" : ""}`}
              >
                <path d="m5 7.5 5 5 5-5" />
              </svg>
            </button>
          </div>
          {recall.error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {recall.error.message}
            </p>
          )}
          {recall.isSuccess && (
            <p role="status" className="mt-2 text-sm text-green-700">
              {t("recalled")}
            </p>
          )}
          <div id={historyId} hidden={!historyExpanded}>
            <div
              role="group"
              aria-label={t("historyFilters")}
              className="mt-3 flex flex-wrap gap-2"
            >
              {historyGroups.map((group) => (
                <button
                  key={group.status}
                  type="button"
                  aria-pressed={historyFilter === group.status}
                  onClick={() => setHistoryFilter(group.status)}
                  className={`${historyFilter === group.status ? "btn-primary" : "btn-secondary"} min-h-11 max-w-full gap-2 whitespace-normal lg:min-h-8 lg:py-0`}
                >
                  {t(
                    group.status === "PENDING" ? "pendingFilter" : group.status,
                  )}{" "}
                  <span className="rounded-full bg-current/10 px-1.5 text-xs tabular-nums">
                    {format.number(group.requests.length)}
                  </span>
                </button>
              ))}
            </div>
            {!visibleRequests.length && (
              <p role="status" className="muted mt-3">
                {t(query.data.requests.length ? "emptyFilter" : "empty")}
              </p>
            )}
            <ul className="mt-3 space-y-3">
              {visibleRequests.map((request) => (
                <li
                  key={request.id}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {request.requestedSubject?.name}
                    </span>
                    <span className="badge-slate">{t(request.type)}</span>
                    <span
                      className={
                        request.status === "ACCEPTED"
                          ? "badge-green"
                          : request.status === "REJECTED"
                            ? "badge-red"
                            : request.status === "RECALLED"
                              ? "badge-slate"
                              : "badge-amber"
                      }
                    >
                      {t(request.status)}
                    </span>
                  </div>
                  <p className="muted mt-1 text-xs">
                    {format.dateTime(request.createdAt, {
                      dateStyle: "medium",
                    })}
                  </p>
                  {request.recalledAt && (
                    <p className="muted mt-1 text-xs">
                      {t("recalledOn", {
                        date: format.dateTime(request.recalledAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })}
                    </p>
                  )}
                  {request.interviewAt && request.status !== "RECALLED" && (
                    <p className="mt-2 text-sm">
                      {t("scheduled", {
                        date: format.dateTime(request.interviewAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })}
                    </p>
                  )}
                  <p className="mt-2 text-sm break-words whitespace-pre-wrap">
                    {request.qualificationReason}
                  </p>
                  {request.decisionComment && (
                    <p className="mt-2 text-sm break-words whitespace-pre-wrap">
                      {t("result", { comment: request.decisionComment })}
                    </p>
                  )}
                  {!!request.qualificationSnapshot.length && (
                    <p className="mt-2 text-sm">
                      {t("granted", {
                        subjects: request.qualificationSnapshot
                          .map((subject) => subject.name)
                          .join(", "),
                      })}
                    </p>
                  )}
                  {active &&
                    (request.status === "PENDING" ||
                      request.status === "INTERVIEW") && (
                      <button
                        type="button"
                        className="btn-secondary mt-3 min-h-11 max-w-full whitespace-normal lg:min-h-8 lg:py-0"
                        disabled={recall.isPending}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: t("recallTitle"),
                              message: t("recallHelp", {
                                subject: request.requestedSubject?.name ?? "",
                              }),
                              confirmLabel: t("recall"),
                              cancelLabel: t("keepRequest"),
                            })
                          )
                            recall.mutate({
                              id: request.id,
                              expectedUpdatedAt: request.updatedAt,
                            });
                        }}
                      >
                        {recall.isPending && recall.variables?.id === request.id
                          ? t("recalling")
                          : t("recall")}
                      </button>
                    )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
