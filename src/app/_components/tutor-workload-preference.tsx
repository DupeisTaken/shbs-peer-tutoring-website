"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "./ui/button";
import { FormSection, InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { FieldRequirement } from "./field-requirement";

type Snapshot = NonNullable<RouterOutputs["tutor"]["workloadPreference"]>;
/** This form owns only its preference draft/version. Failed writes and background
 * reads never replace it; accepted saves recover reads without replaying a write. */
export function TutorWorkloadPreference() {
  const t = useTranslations("tutorWorkload");
  const [denied, setDenied] = useState(false);
  const query = api.tutor.workloadPreference.useQuery(undefined, {
    staleTime: 0,
    enabled: !denied,
  });
  const utils = api.useUtils();
  const client = useQueryClient();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const admission = useRef(false);
  const deniedNow =
    query.error?.data?.code === "FORBIDDEN" ||
    query.error?.data?.code === "UNAUTHORIZED";
  function adopt(data: Snapshot) {
    setSnapshot(data);
    setDraft(data.preferredMaximum);
    setDirty(false);
  }
  useEffect(() => {
    if (deniedNow && !denied) {
      setDenied(true);
      client.removeQueries({
        queryKey: getQueryKey(api.tutor.workloadPreference, undefined, "query"),
      });
    }
  }, [client, denied, deniedNow]);
  useEffect(() => {
    if (!query.data || denied || deniedNow || committed || refreshing) return;
    // Inactivity authoritatively resets this setting. Never revive its old active
    // draft on return; independent profile/academic forms remain untouched.
    if (query.data.status !== "ACTIVE" || !snapshot || !dirty)
      adopt(query.data);
  }, [query.data, snapshot, dirty, committed, refreshing, denied, deniedNow]);
  async function refresh(preserveDeniedDraft = false) {
    if (admission.current || refreshing) return;
    admission.current = true;
    setRefreshing(true);
    try {
      const data = await utils.tutor.workloadPreference.fetch(undefined, {
        staleTime: 0,
      });
      if (!data) throw new Error("No tutor preference response");
      if (
        preserveDeniedDraft &&
        dirty &&
        !committed &&
        snapshot &&
        data.status === "ACTIVE"
      ) {
        // Recovery establishes fresh authority, but it does not consent to
        // replacing an active draft or adopting a newer mutation version.
        setSnapshot({ ...snapshot, canEdit: data.canEdit });
      } else adopt(data);
      setDenied(false);
      setCommitted(false);
      setRefreshFailed(false);
      mutation.reset();
    } catch {
      setRefreshFailed(true);
    } finally {
      admission.current = false;
      setRefreshing(false);
    }
  }
  const mutation = api.tutor.setWorkloadPreference.useMutation({
    onError: (error) => {
      if (
        error.data?.code !== "FORBIDDEN" &&
        error.data?.code !== "UNAUTHORIZED"
      )
        return;
      // A fresh write denial is authoritative too: conceal cached preferences
      // until an explicit read establishes access again, without retrying the write.
      setDenied(true);
      client.removeQueries({
        queryKey: getQueryKey(api.tutor.workloadPreference, undefined, "query"),
      });
    },
    onSuccess: async () => {
      setCommitted(true);
      setSaved(true);
      // Release only write admission before the independent authoritative read.
      admission.current = false;
      await refresh();
    },
    onSettled: () => {
      admission.current = false;
    },
  });
  const live = query.data ?? snapshot;
  const blocked =
    denied ||
    deniedNow ||
    !live?.canEdit ||
    !!query.error ||
    committed ||
    refreshing ||
    mutation.isPending;
  if (denied || deniedNow)
    return (
      <section className="card p-5">
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button onClick={() => void refresh(true)} disabled={refreshing}>
              {t("retry")}
            </Button>
          }
        />
      </section>
    );
  return (
    <section className="card space-y-4 p-5">
      <h2 className="section-title">{t("title")}</h2>
      <p className="muted text-sm">{t("help")}</p>
      <QueryFeedback
        hasData={!!snapshot}
        loading={!snapshot && !query.error}
        error={!!query.error}
        retrying={query.isFetching}
        loadingTitle={t("loading")}
        errorTitle={t("loadFailed")}
        retryLabel={t("retry")}
        onRetry={() => void query.refetch()}
      />
      {snapshot && (
        <>
          <p className="text-sm text-slate-700">
            {query.error || query.isFetching
              ? t("stale", { count: snapshot.count })
              : t("current", { count: live!.count })}{" "}
            ·{" "}
            {live!.preferredMaximum === null
              ? t("unset")
              : t("savedPreference", { count: live!.preferredMaximum })}
          </p>
          {live!.status !== "ACTIVE" ? (
            <InlineNotice tone="info" announcement="status">
              {t("inactive")}
            </InlineNotice>
          ) : (
            !live!.canEdit && (
              <InlineNotice tone="info">{t("readOnly")}</InlineNotice>
            )
          )}
          <form
            aria-label={t("title")}
            onSubmit={(event) => {
              event.preventDefault();
              if (blocked || admission.current) return;
              admission.current = true;
              setSaved(false);
              mutation.mutate({
                preferredMaximum: draft,
                expectedVersion: snapshot.version,
              });
            }}
          >
            <FormSection
              title={t("editPreference")}
              busy={mutation.isPending || refreshing}
              disabled={blocked}
              actions={
                <>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={blocked || !dirty}
                  >
                    {t(mutation.isPending ? "saving" : "save")}
                  </Button>
                  <Button
                    disabled={blocked || !dirty}
                    onClick={() => {
                      setDraft(snapshot.preferredMaximum);
                      setDirty(false);
                      mutation.reset();
                    }}
                  >
                    {t("cancel")}
                  </Button>
                </>
              }
            >
              <label className="block text-sm">
                <span className="label">
                  {t("preference")} <FieldRequirement state="optional" />
                </span>
                <select
                  disabled={blocked}
                  className="select min-h-11 w-full lg:min-h-10"
                  value={draft ?? ""}
                  onChange={(event) => {
                    setDraft(
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                    );
                    setDirty(true);
                    setSaved(false);
                    mutation.reset();
                  }}
                  aria-describedby="workload-preference-help"
                >
                  <option value="">{t("unset")}</option>
                  {[0, 1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      {t("value", { count: value })}
                    </option>
                  ))}
                </select>
              </label>
              <p id="workload-preference-help" className="muted text-xs">
                {t("zeroHelp")}
              </p>
              <Button
                disabled={blocked || draft === null}
                onClick={() => {
                  setDraft(null);
                  setDirty(true);
                  setSaved(false);
                  mutation.reset();
                }}
              >
                {t("clear")}
              </Button>
            </FormSection>
          </form>
          {saved && (
            <p role="status" className="text-sm text-green-700">
              {t("saved")}
            </p>
          )}
          {mutation.error && (
            <InlineNotice
              tone="error"
              announcement="alert"
              action={
                mutation.error.data?.code === "CONFLICT" && (
                  <Button
                    disabled={refreshing || mutation.isPending}
                    onClick={() => void refresh()}
                  >
                    {t("reload")}
                  </Button>
                )
              }
            >
              {t(
                mutation.error.data?.code === "CONFLICT"
                  ? "conflict"
                  : "saveFailed",
              )}
            </InlineNotice>
          )}
          {dirty && live!.version !== snapshot.version && !mutation.error && (
            <InlineNotice
              tone="warning"
              action={
                <Button
                  disabled={refreshing || mutation.isPending}
                  onClick={() => void refresh()}
                >
                  {t("reload")}
                </Button>
              }
            >
              {t("conflict")}
            </InlineNotice>
          )}
          {refreshFailed && (
            <InlineNotice
              tone="error"
              announcement="alert"
              action={
                <Button
                  disabled={refreshing || mutation.isPending}
                  onClick={() => void refresh()}
                >
                  {t("retry")}
                </Button>
              }
            >
              {t(committed ? "refreshFailed" : "reloadFailed")}
            </InlineNotice>
          )}
          {live!.preferredMaximum !== null &&
            live!.count > live!.preferredMaximum &&
            !query.error &&
            !query.isFetching && (
              <InlineNotice tone="warning">
                {t("over", {
                  count: live!.count,
                  maximum: live!.preferredMaximum,
                })}
              </InlineNotice>
            )}
        </>
      )}
    </section>
  );
}
