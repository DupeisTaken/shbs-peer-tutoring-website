"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getQueryKey } from "@trpc/react-query";
import { api } from "~/trpc/react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { ProfileDialog } from "./profile-dialog";
import { useSessionAccessDenied } from "./session-view-state";
import { useDialogPending } from "./ui/modal";
import { Button } from "./ui/button";
import { ChangeReview, InlineNotice, StatePanel } from "./ui/patterns";
import { DisclosureSection } from "./ui/disclosure-section";
const ManagementActions = dynamic(() =>
  import("./management-actions").then((module) => module.ManagementActions),
);

/** The personal dashboard remains the home for history; observation is a separate workspace. */
export function DepartureBanner() {
  const t = useTranslations("schoolDeparture");
  const state = api.departure.state.useQuery({});
  if (!state.data?.departure?.reason) return null;
  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50 p-5 sm:p-6">
      <p className="text-xs font-semibold tracking-wider text-teal-700 uppercase">
        {t("eyebrow")}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-slate-900">
        {t(
          state.data.departure.reason === "TRANSFERRED"
            ? "transferred"
            : "graduated",
        )}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-700">
        {t("historyHelp")}
      </p>
      {state.data.access.canReadManagement && (
        <Link href="/admin" className="btn-primary mt-4 min-h-11 lg:min-h-10">
          {t("enter")}
        </Link>
      )}
    </section>
  );
}

/** One editor serves self-service proposals and management decisions. A confirmation shows
 * assignment consequences; the API rechecks the revision rather than trusting this preview. */
export function SchoolDeparturePanel({ userId }: { userId?: string }) {
  return <SchoolDepartureEditor key={userId ?? "self"} userId={userId} />;
}

