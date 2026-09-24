"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";

/** Self-only query supplies choices, actual grants and history; pending intents never appear approved. */
export function QualificationRequests({ active }: { active: boolean }) {
  const t = useTranslations("qualificationRequests");
  const format = useFormatter();
  const utils = api.useUtils();
  const query = api.qualificationApplication.mine.useQuery();
  const [subjectId, setSubjectId] = useState("");
  const [reason, setReason] = useState("");
  const submit = api.qualificationApplication.submit.useMutation({
    onSuccess: async () => {
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
          <h3 className="mt-6 font-semibold">{t("history")}</h3>
          {!query.data.requests.length && (
            <p className="muted mt-1">{t("empty")}</p>
          )}
          <ul className="mt-3 space-y-3">
            {query.data.requests.map((request) => (
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
                          : "badge-amber"
                    }
                  >
                    {t(request.status)}
                  </span>
                </div>
                <p className="muted mt-1 text-xs">
                  {format.dateTime(request.createdAt, { dateStyle: "medium" })}
                </p>
                {request.interviewAt && (
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
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
