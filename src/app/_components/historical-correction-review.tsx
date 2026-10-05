"use client";
import { useTranslations } from "next-intl";
import { z } from "zod";

const values = z.object({
  rawGrade: z.string().nullable(),
  schoolYear: z.string().nullable(),
});
export const historicalReviewRecords = z.array(
  z.object({
    recordId: z.string(),
    name: z.string(),
    current: values,
    proposed: values,
    original: values.extend({
      source: z.string(),
      academicallyGraduated: z.boolean().optional(),
    }),
    evidence: z.string(),
    reason: z.string(),
  }),
);

/** The website and approval reviewer see the same before/after values and source evidence. */
export function HistoricalCorrectionReview({
  records,
}: {
  records: z.infer<typeof historicalReviewRecords>;
}) {
  const t = useTranslations("historicalAcademics");
  const describe = (value: z.infer<typeof values>) =>
    `${value.rawGrade ?? t("unknown")} · ${value.schoolYear ?? t("unknownYear")}`;
  return (
    <div className="space-y-4">
      <p className="muted text-sm">{t("reviewHelp")}</p>
      {records.map((record) => (
        <section
          key={record.recordId}
          className="rounded-xl border border-slate-200 p-4"
        >
          <h3 className="font-semibold">{record.name}</h3>
          <p className="muted mt-1 text-xs break-all">{record.recordId}</p>
          {record.original.academicallyGraduated && (
            <p className="mt-2 text-sm">{t("graduatedRecorded")}</p>
          )}
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs font-semibold text-slate-500">
                {t("before")}
              </dt>
              <dd className="mt-1 break-words">{describe(record.current)}</dd>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <dt className="text-xs font-semibold text-emerald-800">
                {t("after")}
              </dt>
              <dd className="mt-1 break-words">{describe(record.proposed)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">{t("original")}</dt>
              <dd className="break-words">{describe(record.original)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">{t("source")}</dt>
              <dd className="break-words">
                {["LEGACY_TUTEE", "LEGACY_TUTOR"].includes(
                  record.original.source,
                )
                  ? t(record.original.source)
                  : record.original.source}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">{t("evidence")}</dt>
              <dd className="break-words">{record.evidence}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">{t("reason")}</dt>
              <dd className="break-words">{record.reason}</dd>
            </div>
          </dl>
        </section>
      ))}
    </div>
  );
}
