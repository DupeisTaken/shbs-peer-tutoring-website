"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { HistoryError } from "~/app/_components/tutee-history";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

/** Domain denials revoke the cached identity; a transport failure merely blocks claiming it. */
function claimAccessRevoked(
  error: { message: string; data?: { code?: string } | null } | null,
) {
  return (
    !!error &&
    ([
      "FORBIDDEN",
      "UNAUTHORIZED",
      "NOT_FOUND",
      "CONFLICT",
      "BAD_REQUEST",
    ].includes(error.data?.code ?? "") ||
      [
        "HISTORY_INVITATION_INVALID",
        "HISTORY_STALE",
        "HISTORY_EMAIL_MISMATCH",
        "HISTORY_MANAGER_REQUIRED",
        "HISTORY_NOT_FOUND",
      ].includes(error.message))
  );
}

export function HistoryClaim({
  token,
  invitationId,
}: {
  token: string;
  invitationId?: string;
}) {
  const t = useTranslations("tuteeHistory");
  const ui = useTranslations("uiPatterns");
  const capabilityKey = invitationId
    ? `invitation:${invitationId}`
    : `token:${token}`;
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  // Confirmation belongs to the inspected capability, including when an invitation
  // overrides a retained token parameter. Never expose a new identity as confirmed.
  const confirmed = confirmedFor === capabilityKey;
  useEffect(() => {
    setConfirmedFor(null);
  }, [capabilityKey]);
  const [revoked, setRevoked] = useState(false);
  const submitting = useRef(false);
  const validToken = Boolean(invitationId) || /^[a-f0-9]{64}$/.test(token);
  const input = invitationId ? { invitationId } : { token };
  const query = api.tuteeHistory.inspectClaim.useQuery(input, {
    enabled: validToken,
    retry: false,
  });
  const utils = api.useUtils();
  const claim = api.tuteeHistory.claim.useMutation({
    onSuccess: async () => {
      await utils.tuteeHistory.myRecords.invalidate();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const accessRevoked =
    claimAccessRevoked(query.error) || claimAccessRevoked(claim.error);
  useEffect(() => {
    if (accessRevoked) {
      setRevoked(true);
      setConfirmedFor(null);
    } else if (query.isSuccess && !query.isFetching) setRevoked(false);
  }, [accessRevoked, query.isSuccess, query.isFetching]);
  // Keep denial latched across later network failures until a fresh successful inspection.
  const concealed = !validToken || accessRevoked || revoked;
  const readBlocked =
    concealed || !!query.error || query.isFetching || !query.data;
  const inspectionError =
    query.error ?? (claimAccessRevoked(claim.error) ? claim.error : null);
  if (claim.isSuccess)
    return (
      <section className="card space-y-4 p-5">
        <p role="status">{t("claimed")}</p>
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
          hasData={!!query.data && !concealed}
          loading={query.isLoading || query.isFetching}
          error={!!inspectionError}
          retrying={query.isFetching}
          loadingTitle={t("loading")}
          errorTitle={
            inspectionError && t.has(inspectionError.message)
              ? t(inspectionError.message)
              : ui("loadFailed")
          }
          retryLabel={ui("retry")}
          onRetry={() => {
            // Recovery inspects the capability only; it never repeats or submits a claim.
            if (claimAccessRevoked(claim.error)) claim.reset();
            void query.refetch();
          }}
        />
      )}
      {claim.error && !claimAccessRevoked(claim.error) && (
        <HistoryError message={claim.error.message} />
      )}
      {query.data && !concealed && (
        <>
          <h2 className="font-semibold">{query.data.name}</h2>
          <p>{t("sessionCount", { count: query.data.sessions })}</p>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={readBlocked || claim.isPending}
              onChange={(e) =>
                setConfirmedFor(e.target.checked ? capabilityKey : null)
              }
            />
            {t("claimConfirm")}
          </label>
          <button
            className="btn-primary min-h-11"
            disabled={!confirmed || readBlocked || claim.isPending}
            onClick={() => {
              if (
                !confirmed ||
                readBlocked ||
                claim.isPending ||
                submitting.current
              )
                return;
              submitting.current = true;
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
