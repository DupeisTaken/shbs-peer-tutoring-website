"use client";
import { ParticipantName } from "./participant-name";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";

/** The displayed directory rows supply choices; only deliberate IDs select a pair.
 * Hiding either identity discards its review without cancelling an admitted write. */
export function CombineAccounts({
  visibleAccounts,
  onPendingChange,
}: {
  visibleAccounts: readonly {
    userId: string | null;
    name: string;
    email: string | null;
    role: string | null;
  }[];
  onPendingChange?: (pending: boolean) => void;
}) {
  const t = useTranslations("combineAccounts");
  const patterns = useTranslations("uiPatterns");
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [survivorId, setSurvivorId] = useState("");
  const [duplicateId, setDuplicateId] = useState("");
  const [preview, setPreview] = useState<
    RouterOutputs["accountCombine"]["preview"] | null
  >(null);
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const admission = useRef(false);
  const [admitted, setAdmitted] = useState(false);
  const generation = useRef(0);
  const visibleIds = useMemo(
    () =>
      new Set(
        visibleAccounts.flatMap((row) => (row.userId ? [row.userId] : [])),
      ),
    [visibleAccounts],
  );
  const latestVisibleIds = useRef(visibleIds);
  // Only committed directory rows may authorize a delayed preview response.
  useLayoutEffect(() => {
    latestVisibleIds.current = visibleIds;
  }, [visibleIds]);
  const candidates = api.accountCombine.candidates.useQuery(undefined, {
    enabled: open,
  });
  const combine = api.accountCombine.combine.useMutation({
    onSuccess: async () => {
      setPreview(null);
      setPassword("");
      setAcknowledged(false);
      setSurvivorId("");
      setDuplicateId("");
      setDone(true);
      // A merge changes ownership across every workspace, including retained history.
      await refresh();
    },
    onError: (failure) => {
      setError(failure.message);
      setPassword("");
      setAcknowledged(false);
      setPreview(null);
    },
    onSettled: () => {
      admission.current = false;
      setAdmitted(false);
      onPendingChange?.(false);
    },
  });
  const mutationPending = admitted || combine.isPending;
  const pending = loading || mutationPending;
  useEffect(() => {
    onPendingChange?.(mutationPending);
  }, [mutationPending, onPendingChange]);
  const available = candidates.data?.filter((person) =>
    visibleIds.has(person.id),
  );
  const pairVisible =
    (!survivorId || visibleIds.has(survivorId)) &&
    (!duplicateId || visibleIds.has(duplicateId));
  // Filters/search are the candidate authority in this page. A hidden pair never
  // regains a review from a delayed response; an admitted mutation remains owned.
  useEffect(() => {
    if (pairVisible || admission.current || mutationPending) return;
    generation.current++;
    setSurvivorId("");
    setDuplicateId("");
    setPreview(null);
    setPassword("");
    setAcknowledged(false);
    setLoading(false);
    setError(null);
  }, [pairVisible, mutationPending]);
  async function refresh() {
    setRefreshError(false);
    try {
      await settleRefreshes([
        () => utils.invalidate(),
        () => invalidateAndReport(utils.admin.accounts),
        () => invalidateAndReport(utils.accountCombine.candidates),
      ]);
    } catch {
      setRefreshError(true);
    }
  }
  function resetReview() {
    generation.current++;
    setPreview(null);
    setPassword("");
    setAcknowledged(false);
    setError(null);
    setDone(false);
  }
  async function review() {
    resetReview();
    const requestGeneration = generation.current;
    const pair = { survivorId, duplicateId };
    setLoading(true);
    try {
      const result = await utils.accountCombine.preview.fetch(pair);
      if (
        requestGeneration === generation.current &&
        latestVisibleIds.current.has(pair.survivorId) &&
        latestVisibleIds.current.has(pair.duplicateId)
      )
        setPreview(result);
    } catch (failure) {
      if (requestGeneration === generation.current)
        setError(failure instanceof Error ? failure.message : t("failed"));
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }
  return (
    <section className="card overflow-hidden" aria-labelledby="combine-title">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 id="combine-title" className="font-semibold">
            {t("title")}
          </h2>
          <p className="muted mt-1 text-sm">{t("intro")}</p>
        </div>
        <button
          type="button"
          className="btn-secondary min-h-11 lg:min-h-9"
          aria-expanded={open}
          aria-controls="combine-content"
          disabled={pending}
          onClick={() => {
            setOpen(!open);
            resetReview();
          }}
        >
          {open ? t("close") : t("open")}
        </button>
      </div>
      {refreshError && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button onClick={() => void refresh()}>{patterns("retry")}</Button>
          }
        >
          {t("savedRefreshFailed")}
        </InlineNotice>
      )}
      {open && (
        <div
          id="combine-content"
          className="space-y-4 border-t border-slate-200 p-4"
        >
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            {t("warning")}
          </p>
          <p className="muted text-sm">{t("filteredChoices")}</p>
          <p className="muted text-sm">{t("readySurvivor")}</p>
          {candidates.error && (
            <StatePanel
              kind="error"
              title={patterns("loadFailed")}
              action={
                <Button
                  disabled={candidates.isFetching}
                  onClick={() => void candidates.refetch()}
                >
                  {patterns("retry")}
                </Button>
              }
            >
              {candidates.error.message}
            </StatePanel>
          )}
          {!candidates.data && !candidates.error && (
            <StatePanel kind="loading" title={t("loading")} />
          )}
          {available?.length === 0 && (
            <StatePanel kind="empty" title={t("noCandidates")} />
          )}
          {/* Keep cached identities visible after a transient failure; only initial
              unavailability prevents selection. Preview authority stays server-side. */}
          <div className="grid gap-4 md:grid-cols-2">
            {(["survivor", "duplicate"] as const).map((kind) => (
              <label key={kind} className="space-y-1 text-sm font-medium">
                <span>{t(kind)}</span>
                <select
                  className="input min-h-11 w-full"
                  aria-label={t(kind)}
                  value={
                    pairVisible
                      ? kind === "survivor"
                        ? survivorId
                        : duplicateId
                      : ""
                  }
                  disabled={pending || refreshError || !available?.length}
                  onChange={(event) => {
                    if (admission.current) return;
                    resetReview();
                    (kind === "survivor" ? setSurvivorId : setDuplicateId)(
                      event.target.value,
                    );
                  }}
                >
                  <option value="">{t("choose")}</option>
                  {available?.map((person) => (
                    <option
                      key={person.id}
                      value={person.id}
                      disabled={
                        person.id ===
                        (kind === "survivor" ? duplicateId : survivorId)
                      }
                    >
                      <ParticipantName
                        name={person.name}
                        username={person.username}
                      />{" "}
                      · {person.email} · {person.role}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary min-h-11"
            disabled={
              pending ||
              refreshError ||
              !available?.length ||
              !pairVisible ||
              !survivorId ||
              !duplicateId ||
              survivorId === duplicateId
            }
            onClick={() => void review()}
          >
            {loading ? t("loading") : t("preview")}
          </button>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {done && (
            <p
              role="status"
              className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
            >
              {t("success")}
            </p>
          )}
          {mutationPending && <p role="status">{t("working")}</p>}
          {preview && pairVisible && (
            <div className="space-y-4" aria-live="polite">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                  <h3 className="text-sm font-semibold">{t("retained")}</h3>
                  <p className="mt-2 font-medium">{preview.survivor.name}</p>
                  <p className="mt-2 font-medium break-all">
                    {preview.survivor.email}
                  </p>
                  <p className="text-sm">
                    @{preview.survivor.username ?? "—"} · {preview.result.role}
                  </p>
                  <p className="mt-2 text-sm">
                    {t("access", {
                      tutor: preview.linkedProfiles?.tutor ?? "—",
                      student: preview.linkedProfiles?.student ?? "—",
                      crew: preview.result.crewStatus ?? "—",
                      translator: preview.result.canTranslate
                        ? t("yes")
                        : t("no"),
                    })}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold">{t("retired")}</h3>
                  <p className="mt-2 font-medium break-all">
                    {preview.duplicate.email}
                  </p>
                  <p className="text-sm">
                    @{preview.duplicate.username ?? "—"}
                  </p>
                  <p className="muted mt-2 text-sm break-all">
                    {t("reserved", {
                      emails: preview.retiredEmails.join(", "),
                    })}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {Object.entries(preview.counts).map(([key, count]) => (
                  <div
                    key={key}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <p className="text-xl font-semibold tabular-nums">
                      {count}
                    </p>
                    <p className="muted text-sm">{t(`counts.${key}`)}</p>
                  </div>
                ))}
              </div>
              <p className="muted text-sm">{t("history")}</p>
              {preview.conflicts.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"
                >
                  <h3 className="font-semibold">{t("blocked")}</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {preview.conflicts.map((conflict) => (
                      <li key={conflict}>{conflict}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <form
                  className="space-y-3 border-t border-slate-200 pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (
                      !admission.current &&
                      !pending &&
                      !refreshError &&
                      pairVisible &&
                      password &&
                      acknowledged
                    ) {
                      admission.current = true;
                      setAdmitted(true);
                      onPendingChange?.(true);
                      combine.mutate({
                        survivorId,
                        duplicateId,
                        fingerprint: preview.fingerprint,
                        confirmPassword: password,
                      });
                    }
                  }}
                >
                  <label className="flex min-h-11 items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={pending}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                      className="mt-1 h-5 w-5 shrink-0"
                    />
                    <span>{t("acknowledge")}</span>
                  </label>
                  <label className="block max-w-sm space-y-1 text-sm font-medium">
                    <span>{t("password")}</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={pending}
                      className="input min-h-11 w-full"
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-primary min-h-11"
                    disabled={pending || !password || !acknowledged}
                  >
                    {combine.isPending ? t("working") : t("confirm")}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
