"use client";

import { useFormatter, useTranslations } from "next-intl";

type Evidence = {
  recordId: string;
  original: {
    rawGrade: string | null;
    schoolYear: string | null;
    source: string;
    originalConfirmedAt: Date | null;
    academicallyGraduated?: boolean;
  };
  current: { rawGrade: string | null; schoolYear: string | null };
  revision: number;
  correction: {
    correctedAt: Date;
    actorName: string;
    reason: string;
    evidence: string;
  } | null;
};

/** Separate the period described from the date staff made the correction. Original
 * confirmation is shown only when evidence supplied it, never inferred from import time. */
export function HistoricalAcademicEvidence({
  records,
  onHistory,
}: {
  records: Evidence[];
  onHistory?: (recordId: string) => void;
}) {
  const t = useTranslations("historicalAcademics");
  const format = useFormatter();
  return (
    <div className="space-y-3">
      {records.map((record) => (
        <section
          key={record.recordId}
          className="rounded-lg border border-slate-200 p-3 text-sm"
        >
          <p className="font-medium">
            {record.current.rawGrade ?? t("unknown")} ·{" "}
            {record.current.schoolYear ?? t("unknownYear")}
          </p>
          <p className="muted mt-1 text-xs break-all">
            {t("recordId")}: {record.recordId}
          </p>
          <details className="mt-2">
            <summary className="text-accent-700 flex min-h-11 cursor-pointer items-center lg:min-h-8">
              {t("provenance")}
            </summary>
            <dl className="space-y-2 py-2">
              <div>
                <dt className="font-medium">{t("original")}</dt>
                <dd>
                  {record.original.rawGrade ?? t("unknown")} ·{" "}
                  {record.original.schoolYear ?? t("unknownYear")}
                </dd>
              </div>
              {record.original.academicallyGraduated && (
                <p>{t("graduatedRecorded")}</p>
              )}
              <div>
                <dt className="font-medium">{t("source")}</dt>
                <dd className="break-words">
                  {["LEGACY_TUTEE", "LEGACY_TUTOR"].includes(
                    record.original.source,
                  )
                    ? t(record.original.source)
                    : record.original.source}
                </dd>
              </div>
              <div>
                <dt className="font-medium">{t("originalConfirmedAt")}</dt>
                <dd>
                  {record.original.originalConfirmedAt
                    ? format.dateTime(record.original.originalConfirmedAt, {
                        dateStyle: "medium",
                      })
                    : t("notRecorded")}
                </dd>
              </div>
              {record.correction && (
                <>
                  <div>
                    <dt className="font-medium">{t("correctedAt")}</dt>
                    <dd>
                      {format.dateTime(record.correction.correctedAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}{" "}
                      · {record.correction.actorName}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">{t("evidence")}</dt>
                    <dd className="break-words">
                      {record.correction.evidence}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">{t("reason")}</dt>
                    <dd className="break-words">{record.correction.reason}</dd>
                  </div>
                </>
              )}
            </dl>
          </details>
          {onHistory && record.revision > 0 && (
            <button
              type="button"
              className="link min-h-11 text-sm lg:min-h-8"
              onClick={() => onHistory(record.recordId)}
            >
              {t("allCorrections")}
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
