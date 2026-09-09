"use client";
import { formText, formTexts } from "~/lib/form-values";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
export function InterviewManagement() {
  const t = useTranslations("workflows");
  const utils = api.useUtils();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
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
      // Interview completion changes both the open and historical queues.
      await utils.interviewManagement.options.invalidate();
    },
  });
  if (data.error) return <p role="alert">{data.error.message}</p>;
  if (!data.data) return <p>{t("loading")}</p>;
  const { tutors, subjects, qualifications, applications } = data.data;
  const first = applications.total === 0 ? 0 : page * applications.pageSize + 1;
  const last = Math.min(
    applications.total,
    (page + 1) * applications.pageSize,
  );
  return (
    <div className="space-y-6">
      <p className="muted">{t("allVotes")}</p>
      <section className="card space-y-4 p-6">
        <h2 className="section-title">{t("qualified")}</h2>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            qualify.mutate({
              tutorId: formText(f, "tutorId"),
              subjectId: formText(f, "subjectId"),
              qualified: true,
            });
          }}
        >
          <label>
            <span className="label">{t("tutor")}</span>
            <select name="tutorId" className="input block" required>
              <option value="">—</option>
              {tutors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.englishName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">{t("subject")}</span>
            <select name="subjectId" className="input block" required>
              <option value="">—</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary" disabled={qualify.isPending}>
            {t("addQualification")}
          </button>
        </form>
        {qualifications.map((q) => (
          <div
            key={`${q.tutorId}:${q.subjectId}`}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-3"
          >
            <p>
              {tutors.find((p) => p.id === q.tutorId)?.englishName ?? q.tutorId}{" "}
              ·{" "}
              {subjects.find((s) => s.id === q.subjectId)?.name ?? q.subjectId}
            </p>
            <button
              className="btn-secondary btn-sm"
              disabled={qualify.isPending}
              onClick={() => qualify.mutate({ ...q, qualified: false })}
            >
              {t("removeQualification")}
            </button>
          </div>
        ))}
      </section>
      <section className="space-y-4">
        <h2 className="section-title">{t("interviewComplete")}</h2>
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <form
            className="flex min-w-64 flex-1 items-end gap-2"
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
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </label>
            <button className="btn-secondary" type="submit">
              {t("interviewSearch")}
            </button>
          </form>
          <label>
            <span className="label">{t("interviewFilter")}</span>
            <select
              className="select"
              value={completion}
              onChange={(event) => {
                setPage(0);
                setCompletion(
                  event.target.value as "OPEN" | "COMPLETED" | "ALL",
                );
              }}
            >
              <option value="OPEN">{t("interviewOpen")}</option>
              <option value="COMPLETED">{t("interviewCompleted")}</option>
              <option value="ALL">{t("interviewAll")}</option>
            </select>
          </label>
        </div>
        {applications.rows.map((a) => (
          <form
            key={`${a.id}:${a.interviewCompletedAt?.toISOString()}`}
            className="card space-y-4 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              complete.mutate({
                applicationId: a.id,
                durationMin: Number(f.get("duration")),
                completedAt: new Date(formText(f, "date")),
                attendedTutorIds: formTexts(f, "attended"),
                reason: formText(f, "reason"),
              });
            }}
          >
            <h3 className="font-semibold">{a.name}</h3>
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
                      ? new Date(
                          a.interviewCompletedAt.getTime() -
                            a.interviewCompletedAt.getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16)
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
                {a.interviewers.map((p) => (
                  <label className="flex gap-2" key={p.tutorId}>
                    <input
                      type="checkbox"
                      name="attended"
                      value={p.tutorId}
                      defaultChecked={p.attended}
                    />
                    {p.tutor.englishName}
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
        ))}
        {applications.rows.length === 0 && (
          <p className="muted card p-6 text-center">{t("interviewEmpty")}</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            {t("previous")}
          </button>
          <span className="muted text-sm">
            {t("interviewCount", {
              first,
              last,
              total: applications.total,
            })}
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={last >= applications.total}
            onClick={() => setPage((current) => current + 1)}
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
