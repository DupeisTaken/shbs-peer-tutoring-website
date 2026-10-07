"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import {
  ChangeReview,
  FormSection,
  InlineNotice,
  StatePanel,
} from "./ui/patterns";
import { useDialogPending } from "./ui/modal";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";

/** The disclosure owns its permission recovery; absent authority never silently
 * looks like an unsupported archive. Retained lifetime preserves unfinished review. */
export function TutorHistorySection({ tutorId }: { tutorId: string }) {
  const t = useTranslations("tutorHistory");
  const common = useTranslations("uiPatterns");
  const permissions = api.tutorHistory.permissions.useQuery();
  return (
    <section className="mt-5 border-t border-slate-200 pt-4">
      {permissions.error && (
        <StatePanel
          kind="error"
          title={common("loadFailed")}
          action={
            <Button
              disabled={permissions.isFetching}
              onClick={() => void permissions.refetch()}
            >
              {common("retry")}
            </Button>
          }
        />
      )}
      {!permissions.data && !permissions.error && (
        <StatePanel kind="loading" title={t("loading")} />
      )}
      {permissions.data?.canLink && (
        <DisclosureSection title={t("title")} lifetime="retained">
          <TutorHistoryLinkForm
            tutorId={tutorId}
            isHead={permissions.data.isHead}
            unavailable={!!permissions.error}
          />
        </DisclosureSection>
      )}
    </section>
  );
}

