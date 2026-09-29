"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  TuteeHistoryDialog,
  HistoryError,
} from "~/app/_components/tutee-history";

export function PersonalTuteeHistory() {
  const t = useTranslations("tuteeHistory");
  const records = api.tuteeHistory.myRecords.useQuery();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {records.isLoading && <p role="status">{t("loading")}</p>}
      {records.error && <HistoryError message={records.error.message} />}
      {records.data?.map((record) => (
        <article
          className="card flex flex-wrap items-center justify-between gap-4 p-5"
          key={record.id}
        >
          <div>
            <h2 className="font-semibold">{record.englishName}</h2>
            <p className="muted text-sm">
              {t("sessionCount", { count: record._count.sessions })}
            </p>
          </div>
          <button
            className="btn-secondary min-h-11 lg:min-h-9"
            onClick={() => setSelected(record.id)}
          >
            {t("details")}
          </button>
        </article>
      ))}
      {records.data?.length === 0 && (
        <p className="card p-5">{t("noHistory")}</p>
      )}
      {selected && (
        <TuteeHistoryDialog
          tuteeId={selected}
          personal
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