function SchoolDepartureEditor({ userId }: { userId?: string }) {
  const t = useTranslations("schoolDeparture");
  const state = api.departure.state.useQuery({ userId });
  const [selectedAction, setAction] = useState<
    "GRADUATED" | "TRANSFERRED" | "RETURN" | "REVOKE" | "RESTORE"
  >("TRANSFERRED");
  const [explanation, setExplanation] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [expectedRevision, setExpectedRevision] = useState<number | null>(null);
  const submitting = useRef(false);
  const reading = useRef(false);
  const acceptedWrite = useRef(false);
  const [writePending, setWritePending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [readPending, setReadPending] = useState(false);
  const [readFailure, setReadFailure] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const acceptedRequested = useRef(false);
  const [requestedOutcome, setRequestedOutcome] = useState(false);
  const [releasedCompletions, setReleasedCompletions] = useState(0);
  const [completion, setCompletion] = useState<{
    revision: number;
    requested: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    // Completion may be consumed before its intermediate state ever commits.
    // Release the event guard only after that consumption commits, before input.
    if (releasedCompletions > 0 && !accepted && !completion)
      acceptedWrite.current = false;
  }, [releasedCompletions, accepted, completion]);
  const router = useRouter();
  const utils = api.useUtils();
  const readCurrent = async () => {
    const result = await state.refetch({
      throwOnError: true,
      cancelRefetch: true,
    });
    if (!result.isSuccess || !result.data)
      throw new Error("Departure refresh failed");
    return result.data;
  };
  const refreshAccepted = async () => {
    if (reading.current) return;
    reading.current = true;
    setReadPending(true);
    try {
      // Invalidation can resolve with failed queries. Read this exact target too,
      // and wait for every related read before releasing the accepted-write lock.
      const [, fresh] = await settleRefreshes<Awaited<
        ReturnType<typeof readCurrent>
      > | null>([
        async () => {
          await invalidateAndReport(utils);
          return null;
        },
        readCurrent,
      ]);
      if (!fresh) throw new Error("Departure refresh failed");
      setReadFailure(false);
      setRefreshFailed(false);
      setCompletion({
        revision: fresh.departure?.revision ?? 0,
        requested: acceptedRequested.current,
      });
      router.refresh();
    } catch {
      // The write/proposal already exists. Retry performs reads only.
      setRefreshFailed(true);
    } finally {
      reading.current = false;
      setReadPending(false);
    }
  };
  const success = async () => {
    acceptedWrite.current = true;
    const requested = !(
      userId && ["HEAD", "ADMIN"].includes(state.data?.role ?? "")
    );
    acceptedRequested.current = requested;
    setRequestedOutcome(requested);
    setAccepted(true);
    await refreshAccepted();
  };
  const settled = () => {
    submitting.current = false;
    setWritePending(false);
  };
  const save = api.departure.setState.useMutation({
    onSettled: settled,
    onSuccess: success,
    onError: async (error) => {
      if (error.data?.approvalId) {
        acceptedWrite.current = true;
        acceptedRequested.current = true;
        setRequestedOutcome(true);
        setAccepted(true);
        await refreshAccepted();
      }
    },
  });
  const request = api.departure.request.useMutation({
    onSuccess: success,
    onSettled: settled,
  });
  const error =
    (save.error?.data?.approvalId ? null : save.error) ?? request.error;
  const denied = useSessionAccessDenied(
    {
      ...state,
      denialKey: "school-departure",
      queryKey: getQueryKey(api.departure.state, { userId }, "query"),
    },
    { error, isSuccess: !error, isFetching: readPending },
  );
  // A background read never lends a new version to an existing reason/action.
  // Only the initial authorized read, explicit Reload or accepted-save read adopts it.
  if (
    expectedRevision === null &&
    state.data &&
    !state.error &&
    !denied &&
    !accepted
  )
    setExpectedRevision(state.data.departure?.revision ?? 0);
  const ownPending =
    save.isPending || request.isPending || writePending || readPending;
  const busy = useDialogPending(ownPending);
  // Keep the nested review mounted through callbacks/refresh and any registered sibling write.
  // Never register the inherited aggregate back into the parent context.
  // Consume the settled completion before rendering the next editor state. Its
  // review remains mounted while any registered sibling write is still pending.
  if (completion && !busy) {
    setConfirming(false);
    setExplanation("");
    setExpectedRevision(completion.revision);
    setOutcome(t(completion.requested ? "requested" : "saved"));
    setReleasedCompletions((previous) => previous + 1);
    setAccepted(false);
    setCompletion(null);
  }
  const retryRead = async (reloadDraft = false) => {
    if (busy || reading.current || submitting.current || completion) return;
    if (acceptedWrite.current) {
      await refreshAccepted();
      return;
    }
    reading.current = true;
    setReadPending(true);
    try {
      const fresh = await readCurrent();
      if (reloadDraft) {
        setExpectedRevision(fresh.departure?.revision ?? 0);
        setConfirming(false);
      }
      setReadFailure(false);
      save.reset();
      request.reset();
    } catch {
      setReadFailure(true);
    } finally {
      reading.current = false;
      setReadPending(false);
    }
  };
  const departed = !!state.data?.departure?.reason;
  const retired = !!state.data?.retired;
  const action = retired ? "RETURN" : selectedAction;
  const canReview = retired
    ? !!userId && departed && ["HEAD", "ADMIN"].includes(state.data?.role ?? "")
    : !["RETURN", "REVOKE", "RESTORE"].includes(action) || departed;
  const reloadNeeded =
    error?.data?.code === "CONFLICT" ||
    (expectedRevision !== null &&
      !!state.data &&
      expectedRevision !== (state.data.departure?.revision ?? 0));
  const blocked =
    busy ||
    accepted ||
    !!completion ||
    denied ||
    !!state.error ||
    state.isFetching ||
    readFailure ||
    reloadNeeded ||
    !state.data;
  const submit = () => {
    if (
      !canReview ||
      blocked ||
      submitting.current ||
      reading.current ||
      acceptedWrite.current ||
      completion ||
      !confirming ||
      expectedRevision === null ||
      !explanation.trim()
    )
      return;
    submitting.current = true;
    setWritePending(true);
    setOutcome(null);
    const input = {
      action,
      explanation,
      expectedRevision,
    };
    if (userId) save.mutate({ ...input, userId });
    else request.mutate(input);
  };
  const recovery = accepted ? (
    <InlineNotice
      tone={refreshFailed ? "error" : "info"}
      announcement={refreshFailed ? "alert" : "status"}
      action={
        refreshFailed && (
          <Button
            disabled={busy}
            onClick={() => {
              void retryRead();
            }}
          >
            {t("retryRefresh")}
          </Button>
        )
      }
    >
      <p className="font-medium">
        {t(requestedOutcome ? "requested" : "saved")}
      </p>
      <p className="mt-1">
        {t(refreshFailed ? "refreshFailed" : "refreshing")}
      </p>
    </InlineNotice>
  ) : reloadNeeded ? (
    <InlineNotice
      tone="warning"
      action={
        <Button
          disabled={busy}
          onClick={() => {
            void retryRead(true);
          }}
        >
          {t("reload")}
        </Button>
      }
    >
      <p>{t("reloadHelp")}</p>
      {(error ?? readFailure) && (
        <p className="mt-1">{readFailure ? t("readFailed") : error?.message}</p>
      )}
    </InlineNotice>
  ) : state.error || readFailure ? (
    <InlineNotice
      tone="error"
      announcement="alert"
      action={
        <Button
          disabled={busy}
          onClick={() => {
            void retryRead();
          }}
        >
          {t("retryRefresh")}
        </Button>
      }
    >
      {t("readFailed")}
    </InlineNotice>
  ) : null;
  if (denied)
    return (
      <StatePanel
        kind="denied"
        title={t("accessDenied")}
        action={
          <Button
            disabled={busy}
            onClick={() => {
              void retryRead();
            }}
          >
            {t("retryRefresh")}
          </Button>
        }
      />
    );
  if (!userId && state.data?.role === "VIEWER") return null;
  if (!state.data)
    return (
      <StatePanel
        kind={(state.error ?? readFailure) ? "error" : "loading"}
        title={t((state.error ?? readFailure) ? "loadFailed" : "loading")}
        action={
          (state.error ?? readFailure) && (
            <Button
              disabled={busy}
              onClick={() => {
                void retryRead();
              }}
            >
              {t("retryRefresh")}
            </Button>
          )
        }
      />
    );
  return (
    <section
      className="mt-5 space-y-4 border-t border-slate-200 pt-5"
      aria-busy={ownPending}
    >
      <h3 className="section-title">{t("title")}</h3>
      <p className="muted text-sm">{t("help")}</p>
      {state.data && (
        <p className="text-sm font-medium">
          {t("current")}:{" "}
          {departed
            ? t(
                state.data.departure?.reason === "TRANSFERRED"
                  ? "transferred"
                  : "graduated",
              )
            : t("enrolled")}
          {state.data.departure?.observerRevoked ? " · " + t("revoked") : ""}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">{t("change")}</span>
          <select
            className="select min-h-11 w-full lg:min-h-10"
            value={action}
            disabled={blocked || (retired && !canReview)}
            onChange={(e) => {
              if (!blocked) setAction(e.target.value as typeof selectedAction);
            }}
          >
            {!retired && (
              <option value="TRANSFERRED">{t("transferred")}</option>
            )}
            {!retired && <option value="GRADUATED">{t("graduated")}</option>}
            {(departed || retired || selectedAction === "RETURN") && (
              <option value="RETURN" disabled={!departed}>
                {t("return")}
              </option>
            )}
            {userId &&
              !retired &&
              (departed || ["REVOKE", "RESTORE"].includes(selectedAction)) && (
                <>
                  <option value="REVOKE" disabled={!departed}>
                    {t("revoke")}
                  </option>
                  <option value="RESTORE" disabled={!departed}>
                    {t("restore")}
                  </option>
                </>
              )}
          </select>
        </label>
        <label className="block">
          <span className="label">{t("reason")}</span>
          <textarea
            className="textarea w-full"
            rows={2}
            maxLength={1000}
            value={explanation}
            disabled={blocked || !canReview}
            onChange={(e) => {
              if (!blocked && canReview) setExplanation(e.target.value);
            }}
          />
        </label>
      </div>
      <Button
        disabled={!explanation.trim() || blocked || !canReview}
        onClick={() => {
          if (
            !blocked &&
            canReview &&
            !submitting.current &&
            !reading.current &&
            !acceptedWrite.current &&
            !completion &&
            state.data &&
            explanation.trim()
          )
            setConfirming(true);
        }}
      >
        {t(
          userId && ["HEAD", "ADMIN"].includes(state.data?.role ?? "")
            ? "review"
            : "request",
        )}
      </Button>
      {!confirming && recovery}
      {outcome && (
        <p role="status" className="text-sm text-teal-800">
          {outcome}
        </p>
      )}
      {error && !confirming && !accepted && !reloadNeeded && (
        <p role="alert" className="text-sm text-red-700">
          {error.message}
        </p>
      )}
      {confirming && (
        <ProfileDialog
          title={t("review")}
          pending={ownPending}
          onClose={() => setConfirming(false)}
        >
          <ChangeReview
            title={t(
              action === "TRANSFERRED"
                ? "transferred"
                : action === "GRADUATED"
                  ? "graduated"
                  : action === "RETURN"
                    ? "return"
                    : action === "REVOKE"
                      ? "revoke"
                      : "restore",
            )}
            evidence={<p className="text-sm">{explanation}</p>}
            consequences={
              <>
                <p className="text-sm">
                  {t(
                    action === "RETURN"
                      ? retired
                        ? "retiredReturnHelp"
                        : "returnHelp"
                      : action === "REVOKE" || action === "RESTORE"
                        ? "accessHelp"
                        : "consequences",
                  )}
                </p>
                <p className="rounded-lg bg-slate-50 p-3 text-sm">
                  {t("retained")}
                </p>
              </>
            }
            actions={
              <Button
                variant="primary"
                disabled={blocked || !canReview}
                onClick={submit}
              >
                {t("confirm")}
              </Button>
            }
          />
          {recovery}
          {error && !accepted && !reloadNeeded && (
            <p role="alert" className="text-sm text-red-700">
              {error.message}
            </p>
          )}
        </ProfileDialog>
      )}
      {!userId && (
        <DisclosureSection title={t("requests")} lifetime="lazy">
          <ManagementActions reviewer={false} />
        </DisclosureSection>
      )}
      {!!state.data?.events.length && (
        <DisclosureSection title={t("history")} lifetime="mounted">
          <ol className="space-y-2 text-sm">
            {state.data.events.map((event) => (
              <li key={event.id} className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">
                  {t(
                    event.action === "TRANSFERRED"
                      ? "transferred"
                      : event.action === "GRADUATED"
                        ? "graduated"
                        : event.action === "RETURN"
                          ? "return"
                          : event.action === "REVOKE"
                            ? "revoke"
                            : "restore",
                  )}
                </span>
                <p className="muted mt-1">{event.explanation}</p>
              </li>
            ))}
          </ol>
        </DisclosureSection>
      )}
    </section>
  );
}