export function TutorHistoryLinkForm({
  tutorId,
  isHead,
  unavailable = false,
}: {
  tutorId: string;
  isHead: boolean;
  unavailable?: boolean;
}) {
  const t = useTranslations("tutorHistory");
  const common = useTranslations("uiPatterns");
  const utils = api.useUtils();
  const accountLabelId = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [preview, setPreview] = useState<
    RouterOutputs["tutorHistory"]["preview"] | null
  >(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // Synchronous admission protects both the network write and its refresh recovery.
  const submitting = useRef(false);
  const reviewingRef = useRef(false);
  const committed = useRef(false);
  const candidates = api.tutorHistory.candidates.useQuery(
    { search: query },
    { enabled: query.length >= 2 },
  );
  const resetReview = () => {
    setPreview(null);
    setAcknowledged(false);
    setPassword("");
    setError(null);
  };
  const refresh = async () => {
    setSyncing(true);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.admin.tutors),
        () => invalidateAndReport(utils.tuteeHistory.myTutorRecords),
        () => invalidateAndReport(utils.tuteeHistory.myTutorDetails),
        () => invalidateAndReport(utils.historicalAcademics),
      ]);
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      setSyncing(false);
    }
  };
  const link = api.tutorHistory.link.useMutation({
    onSuccess: async () => {
      committed.current = true;
      setSaved(true);
      resetReview();
      await refresh();
    },
    onError: (failure) => {
      resetReview();
      setError(failure.message);
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  // Register owned work only; the aggregate disables this form during sibling saves.
  const busy = useDialogPending(link.isPending || syncing);
  const disabled = busy || reviewing || unavailable || saved;
  const errorText = (message: string) =>
    t.has(message) ? t(message) : t("failed");
  return (
    <div className="space-y-4">
      {saved && (
        <InlineNotice tone="success" announcement="status">
          {t("saved")}
        </InlineNotice>
      )}
      {refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button disabled={busy} onClick={() => void refresh()}>
              {common("retry")}
            </Button>
          }
        >
          {t("refreshFailed")}
        </InlineNotice>
      )}
      <FormSection
        title={t("existingAccount")}
        description={t("help")}
        disabled={disabled}
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              disabled ||
              submitting.current ||
              reviewingRef.current ||
              search.trim().length < 2
            )
              return;
            setQuery(search.trim());
            setUserId("");
            resetReview();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="label">{t("searchAccount")}</span>
            <input
              className="input min-h-11 w-full lg:min-h-10"
              value={search}
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={search.trim().length < 2}>
            {t("search")}
          </Button>
        </form>
        {query && candidates.isFetching && !candidates.data && (
          <StatePanel kind="loading" title={t("loading")} />
        )}
        {candidates.error && (
          <StatePanel
            kind="error"
            title={common("loadFailed")}
            action={
              <Button
                disabled={candidates.isFetching}
                onClick={() => void candidates.refetch()}
              >
                {common("retry")}
              </Button>
            }
          />
        )}
        {query && candidates.data?.length === 0 && (
          <StatePanel kind="empty" title={t("noAccounts")} />
        )}
        <label className="block">
          <span id={accountLabelId} className="label">
            {t("chooseAccount")}
          </span>
          <select
            aria-labelledby={accountLabelId}
            className="input min-h-11 w-full lg:min-h-10"
            value={userId}
            disabled={!candidates.data?.length || !!candidates.error}
            onChange={(event) => {
              setUserId(event.target.value);
              resetReview();
            }}
          >
            <option value="">{t("chooseAccount")}</option>
            {candidates.data?.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name ?? account.username ?? account.email} ·{" "}
                {account.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t("evidence")}</span>
          <textarea
            className="input w-full"
            rows={3}
            value={reason}
            minLength={10}
            maxLength={1000}
            onChange={(event) => {
              setReason(event.target.value);
              resetReview();
            }}
          />
        </label>
        <Button
          disabled={!userId || reason.trim().length < 10 || !!candidates.error}
          onClick={() => {
            if (
              disabled ||
              submitting.current ||
              reviewingRef.current ||
              committed.current
            )
              return;
            reviewingRef.current = true;
            setReviewing(true);
            resetReview();
            void utils.tutorHistory.preview
              .fetch({ tutorId, userId })
              .then(setPreview)
              .catch((failure: unknown) => {
                setError(failure instanceof Error ? failure.message : "failed");
              })
              .finally(() => {
                reviewingRef.current = false;
                setReviewing(false);
              });
          }}
        >
          {t("preview")}
        </Button>
        {preview && (
          <ChangeReview
            title={t("reviewTitle")}
            evidence={
              <div className="space-y-2 break-words">
                <p>
                  {t("summary", {
                    name: preview.record.name,
                    account: preview.account.email,
                  })}
                </p>
                <p className="muted text-sm">
                  {t("counts", {
                    sessions: preview.record.counts.sessions,
                    meetings: preview.record.counts.meetingAttendances,
                    amendments: preview.record.counts.adjustments,
                  })}
                </p>
                {preview.previousOwner && (
                  <p className="text-sm">
                    {t("previousOwner", {
                      account: preview.previousOwner.email,
                    })}
                  </p>
                )}
              </div>
            }
            consequences={<p className="muted text-sm">{t("help")}</p>}
            acknowledgement={
              !preview.currentConflict &&
              !preview.alreadyLinked &&
              (!preview.conflict || isHead) && (
                <>
                  {preview.conflict && (
                    <>
                      <InlineNotice tone="warning">
                        {t("headCorrection")}
                      </InlineNotice>
                      <label className="block">
                        <span className="label">{t("password")}</span>
                        <input
                          className="input min-h-11 w-full lg:min-h-10"
                          type="password"
                          autoComplete="current-password"
                          maxLength={1024}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </label>
                    </>
                  )}
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0"
                      checked={acknowledged}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />
                    {t("confirmIdentity")}
                  </label>
                </>
              )
            }
            actions={
              preview.currentConflict ? (
                <InlineNotice tone="warning">
                  {t("HISTORY_USE_MERGE")}
                </InlineNotice>
              ) : preview.alreadyLinked ? (
                <InlineNotice>{t("alreadyLinked")}</InlineNotice>
              ) : preview.conflict && !isHead ? (
                <InlineNotice tone="warning">
                  {t("HISTORY_HEAD_REQUIRED")}
                </InlineNotice>
              ) : (
                <Button
                  variant="primary"
                  disabled={!acknowledged || (preview.conflict && !password)}
                  onClick={() => {
                    if (
                      disabled ||
                      submitting.current ||
                      committed.current ||
                      !acknowledged
                    )
                      return;
                    submitting.current = true;
                    link.mutate({
                      tutorId,
                      userId,
                      fingerprint: preview.fingerprint,
                      reason,
                      acknowledged: true,
                      ...(preview.conflict
                        ? { confirmPassword: password }
                        : {}),
                    });
                  }}
                >
                  {t("confirm")}
                </Button>
              )
            }
          />
        )}
      </FormSection>
      {error && (
        <InlineNotice tone="error" announcement="alert">
          {errorText(error)}
        </InlineNotice>
      )}
    </div>
  );
}
