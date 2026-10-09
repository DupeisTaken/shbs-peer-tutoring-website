"use client";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { HistoryError } from "~/app/_components/tutee-history";

export function HistoryClaim({
  token,
  invitationId,
}: {
  token: string;
  invitationId?: string;
}) {
  const t = useTranslations("tuteeHistory");
  const [confirmed, setConfirmed] = useState(false);
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
  });
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
      {query.isLoading && <p role="status">{t("loading")}</p>}
      {(query.error ?? claim.error) && (
        <HistoryError message={(query.error ?? claim.error)!.message} />
      )}
      {query.data && (
        <>
          <h2 className="font-semibold">{query.data.name}</h2>
          <p>{t("sessionCount", { count: query.data.sessions })}</p>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("claimConfirm")}
          </label>
          <button
            className="btn-primary min-h-11"
            disabled={!confirmed || claim.isPending}
            onClick={() => claim.mutate(input)}
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
