"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { formatWeekday, minToHm } from "~/lib/time";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { useBranding } from "~/app/_components/branding-provider";
import { PolicyAgreement } from "~/app/_components/policy-agreement";
import { Button } from "~/app/_components/ui/button";
import { Modal } from "~/app/_components/ui/modal";
import {
  FormActions,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

type Snapshot = RouterOutputs["studentWorkflow"]["continuationStatus"];
type Candidate = Snapshot["candidates"][number];
type Receipt = RouterOutputs["studentWorkflow"]["joinContinuation"];
type Attempt = {
  clientKey: string;
  revision: string;
  sourcePairingIds: string[];
  policyRevision: string;
  agreed: true;
  signatureName: string;
};
type Review = { snapshot: Snapshot; candidates: Candidate[] };
function accessDenied(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  return code === "FORBIDDEN" || code === "UNAUTHORIZED";
}

/** The selection is a draft, not enrollment. Keep one exact attempt through an
 * ambiguous reply, and recover its receipt before allowing another deliberate Join. */
export function LegacyContinuation() {
  const t = useTranslations("legacyContinuation");
  const locale = useLocale();
  const { APP_TITLE } = useBranding();
  const utils = api.useUtils();
  const cache = useQueryClient();
  const query = api.studentWorkflow.continuationStatus.useQuery(
    { locale },
    {
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
      refetchInterval: 15_000,
      retry: false,
    },
  );
  const join = api.studentWorkflow.joinContinuation.useMutation();
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [signature, setSignature] = useState("");
  const [agreedRevision, setAgreedRevision] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const admitted = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const generation = useRef(0);
  const denied = accessDenied(query.error);
  const serverAnchor = query.data?.serverNow?.getTime();
  const [clock, setClock] = useState({ anchor: serverAnchor, elapsed: 0 });
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(
      () =>
        setClock({
          anchor: serverAnchor,
          elapsed: performance.now() - started,
        }),
      1_000,
    );
    return () => clearInterval(timer);
  }, [serverAnchor]);
  const conceal = useCallback(() => {
    generation.current += 1;
    setRevoked(true);
    setReview(null);
    setSelected([]);
    setReceipt(null);
    setAgreedRevision(null);
    setSignature("");
    cache.removeQueries({
      queryKey: getQueryKey(
        api.studentWorkflow.continuationStatus,
        { locale },
        "query",
      ),
    });
    cache.removeQueries({
      queryKey: getQueryKey(api.studentWorkflow.continuationReceipt),
    });
  }, [cache, locale]);
  useEffect(() => {
    if (denied) {
      conceal();
    } else if (query.isSuccess && !query.isFetching && !query.error) {
      setRevoked(false);
    }
  }, [denied, query.isSuccess, query.isFetching, query.error, conceal]);

  const data = query.data;
  const now =
    (serverAnchor ?? 0) + (clock.anchor === serverAnchor ? clock.elapsed : 0);
  const expired = !!data?.expiresAt && now >= data.expiresAt.getTime();
  const readBlocked = !data || !!query.error || revoked || denied;
  const status = expired ? "expired" : data?.status;
  const blocked =
    readBlocked || busy || held || refreshFailed || status !== "eligible";
  const chosen =
    data?.candidates.filter(
      (row) =>
        selected.includes(row.sourcePairingId) &&
        !row.requested &&
        !!row.subjectId,
    ) ?? [];
  const subjectCount = new Set([
    ...(data?.currentRequest?.subjectIds ?? []),
    ...chosen.map((row) => row.subjectId),
  ]).size;
  const minimumSubjects = data?.minimumSubjects ?? 1;
  const availableSubjectCount = new Set([
    ...(data?.currentRequest?.subjectIds ?? []),
    ...(data?.candidates
      .filter((row) => !row.requested && !!row.subjectId)
      .map((row) => row.subjectId) ?? []),
  ]).size;
  const prerequisites = !!data?.prerequisites.fieldsRequired.length;
  const detailsDestination = data?.prerequisites.fieldsRequired.includes(
    "emailVerification",
  )
    ? "/onboarding/email"
    : data?.currentRequest ||
        data?.prerequisites.fieldsRequired.includes("requestReview")
      ? "/student?view=requests#current-request"
      : "/tutee";
  const ready =
    !blocked &&
    !prerequisites &&
    chosen.length > 0 &&
    subjectCount >= minimumSubjects &&
    subjectCount <= 2;
  const staleReview =
    !!review &&
    (review.snapshot.revision !== data?.revision ||
      review.candidates.some(
        (prior) =>
          !data?.candidates.some(
            (row) =>
              row.sourcePairingId === prior.sourcePairingId &&
              row.subjectId === prior.subjectId &&
              !!row.subjectId &&
              !row.requested,
          ),
      ));
  const reasonText = (reason: string | null) =>
    reason
      ? t.has(`reasons.${reason}`)
        ? t(`reasons.${reason}`)
        : t("reasons.unavailable")
      : null;
  // Receipts remain immutable submission evidence. Only a fresh view of the same
  // request at that version or newer may replace its visible assignment outcome.
  const currentResults = receipt?.results.map((result) => {
    const latest =
      !readBlocked &&
      data?.currentRequest?.id === receipt.requestId &&
      data.currentRequest.version >= receipt.version
        ? data.candidates.find(
            (row) =>
              row.sourcePairingId === result.sourcePairingId && row.requested,
          )
        : undefined;
    return latest
      ? {
          ...result,
          state:
            latest.state === "joined"
              ? ("assigned" as const)
              : latest.state === "released"
                ? ("released" as const)
                : ("queued" as const),
          reason: latest.reason,
        }
      : result;
  });

  const refresh = async () => {
    const results = await Promise.allSettled([
      query.refetch(),
      invalidateAndReport(utils.studentWorkflow.mine),
      invalidateAndReport(utils.student.me),
      invalidateAndReport(utils.sessionPlanning.agenda),
    ]);
    const statusRead = results[0];
    if (
      statusRead.status !== "fulfilled" ||
      statusRead.value.error ||
      !statusRead.value.data ||
      results.slice(1).some((result) => result.status === "rejected")
    )
      throw new Error("refresh");
  };
  const accept = async (saved: Receipt, ownGeneration: number) => {
    if (ownGeneration !== generation.current) return;
    setReceipt(saved);
    setReview(null);
    setSelected([]);
    setSignature("");
    setAgreedRevision(null);
    setHeld(false);
    setFailure(null);
    attempt.current = null;
    try {
      await refresh();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    }
  };
  const submit = async () => {
    if (!review?.snapshot.policy) return;
    if (
      admitted.current ||
      !ready ||
      staleReview ||
      agreedRevision !== review.snapshot.policy.revision ||
      !signature.trim()
    )
      return;
    const captured: Attempt = {
      clientKey: crypto.randomUUID(),
      revision: review.snapshot.revision,
      sourcePairingIds: review.candidates.map((row) => row.sourcePairingId),
      policyRevision: review.snapshot.policy.revision,
      agreed: true,
      signatureName: signature.trim(),
    };
    admitted.current = true;
    const ownGeneration = generation.current;
    attempt.current = captured;
    setHeld(true);
    setBusy(true);
    setFailure(null);
    try {
      await accept(await join.mutateAsync(captured), ownGeneration);
    } catch (error) {
      if (ownGeneration === generation.current) {
        if (accessDenied(error)) conceal();
        else setFailure(t("uncertain"));
      }
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  };
  const recoverAttempt = async () => {
    if (admitted.current || !attempt.current || denied || revoked) return;
    admitted.current = true;
    const ownGeneration = generation.current;
    setBusy(true);
    try {
      const saved = await utils.studentWorkflow.continuationReceipt.fetch({
        clientKey: attempt.current.clientKey,
      });
      if (ownGeneration !== generation.current) return;
      if (saved) await accept(saved, ownGeneration);
      else {
        attempt.current = null;
        setHeld(false);
        setFailure(t("notSubmitted"));
      }
    } catch (error) {
      if (ownGeneration === generation.current) {
        if (accessDenied(error)) conceal();
        else setFailure(t("recoveryFailed"));
      }
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  };
  const retryRefresh = async () => {
    if (admitted.current) return;
    admitted.current = true;
    setBusy(true);
    try {
      await refresh();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  };
  const readFeedback = (
    <QueryFeedback
      hasData={!!data}
      loading={!data && !query.error}
      error={!!query.error}
      retrying={query.isFetching}
      loadingTitle={t("loading")}
      errorTitle={t(data ? "refreshReadFailed" : "loadFailed")}
      retryLabel={t("retry")}
      onRetry={() => void query.refetch()}
    />
  );
  if (denied || revoked)
    return (
      <StatePanel
        kind="denied"
        title={t("denied")}
        action={
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        }
      />
    );
  if (!data) return readFeedback;
  if (status === "unavailable" && !receipt && !data.candidates.length)
    return null;
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: data.timeZone,
  });
  const schedule = (row: Candidate) =>
    `${formatWeekday(row.dayOfWeek, locale)} ${minToHm(row.startMin)}–${minToHm(row.endMin)}`;
  return (
    <section
      className="card space-y-4 p-4 sm:p-5"
      aria-labelledby="legacy-continuation-title"
    >
      <div className="space-y-2">
        <h2 id="legacy-continuation-title" className="section-title">
          {t("title")}
        </h2>
        <p className="text-sm">
          {t("help", {
            source: data.sourceTermName ?? "",
            target: data.targetTermName,
          })}
        </p>
        {data.expiresAt && (
          <p className="text-sm font-medium">
            {t("deadline", {
              time: dateFormat.format(data.expiresAt),
              zone: data.timeZone,
            })}
          </p>
        )}
        {status === "eligible" && data.expiresAt && (
          <p className="muted text-sm">
            {t("remaining", {
              minutes: Math.max(
                0,
                Math.ceil((data.expiresAt.getTime() - now) / 60_000),
              ),
            })}
          </p>
        )}
      </div>
      {readFeedback}
      {status !== "eligible" && (
        <InlineNotice tone="warning" announcement="status">
          {t(`status.${status ?? "unavailable"}`)}
        </InlineNotice>
      )}
      {prerequisites && (
        <InlineNotice
          tone="warning"
          action={
            <Link
              className="link inline-flex min-h-11 items-center"
              href={detailsDestination}
            >
              {t("completeDetails")}
            </Link>
          }
        >
          {t("missingDetails")}
        </InlineNotice>
      )}
      {minimumSubjects === 2 && (
        <InlineNotice
          tone="info"
          action={
            !prerequisites && availableSubjectCount < minimumSubjects ? (
              <Link
                className="link inline-flex min-h-11 items-center"
                href={detailsDestination}
              >
                {t("completeDetails")}
              </Link>
            ) : undefined
          }
        >
          {t("requiredSubjects")}
        </InlineNotice>
      )}
      {receipt && (
        <InlineNotice tone="success" announcement="status">
          <p className="font-semibold">{t("filed")}</p>
          <p className="mt-2 text-sm">{t("currentResults")}</p>
          <ul className="mt-2 space-y-2">
            {currentResults?.map((result) => (
              <li key={result.sourcePairingId}>
                <span className="font-medium">
                  {result.subject} · {result.tutorName}
                </span>
                {" — "}
                {t(`result.${result.state}`)}
                {result.reason && (
                  <span className="block">{reasonText(result.reason)}</span>
                )}
              </li>
            ))}
          </ul>
          <Link
            className="link mt-2 inline-flex min-h-11 items-center"
            href="/student?view=requests"
          >
            {t("viewRequest")}
          </Link>
        </InlineNotice>
      )}
      {refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="status"
          action={
            <Button disabled={busy} onClick={() => void retryRefresh()}>
              {t("retry")}
            </Button>
          }
        >
          {t("savedRefreshFailed")}
        </InlineNotice>
      )}
      {held && !review && (
        <InlineNotice
          tone="warning"
          announcement="status"
          action={
            <Button disabled={busy} onClick={() => void recoverAttempt()}>
              {t("checkRequest")}
            </Button>
          }
        >
          {failure ?? t("uncertain")}
        </InlineNotice>
      )}
      <fieldset
        disabled={blocked || prerequisites}
        className="min-w-0 space-y-3"
        aria-busy={busy}
      >
        <legend className="sr-only">{t("choose")}</legend>
        <p className="muted text-sm">{t("subjectLimit")}</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {data.candidates.map((row) => {
            const requested = row.requested;
            return (
              <label
                key={row.sourcePairingId}
                className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={selected.includes(row.sourcePairingId)}
                  disabled={requested || !row.subjectId}
                  aria-label={t("select", {
                    subject: row.subject,
                    tutor: row.tutorName,
                  })}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, row.sourcePairingId]
                        : current.filter((id) => id !== row.sourcePairingId),
                    )
                  }
                />
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold break-words">
                    {row.subject} · {row.tutorName}
                  </span>
                  <span className="mt-1 block">{schedule(row)}</span>
                  {requested && (
                    <span className="mt-1 block font-medium">
                      {t(`candidate.${row.state}`)}
                    </span>
                  )}
                  {row.reason && (
                    <span className="mt-1 block text-slate-600">
                      {reasonText(row.reason)}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {subjectCount > 2 && (
          <p role="alert" className="text-sm text-red-700">
            {t("tooManySubjects")}
          </p>
        )}
        <FormActions>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              setReview({ snapshot: data, candidates: chosen });
              setFailure(null);
              setAgreedRevision(null);
            }}
          >
            {t("review")}
          </Button>
        </FormActions>
      </fieldset>
      {review && (
        <Modal
          title={t("reviewTitle")}
          wide
          busy={busy}
          onClose={() => {
            if (!busy && !held) setReview(null);
          }}
          footer={
            <>
              <Button disabled={busy || held} onClick={() => setReview(null)}>
                {t("cancel")}
              </Button>
              {held ? (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void recoverAttempt()}
                >
                  {t("checkRequest")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={
                    !ready ||
                    staleReview ||
                    agreedRevision !== review.snapshot.policy?.revision ||
                    !signature.trim()
                  }
                  onClick={() => void submit()}
                >
                  {t("join")}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-4">
            {readFeedback}
            <p className="text-sm">{t("consequence")}</p>
            <ul className="space-y-2 text-sm">
              {review.candidates.map((row) => (
                <li key={row.sourcePairingId}>
                  <span className="font-semibold">
                    {row.subject} · {row.tutorName}
                  </span>
                  <span className="block">{schedule(row)}</span>
                </li>
              ))}
            </ul>
            {review.candidates.some(
              (row) => row.endMin - row.startMin !== 45,
            ) && <InlineNotice tone="info">{t("datedDuration")}</InlineNotice>}
            {staleReview && (
              <InlineNotice tone="warning" announcement="status">
                {t("stale")}
              </InlineNotice>
            )}
            {status !== "eligible" && (
              <InlineNotice tone="warning" announcement="status">
                {t(`status.${status ?? "unavailable"}`)}
              </InlineNotice>
            )}
            {failure && (
              <InlineNotice tone="error" announcement="alert">
                {failure}
              </InlineNotice>
            )}
            <fieldset
              disabled={busy || held || staleReview || readBlocked}
              className="space-y-4"
            >
              {review.snapshot.policy ? (
                <PolicyAgreement
                  key={review.snapshot.policy.revision}
                  messageKey="public.signup.agree"
                  appTitle={APP_TITLE}
                  policy={review.snapshot.policy}
                  checked={agreedRevision === review.snapshot.policy.revision}
                  onChange={(value) =>
                    setAgreedRevision(
                      value ? review.snapshot.policy!.revision : null,
                    )
                  }
                />
              ) : (
                <InlineNotice tone="warning">
                  {t("policyUnavailable")}
                </InlineNotice>
              )}
              <label className="block text-sm font-medium">
                {t("signature")}
                <input
                  className="input mt-2 w-full"
                  value={signature}
                  maxLength={120}
                  autoComplete="name"
                  onChange={(event) => setSignature(event.target.value)}
                />
              </label>
            </fieldset>
          </div>
        </Modal>
      )}
    </section>
  );
}
