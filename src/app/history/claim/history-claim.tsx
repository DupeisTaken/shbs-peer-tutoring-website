"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { HistoryError } from "~/app/_components/tutee-history";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { SummaryTable } from "~/app/_components/ui/summary-table";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";

/** Domain denials revoke the cached identity; a transport failure only blocks its claim. */
function claimAccessRevoked(
  error: { message: string; data?: { code?: string } | null } | null,
) {
  return (
    !!error &&
    (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT", "BAD_REQUEST"].includes(
      error.data?.code ?? "",
    ) ||
      [
        "HISTORY_INVITATION_INVALID",
        "HISTORY_STALE",
        "HISTORY_EMAIL_MISMATCH",
        "HISTORY_MANAGER_REQUIRED",
        "HISTORY_NOT_FOUND",
      ].includes(error.message))
  );
}

type HistoryClaimProps = { token: string; invitationId?: string };

export function HistoryClaim(props: HistoryClaimProps) {
  const capabilityKey = props.invitationId
    ? `invitation:${props.invitationId}`
    : `token:${props.token}`;
  // Consent, uncertain writes and accepted receipts all belong to the effective
  // capability. An irrelevant token change must not reset an invitation receipt.
  return <HistoryClaimController key={capabilityKey} {...props} />;
}

function HistoryClaimController({ token, invitationId }: HistoryClaimProps) {
  const t = useTranslations("tuteeHistory");
  const exact = useTranslations("historicalInvitation");
  const records = useTranslations("combineRecords");
  const ui = useTranslations("uiPatterns");
  const [confirmed, setConfirmed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [revoked, setRevoked] = useState(false);
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
    } catch {
      setRefreshFailed(true);
    } finally {
      refreshAdmission.current = false;
      setSyncing(false);
    }
  };
  const claim = api.tuteeHistory.claim.useMutation({
    onSuccess: async () => {
      setAccepted(true);
      setUncertain(false);
      await refresh();
    },
    onError: (failure) => {
      setConfirmed(false);
      // A lost response might follow a committed claim. Keep its write blocked
      // until inspection recovers a receipt; Retry is always a read.
      setUncertain(
        !["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(
          failure.data?.code ?? "",
        ),
      );
      if (claimAccessRevoked(failure)) setRevoked(true);
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const accessRevoked =
    claimAccessRevoked(query.error) || claimAccessRevoked(claim.error);
  useEffect(() => {
    if (accessRevoked) {
      setRevoked(true);
      setConfirmed(false);
    } else if (
      query.isSuccess &&
      !query.error &&
      !query.isFetching &&
      !inspectionAdmission.current
    ) setRevoked(false);
  }, [accessRevoked, query.isSuccess, query.error, query.isFetching]);
  // Keep denial latched across transport failures. Clearing a rejected mutation
  // before Retry must not expose its old cached source while inspection is pending.
  const concealed = !validToken || accessRevoked || revoked;
  const data = concealed ? undefined : query.data;
  const readBlocked = concealed || !!query.error || query.isFetching || !data || uncertain;
  const inspectionError =
    query.error ?? (claimAccessRevoked(claim.error) ? claim.error : null);
  const recover = async () => {
    if (query.isFetching || claim.isPending || refreshAdmission.current || inspectionAdmission.current) return;
    inspectionAdmission.current = true;
    if (claimAccessRevoked(claim.error)) claim.reset();
    try {
      const result = await query.refetch();
      if (result.error) {
        if (claimAccessRevoked(result.error)) {
          setRevoked(true);
          setConfirmed(false);
        }
        return;
      }
      setRevoked(false);
      if (result.data?.claimed) {
        setAccepted(true);
        setUncertain(false);
        // Recover both independently cached history views after the receipt;
        // neither this synchronization nor inspection repeats the mutation.
        await refresh();
      }
    } finally {
      inspectionAdmission.current = false;
    }
  };
  if (accepted || data?.claimed)
    return (
      <section className="card space-y-4 p-5">
        <p role="status">{t("claimed")}</p>
        {refreshFailed && (
          <InlineNotice
            tone="warning"
            announcement="status"
            action={<Button disabled={syncing} onClick={() => void refresh()}>{ui("retry")}</Button>}
          >
            {records("refreshFailed")}
          </InlineNotice>
        )}
        <Link className="btn-primary min-h-11" href="/history">
          {t("myHistory")}
        </Link>
      </section>
    );
  return (
    <section className="card space-y-4 p-5">
      {!validToken && <HistoryError message="HISTORY_INVITATION_INVALID" />}
      {validToken && (
        <QueryFeedback
          hasData={!!data}
          loading={query.isLoading || query.isFetching}
          error={!!inspectionError || uncertain}
          retrying={query.isFetching || claim.isPending || syncing}
          loadingTitle={t("loading")}
          errorTitle={
            inspectionError && t.has(inspectionError.message)
              ? t(inspectionError.message)
              : ui("loadFailed")
          }
          errorDetail={uncertain ? exact("claimUncertain") : undefined}
          retryLabel={ui("retry")}
          onRetry={() => void recover()}
        />
      )}
      {claim.error && !claimAccessRevoked(claim.error) && !uncertain && (
        <HistoryError message={claim.error.message} />
      )}
      {data && (
        <>
          <h2 className="font-semibold">{data.name}</h2>
          <p>{t("sessionCount", { count: data.sessions })}</p>
          {!!data.sources?.length && (
            <SummaryTable label={exact("exactSources")}>
              <thead><tr><th>{records("record")}</th><th>{records("type")}</th><th>{records("reference")}</th></tr></thead>
              <tbody>{data.sources.map((source) => (
                <tr key={`${source.kind}:${source.id}`}>
                  <td>{source.name}</td><td>{records(`kind.${source.kind}`)}</td><td className="text-xs break-all">{source.id}</td>
                </tr>
              ))}</tbody>
            </SummaryTable>
          )}
          <p className="muted text-sm">{exact("consequences")}</p>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={readBlocked || claim.isPending}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("claimConfirm")}
          </label>
          <button
            className="btn-primary min-h-11"
            disabled={!confirmed || readBlocked || claim.isPending}
            onClick={() => {
              if (admitted.current || inspectionAdmission.current || accepted || !confirmed || readBlocked || claim.isPending) return;
              admitted.current = true;
              claim.mutate(input);
            }}
          >
            {t("claim")}
          </button>
        </>
      )}
      {/* Keep the secondary destination on its own row when the claim action is shown. */}
      <Link className="link flex min-h-11 w-fit items-center" href="/history">
        {t("myHistory")}
      </Link>
    </section>
  );
}
