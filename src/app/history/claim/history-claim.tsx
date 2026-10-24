"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { HistoryError } from "~/app/_components/tutee-history";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { SummaryTable } from "~/app/_components/ui/summary-table";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";

export function HistoryClaim({
  token,
  invitationId,
}: {
  token: string;
  invitationId?: string;
}) {
  const t = useTranslations("tuteeHistory");
  const exact = useTranslations("historicalInvitation");
  const records = useTranslations("combineRecords");
  const ui = useTranslations("uiPatterns");
  const [confirmed, setConfirmed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const admitted = useRef(false);
  const refreshAdmission = useRef(false);
  const inspectionAdmission = useRef(false);
  const validToken = Boolean(invitationId) || /^[a-f0-9]{64}$/.test(token);
  const input = invitationId ? { invitationId } : { token };
  const query = api.tuteeHistory.inspectClaim.useQuery(input, {
    enabled: validToken,
    retry: false,
    refetchOnMount: "always",
    gcTime: 0,
  });
  const utils = api.useUtils();
  const denied = ["FORBIDDEN", "UNAUTHORIZED"].includes(query.error?.data?.code ?? "");
  useEffect(() => {
    if (denied) setAccessLost(true);
    else if (query.isSuccess && !query.error && !query.isFetching) setAccessLost(false);
  }, [denied, query.isSuccess, query.error, query.isFetching]);
  const data = denied || accessLost ? undefined : query.data;
  // Claim acceptance and history synchronization have separate recovery paths.
  // A failed read can never submit the claim mutation again.
  const refresh = async () => {
    if (refreshAdmission.current) return;
    refreshAdmission.current = true;
    setSyncing(true);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.tuteeHistory.myRecords),
        () => invalidateAndReport(utils.tuteeHistory.myTutorRecords),
      ]);
      setRefreshFailed(false);
    } catch { setRefreshFailed(true); }
    finally { refreshAdmission.current = false; setSyncing(false); }
  };
  const claim = api.tuteeHistory.claim.useMutation({
    onSuccess: async () => {
      setAccepted(true);
      setUncertain(false);
      await refresh();
    },
    onError: (failure) => {
      setConfirmed(false);
      setUncertain(!["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(failure.data?.code ?? ""));
      if (["FORBIDDEN", "UNAUTHORIZED"].includes(failure.data?.code ?? "")) setAccessLost(true);
    },
    onSettled: () => { admitted.current = false; },
  });
  const recover = async () => {
    if (query.isFetching || claim.isPending || refreshAdmission.current || inspectionAdmission.current) return;
    inspectionAdmission.current = true;
    try {
      const result = await query.refetch();
      if (result.error) {
        if (["FORBIDDEN", "UNAUTHORIZED"].includes(result.error.data?.code ?? "")) setAccessLost(true);
        return;
      }
      setAccessLost(false);
      if (result.data?.claimed) {
        setAccepted(true);
        setUncertain(false);
        // Recovering the write receipt also refreshes both independently cached
        // history views; neither operation replays the claim mutation.
        await refresh();
      }
    } finally { inspectionAdmission.current = false; }
  };
  if (accepted || data?.claimed)
    return (
      <section className="card space-y-4 p-5">
        <p role="status">{t("claimed")}</p>
        {refreshFailed && <InlineNotice tone="warning" announcement="status" action={<Button disabled={syncing} onClick={() => void refresh()}>{ui("retry")}</Button>}>{records("refreshFailed")}</InlineNotice>}
        <Link className="btn-primary min-h-11" href="/history">
          {t("myHistory")}
        </Link>
      </section>
    );
  return (
    <section className="card space-y-4 p-5">
      {!validToken && <HistoryError message="HISTORY_INVITATION_INVALID" />}
      {query.isLoading && <p role="status">{t("loading")}</p>}
      {(query.error ?? claim.error) && (
        <HistoryError message={(query.error ?? claim.error)!.message} />
      )}
      {(query.error || uncertain || denied || accessLost) && <div className="space-y-2">
        {uncertain && <p role="status">{exact("claimUncertain")}</p>}
        <Button disabled={query.isFetching || claim.isPending} onClick={() => void recover()}>{ui("retry")}</Button>
      </div>}
      {data && (
        <>
          <h2 className="font-semibold">{data.name}</h2>
          <p>{t("sessionCount", { count: data.sessions })}</p>
          {!!data.sources?.length && <SummaryTable label={exact("exactSources")}>
            <thead><tr><th>{records("record")}</th><th>{records("type")}</th><th>{records("reference")}</th></tr></thead>
            <tbody>{data.sources.map((source) => <tr key={`${source.kind}:${source.id}`}>
              <td>{source.name}</td><td>{records(`kind.${source.kind}`)}</td><td className="text-xs break-all">{source.id}</td>
            </tr>)}</tbody>
          </SummaryTable>}
          <p className="muted text-sm">{exact("consequences")}</p>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={claim.isPending || query.isFetching || uncertain || !!query.error}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("claimConfirm")}
          </label>
          <button
            className="btn-primary min-h-11"
            disabled={!confirmed || claim.isPending || query.isFetching || uncertain || !!query.error}
            onClick={() => {
              if (admitted.current || accepted || !confirmed || claim.isPending || query.isFetching || uncertain || query.error) return;
              admitted.current = true;
              claim.mutate(input);
            }}
          >
            {t("claim")}
          </button>
        </>
      )}
      <Link className="link inline-flex min-h-11 items-center" href="/history">
        {t("myHistory")}
      </Link>
    </section>
  );
}
