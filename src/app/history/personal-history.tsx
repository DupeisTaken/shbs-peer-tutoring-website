"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import {
  SummaryTable,
  TableAction,
  TableActions,
} from "~/app/_components/ui/summary-table";
import { TuteeHistoryDialog } from "~/app/_components/tutee-history";
import { useHistoryReadDenial } from "./use-history-read-denial";

export function PersonalTuteeHistory() {
  const t = useTranslations("tuteeHistory");
  const common = useTranslations("uiPatterns");
  const records = api.tuteeHistory.myRecords.useQuery();
  const [selected, setSelected] = useState<string | null>(null);
  const denied = useHistoryReadDenial(records);
  // myRecords returns the complete owned set, without pagination. A successful
  // exclusion therefore revokes this open detail even if its own read is offline.
  const selectedMissing =
    selected !== null &&
    records.isSuccess &&
    !records.isFetching &&
    !records.error &&
    records.data !== undefined &&
    !records.data.some((record) => record.id === selected);
  useEffect(() => {
    if (denied || selectedMissing) setSelected(null);
  }, [denied, selectedMissing]);
  return (
    <section className="space-y-3" aria-labelledby="tutee-history-title">
      <h2 id="tutee-history-title" className="text-lg font-semibold">
        {t("tuteeHistory")}
      </h2>
      <p className="muted text-sm">{t("tuteeHistoryHelp")}</p>
      <QueryFeedback
        hasData={!denied && records.data !== undefined}
        loading={records.isLoading}
        error={denied || !!records.error}
        retrying={records.isFetching}
        loadingTitle={t("loading")}
        errorTitle={t(denied ? "historyAccessLost" : "failed")}
        retryLabel={common("retry")}
        onRetry={() => void records.refetch()}
      />
      {!denied && !!records.data?.length && (
        <SummaryTable label={t("tuteeHistory")}>
          <thead>
            <tr>
              <th>{t("historyRecord")}</th>
              <th>{t("period")}</th>
              <th>{t("sessionsHeading")}</th>
              <th>{t("actionsHeading")}</th>
            </tr>
          </thead>
          <tbody>
            {records.data.map((record) => (
              <tr key={record.id}>
                <td>
                  <p className="font-semibold">{record.englishName}</p>
                  <p className="muted text-xs break-all">
                    {t("recordId", { id: record.id })}
                  </p>
                </td>
                {/* Only the recorded enrollment period belongs here; current academics are separate evidence. */}
                <td>{record.term?.name ?? t("periodUnknown")}</td>
                <td>{record._count.sessions}</td>
                <TableActions>
                  <TableAction
                    aria-haspopup="dialog"
                    aria-label={t("recordDetailsLabel", {
                      name: record.englishName,
                      id: record.id,
                    })}
                    onClick={() => setSelected(record.id)}
                  >
                    {t("details")}
                  </TableAction>
                </TableActions>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      )}
      {!denied && records.data?.length === 0 && (
        <p className="card p-5">{t("noTuteeHistory")}</p>
      )}
      {!denied && !selectedMissing && selected && (
        <TuteeHistoryDialog
          tuteeId={selected}
          personal
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
