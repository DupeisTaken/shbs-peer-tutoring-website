"use client";

import { useFormatter, useTranslations } from "next-intl";
import { minToHm } from "~/lib/time";
import type { RouterOutputs } from "~/trpc/react";

const evaluationFields = [
  "ratingPreparedness",
  "ratingParticipation",
  "ratingUnderstanding",
  "ratingBehavior",
  "ratingProgress",
] as const;

/** Read recorded submission evidence, including absent/merged entries. Never derive
 * past time, status, evaluation or hours from today's pairing configuration. */
export function SessionRecordDetails({
  session,
}: {
  session: RouterOutputs["admin"]["sessions"][number];
}) {
  const t = useTranslations();
  const format = useFormatter();
  const missing = t("auditEventDetails.notRecorded");
  return (
    <div className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="label">{t("admin.submissions.colDate")}</dt>
          <dd>
            {format.dateTime(new Date(session.date), {
              dateStyle: "full",
              timeZone: "UTC",
            })}
          </dd>
        </div>
        <div>
          <dt className="label">{t("corrections.tutorStatus")}</dt>
          <dd>{t(`tutor.attendance.tutorStatusOpt.${session.tutorStatus}`)}</dd>
        </div>
        <div>
          <dt className="label">{t("admin.submissions.actualTime")}</dt>
          <dd>
            {minToHm(session.startMin)}–{minToHm(session.endMin)} ·{" "}
            {t("admin.submissions.duration", { minutes: session.durationMin })}
          </dd>
        </div>
        <div>
          <dt className="label">{t("admin.nav.links.serviceHours")}</dt>
          <dd>
            {session.shCount.toFixed(1)} ·{" "}
            {t("admin.submissions.hourFactor", { factor: session.shFactor })}
          </dd>
        </div>
        {session.tutorAbsentReason && (
          <div className="sm:col-span-2">
            <dt className="label">{t("corrections.absence")}</dt>
            <dd className="whitespace-pre-wrap">{session.tutorAbsentReason}</dd>
          </div>
        )}
      </dl>
      <section className="space-y-2">
        <h3 className="font-semibold">{t("admin.submissions.colTutees")}</h3>
        <ul className="space-y-3">
          {session.tutees.map((entry) => (
            <li key={entry.tuteeId}>
              <p>
                <span className="font-medium">{entry.tutee.englishName}</span> ·{" "}
                {t(`tutor.attendance.tuteeStatusOpt.${entry.status}`)}
              </p>
              {entry.absenceReason && (
                <p className="mt-1 whitespace-pre-wrap text-slate-600">
                  {entry.absenceReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">
          {t("admin.submissions.selfEvaluation")}
        </h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          {evaluationFields.map((field) => (
            <div key={field}>
              <dt className="label">{t(`corrections.${field}`)}</dt>
              <dd>
                {session[field] == null ? missing : `${session[field]} / 5`}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t("admin.submissions.comments")}</h3>
        <p className="whitespace-pre-wrap">{session.comments ?? missing}</p>
      </section>
    </div>
  );
}
