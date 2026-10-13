"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { InlineNotice } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { DisclosureSection } from "./ui/disclosure-section";
import { participantNameLabel } from "./participant-name";

type Preview = RouterOutputs["admin"]["previewDeleteUser"];

/** One list-owned controller survives row removal and idle dismissal. The password
 * and reviewed fingerprint are feature drafts; accepted writes recover by reads. */
export function AccountDeletion({
  target,
  onClose,
  onDeleted,
  onRecoveryChange,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onRecoveryChange?: (blocked: boolean) => void;
}) {
  const t = useTranslations("accountDeletion");
  const common = useTranslations();
  const utils = api.useUtils();
  const formId = useId();
  const passwordId = useId();
  const admission = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const initialFocus = useRef(true);
  const focusMoved = useRef(false);
  const [admitted, setAdmitted] = useState(false);
  const [snapshot, setSnapshot] = useState<Preview | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [accepted, setAccepted] = useState<{ id: string; name: string } | null>(
    null,
  );
  const selectedId = target?.id;
  const currentTarget = useRef(selectedId);
  currentTarget.current = selectedId;
  const query = api.admin.previewDeleteUser.useQuery(
    { userId: selectedId ?? "" },
    {
      enabled: !!selectedId,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    },
  );
  useEffect(() => {
    setSnapshot(null);
    setPassword("");
    setError(null);
    setStale(false);
    setAccessDenied(false);
    initialFocus.current = true;
    focusMoved.current = false;
  }, [selectedId]);
  // Adopt only an initial fresh read. Background updates cannot silently replace
  // an existing review; explicit Reload owns replacement of the version snapshot.
  useEffect(() => {
    if (
      !snapshot &&
      selectedId &&
      query.data?.target.id === selectedId &&
      !query.isFetching &&
      !query.error
    )
      setSnapshot(query.data);
  }, [selectedId, query.data, query.isFetching, query.error, snapshot]);
  const review = snapshot?.target.id === selectedId ? snapshot : null;
  const denied = ["FORBIDDEN", "UNAUTHORIZED"].includes(
    query.error?.data?.code ?? "",
  );
  const [accessDenied, setAccessDenied] = useState(false);
  useEffect(() => {
    if (denied) {
      setAccessDenied(true);
      setSnapshot(null);
    }
  }, [denied]);
  useEffect(() => {
    if (!selectedId || review) return;
    const moved = () => {
      focusMoved.current = true;
    };
    window.addEventListener("keydown", moved, true);
    window.addEventListener("pointerdown", moved, true);
    return () => {
      window.removeEventListener("keydown", moved, true);
      window.removeEventListener("pointerdown", moved, true);
    };
  }, [selectedId, review]);
  useEffect(() => {
    if (!review || !initialFocus.current) return;
    initialFocus.current = false;
    // Async data mounts after NativeDialog's first focus pass. Focus the password
    // only when the user has not begun keyboard/pointer exploration of the review.
    if (!focusMoved.current && document.activeElement?.closest("dialog"))
      passwordInput.current?.focus();
  }, [review]);
  async function refreshList() {
    onRecoveryChange?.(true);
    setRefreshing(true);
    setRefreshError(false);
    try {
      await invalidateAndReport(utils.admin.accounts);
      onRecoveryChange?.(false);
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }
  const deletion = api.admin.deleteUser.useMutation({
    onSuccess: async (_result, variables) => {
      const done = {
        id: variables.userId,
        name: participantNameLabel(
          review?.target.name ?? target?.name,
          review?.target.username,
          common("participantNames.unnamed"),
        ),
      };
      setAccepted(done);
      setPassword("");
      onDeleted(done.id);
      await refreshList();
    },
    onError: (failure) => {
      setError(failure.message);
      if (
        failure.data?.code === "CONFLICT" ||
        failure.data?.code === "NOT_FOUND"
      )
        setStale(true);
    },
    onSettled: () => {
      admission.current = false;
      setAdmitted(false);
    },
  });
  const pending = admitted || deletion.isPending;
  const saved = !!accepted && accepted.id === selectedId;
  const fresh =
    !!review &&
    !accessDenied &&
    !query.error &&
    !query.isFetching &&
    !stale &&
    query.data?.fingerprint === review.fingerprint;
  async function reload() {
    if (admission.current || pending || saved) return;
    const result = await query.refetch();
    if (
      !admission.current &&
      currentTarget.current === selectedId &&
      !result.error &&
      result.data?.target.id === selectedId
    ) {
      setAccessDenied(false);
      setSnapshot(result.data);
      setError(null);
      setStale(false);
      setPassword("");
    }
  }
  return (
    <>
      {accepted && (!target || saved) && (
        <InlineNotice tone="success" announcement="status">
          <p>{t("saved", { name: accepted.name })}</p>
          {refreshError && <p>{t("savedRefreshFailed")}</p>}
          {refreshError && (
            <Button disabled={refreshing} onClick={() => void refreshList()}>
              {t("retryList")}
            </Button>
          )}
        </InlineNotice>
      )}
      {target && (
        <Modal
          title={common("admin.users.confirm.deleteTitle")}
          description={
            denied || accessDenied
              ? undefined
              : t("intro", { name: target.name })
          }
          busy={pending}
          onClose={() => {
            if (!admission.current) onClose();
          }}
          wide
          footer={
            <>
              <Button
                onClick={() => {
                  if (!admission.current) onClose();
                }}
              >
                {common(saved ? "common.close" : "admin.users.confirm.cancel")}
              </Button>
              {!saved && !denied && !accessDenied && (
                <Button
                  variant="danger"
                  type="submit"
                  form={formId}
                  disabled={
                    pending || !fresh || !!review?.blockers.length || !password
                  }
                >
                  {pending
                    ? common("admin.users.confirm.working")
                    : common("admin.users.delete")}
                </Button>
              )}
            </>
          }
        >
          {!saved && (
            <>
              <QueryFeedback
                hasData={!!review && !denied && !accessDenied}
                loading={!review && !query.error && !accessDenied}
                error={!!query.error}
                retrying={query.isFetching || pending}
                loadingTitle={t("loading")}
                errorTitle={t("readFailed")}
                retryLabel={t("reload")}
                onRetry={() => void reload()}
              />
              {accessDenied && !query.error && (
                <InlineNotice
                  tone="warning"
                  action={
                    <Button
                      disabled={query.isFetching || pending}
                      onClick={() => void reload()}
                    >
                      {t("reload")}
                    </Button>
                  }
                >
                  {t("readFailed")}
                </InlineNotice>
              )}
              {review && !denied && !accessDenied && (
                <div className="space-y-4">
                  <p className="font-medium break-all">
                    {review.target.email} · @{review.target.username ?? "—"}
                  </p>
                  <p className="muted text-sm">{t("consequences")}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["removed", "retained"] as const).map((kind) => (
                      <section
                        key={kind}
                        className="rounded-lg border border-slate-200 p-3"
                      >
                        <h3 className="text-sm font-semibold">{t(kind)}</h3>
                        <dl className="mt-2 space-y-1 text-sm">
                          {Object.entries(review[kind])
                            .filter(([, count]) => count > 0)
                            .map(([key, count]) => (
                              <div
                                key={key}
                                className="flex justify-between gap-3"
                              >
                                <dt>{t(`counts.${key}`)}</dt>
                                <dd className="font-semibold tabular-nums">
                                  {count}
                                </dd>
                              </div>
                            ))}
                          {!Object.values(review[kind]).some(
                            (count) => count > 0,
                          ) && <p className="muted">{t("noRecords")}</p>}
                        </dl>
                      </section>
                    ))}
                  </div>
                  <DisclosureSection title={t("fullCounts")} lifetime="lazy">
                    <dl className="grid gap-2 text-sm sm:grid-cols-2">
                      {Object.entries({
                        ...review.removed,
                        ...review.retained,
                      }).map(([key, count]) => (
                        <div key={key} className="flex justify-between gap-3">
                          <dt>{t(`counts.${key}`)}</dt>
                          <dd className="tabular-nums">{count}</dd>
                        </div>
                      ))}
                    </dl>
                  </DisclosureSection>
                  {review.blockers.length > 0 && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                    >
                      <h3 className="font-semibold">{t("blocked")}</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {review.blockers.map((key) => (
                          <li key={key}>{t(`blockers.${key}`)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(stale ||
                    (query.data &&
                      query.data.fingerprint !== review.fingerprint)) && (
                    <InlineNotice
                      tone="warning"
                      action={
                        <Button
                          disabled={pending || query.isFetching}
                          onClick={() => void reload()}
                        >
                          {t("reload")}
                        </Button>
                      }
                    >
                      {t("changed")}
                    </InlineNotice>
                  )}
                  <form
                    id={formId}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        admission.current ||
                        pending ||
                        !fresh ||
                        !review ||
                        review.blockers.length ||
                        !password
                      )
                        return;
                      admission.current = true;
                      setAdmitted(true);
                      setError(null);
                      deletion.mutate({
                        userId: review.target.id,
                        fingerprint: review.fingerprint,
                        confirmPassword: password,
                      });
                    }}
                  >
                    <fieldset
                      disabled={pending || !fresh || !!review.blockers.length}
                      className="space-y-2"
                    >
                      <label className="label" htmlFor={passwordId}>
                        {common("admin.users.confirm.passwordLabel")}
                      </label>
                      <input
                        id={passwordId}
                        type="password"
                        required
                        data-dialog-autofocus
                        autoComplete="current-password"
                        ref={passwordInput}
                        placeholder={common(
                          "admin.users.confirm.passwordPlaceholder",
                        )}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="input w-full"
                      />
                    </fieldset>
                    {error && (
                      <p role="alert" className="mt-2 text-sm text-red-700">
                        {error}
                      </p>
                    )}
                  </form>
                </div>
              )}
            </>
          )}
          {saved && (
            <p role="status">
              {t("saved", { name: accepted?.name ?? target.name })}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
