"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { HistoryError } from "~/app/_components/tutee-history";
import { ProfileDialog } from "~/app/_components/profile-dialog";

export function PersonalTutorHistory() {
  const t = useTranslations("tuteeHistory");
  const records = api.tuteeHistory.myTutorRecords.useQuery();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t("tutorHistory")}</h2>
      <p className="muted text-sm">{t("tutorHistoryHelp")}</p>
      {records.isLoading && <p role="status">{t("loading")}</p>}
      {records.error && <HistoryError message={records.error.message} />}
      {records.data?.map((record) => (
        <article
          key={record.id}
          className="card flex flex-wrap items-center justify-between gap-4 p-5"
        >
          <h3 className="min-w-0 font-semibold break-words">
            {record.englishName}
          </h3>
          <button
            className="btn-secondary min-h-11 lg:min-h-9"
            onClick={() => setSelected(record.id)}
          >
            {t("details")}
          </button>
        </article>
      ))}
      {records.data?.length === 0 && (
        <p className="muted text-sm">{t("noHistory")}</p>
      )}
      {selected && (
        <TutorEvidence
          key={selected}
          tutorId={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function TutorEvidence({
  tutorId,
  onClose,
}: {
  tutorId: string;
  onClose: () => void;
}) {
  const t = useTranslations("tuteeHistory");
  const attendance = useTranslations("tutor.attendance.tutorStatusOpt");
  const adjustment = useTranslations("admin.adjustments.typeLabel");
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const query = api.tuteeHistory.myTutorDetails.useQuery({ tutorId, page });
  return (
    <ProfileDialog title={t("tutorHistory")} onClose={onClose}>
      <div className="space-y-5">
        {query.isLoading && <p role="status">{t("loading")}</p>}
        {query.error && <HistoryError message={query.error.message} />}
        {query.data && (
          <>
            <section className="space-y-3">
              {query.data.sessions.map((row) => (
                <article
                  className="rounded-lg border border-slate-200 p-3"
                  key={row.id}
                >
                  <p className="font-medium">
                    {format.dateTime(row.date, { dateStyle: "medium" })} ·{" "}
                    {row.pairing?.subject}
                  </p>
                  <p>
                    {row.schoolYear} {row.quarter} ·{" "}
                    {attendance(row.tutorStatus)}
                  </p>
                  <p>{t("storedHours", { hours: row.shCount })}</p>
                </article>
              ))}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">{t("meetings")}</h3>
              {query.data.meetings.map((row) => (
                <p key={row.id}>
                  {format.dateTime(row.meeting.date, { dateStyle: "medium" })} ·{" "}
                  {row.meeting.title} · {t(`attendance_${row.status}`)}
                </p>
              ))}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">{t("amendments")}</h3>
              {query.data.amendments.map((row) => (
                <p className="break-words" key={row.id}>
                  {row.schoolYear} {row.quarter} · {adjustment(row.type)}{" "}
                  {row.amount} · {row.reason}
                </p>
              ))}
            </section>
          </>
        )}
        <nav className="flex flex-wrap gap-3">
          <button
            className="btn-secondary min-h-11 lg:min-h-9"
            disabled={!page || query.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t("previous")}
          </button>
          <button
            className="btn-secondary min-h-11 lg:min-h-9"
            disabled={!query.data?.more || query.isFetching}
            onClick={() => setPage(page + 1)}
          >
            {t("next")}
          </button>
        </nav>
      </div>
    </ProfileDialog>
  );
}
