"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  isTranslationIntentUnresolved,
  isTranslationAuthorityError,
  translationIntentClient,
  type TranslationIntentClient,
  type TranslationIntentMetadata,
} from "~/lib/translation-intent-client";
import { useTranslationIntentRegistry } from "./use-translation-intent";
import { Button } from "./ui/button";
import { InlineNotice } from "./ui/patterns";

/** Mount outside the private editor/disabled fieldset. actorId must come from
 * verified account authority; Translator assignment is not metadata authority.
 * This surface itself requests only own receipt metadata, never destination text. */
export function TranslationIntentRecovery({
  actorId,
  refreshAuthority,
  client = translationIntentClient,
}: {
  actorId?: string | null;
  refreshAuthority?: () => Promise<unknown>;
  client?: TranslationIntentClient;
}) {
  const t = useTranslations("translationIntent");
  const snapshot = useTranslationIntentRegistry(client);
  const utils = api.useUtils();
  const stopping = api.translationIntent.stop.useMutation({ retry: false });
  const leases = useRef(new Set<string>());
  const currentActor = useRef(actorId);
  useLayoutEffect(() => {
    currentActor.current = actorId;
  }, [actorId]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [authorityBusy, setAuthorityBusy] = useState(false);
  const authorityLease = useRef(false);
  const entries = snapshot.entries.filter(
    (entry) => entry.metadata.actorId === actorId,
  );
  if (!snapshot.storageError && !entries.length) return null;
  const action = async (
    metadata: TranslationIntentMetadata,
    operation:
      "lookup" | "stop" | "retry" | "refresh" | "dismiss" | "authority",
  ) => {
    const leaseKey = `${metadata.actorId}\0${metadata.id}`;
    const controlKey = `${leaseKey}\0${operation}`;
    if (
      currentActor.current !== metadata.actorId ||
      leases.current.has(controlKey)
    )
      return;
    // Serialize each control independently: a held lookup/account read or retry
    // must leave durable Stop available. The hook also fences duplicate POSTs.
    leases.current.add(controlKey);
    setBusy(new Set(leases.current));
    try {
      if (operation === "dismiss") {
        client.dismiss(metadata);
        return;
      }
      if (operation === "retry") {
        await client.retry(metadata);
        return;
      }
      if (operation === "refresh") {
        await client.refresh(metadata);
        return;
      }
      if (operation === "authority") {
        await client.recheck(metadata);
        return;
      }
      const input = { actorId: metadata.actorId, intentId: metadata.id };
      const result =
        operation === "lookup"
          ? await utils.translationIntent.get.fetch(input, { staleTime: 0 })
          : await stopping.mutateAsync(input);
      // Old-actor results remain historical in their own registry partition.
      // Registered owner callbacks independently reject new-actor delivery.
      const terminal = client.resolve(metadata, result);
      if (terminal.status !== "NOT_RECORDED") await client.deliver(metadata);
      else if (operation === "stop") client.error(metadata, "read");
    } catch (error) {
      // Never render a transport error containing submitted text or hash data.
      if (!client.terminal(metadata)) {
        if (isTranslationAuthorityError(error)) client.denyAuthority(metadata);
        client.error(metadata, "read");
      }
    } finally {
      leases.current.delete(controlKey);
      setBusy(new Set(leases.current));
    }
  };
  return (
    <section className="card space-y-4 p-4 sm:p-6" aria-label={t("title")}>
      <div>
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-2 text-sm">{t("help")}</p>
      </div>
      {snapshot.storageError && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button onClick={() => client.hydrate()}>
              {t("retryStorage")}
            </Button>
          }
        >
          {t("storageFailed")}
        </InlineNotice>
      )}
      {!actorId && <p role="status">{t("signIn")}</p>}
      {entries.map((entry) => {
        const metadata = entry.metadata;
        const leaseKey = `${metadata.actorId}\0${metadata.id}`;
        const unresolved = isTranslationIntentUnresolved(entry);
        return (
          <article
            key={leaseKey}
            className="space-y-3 rounded-lg border border-slate-200 p-3"
          >
            <p className="font-medium">
              {t(`operations.${metadata.operation}`)} ·{" "}
              {t(`modes.${metadata.mode}`)}
            </p>
            <p className="muted text-xs break-all">
              {t("reference", { id: metadata.id })}
            </p>
            <p role="status">
              {t(
                entry.status === "PENDING"
                  ? "pending"
                  : entry.status === "UNKNOWN"
                    ? "unknown"
                    : entry.status === "STOPPED"
                      ? "stopped"
                      : metadata.mode === "DRAFT"
                        ? "acceptedDraft"
                        : "acceptedPublished",
              )}
            </p>
            {entry.absent && <p className="text-sm">{t("notRecorded")}</p>}
            {unresolved && entry.needsAuthority && (
              <p className="text-sm">{t("authorityRequired")}</p>
            )}
            {unresolved && !entry.canRetry && (
              <p className="muted text-sm">{t("restoreOnly")}</p>
            )}
            {entry.error && (
              <p role="alert" className="text-sm text-red-700">
                {t(
                  entry.error === "storage"
                    ? "storageFailed"
                    : entry.error === "submit"
                      ? "submitFailed"
                      : entry.error === "refresh"
                        ? "refreshFailed"
                        : entry.error === "authority"
                          ? "authorityRequired"
                          : "readFailed",
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {unresolved && (
                <>
                  <Button
                    disabled={busy.has(`${leaseKey}\0lookup`)}
                    onClick={() => void action(metadata, "lookup")}
                  >
                    {t("lookup")}
                  </Button>
                  <Button
                    disabled={busy.has(`${leaseKey}\0stop`)}
                    onClick={() => void action(metadata, "stop")}
                  >
                    {t("stop")}
                  </Button>
                  {entry.canRetry && (
                    <Button
                      disabled={busy.has(`${leaseKey}\0retry`)}
                      onClick={() => void action(metadata, "retry")}
                    >
                      {t("retryExact")}
                    </Button>
                  )}
                  {entry.canRecheck && (
                    <Button
                      disabled={busy.has(`${leaseKey}\0authority`)}
                      onClick={() => void action(metadata, "authority")}
                    >
                      {t("refreshAuthority")}
                    </Button>
                  )}
                </>
              )}
              {entry.status === "ACCEPTED" && entry.canRefresh && (
                <Button
                  disabled={busy.has(`${leaseKey}\0refresh`)}
                  onClick={() => void action(metadata, "refresh")}
                >
                  {t("refreshAccepted")}
                </Button>
              )}
              {!unresolved && (
                <Button
                  disabled={busy.has(`${leaseKey}\0dismiss`)}
                  onClick={() => void action(metadata, "dismiss")}
                >
                  {t("dismiss")}
                </Button>
              )}
            </div>
          </article>
        );
      })}
      {refreshAuthority && (
        <Button
          disabled={authorityBusy}
          onClick={() => {
            if (authorityLease.current) return;
            authorityLease.current = true;
            setAuthorityBusy(true);
            void Promise.resolve()
              .then(refreshAuthority)
              .catch(() => undefined)
              .finally(() => {
                authorityLease.current = false;
                setAuthorityBusy(false);
              });
          }}
        >
          {t("refreshAuthority")}
        </Button>
      )}
    </section>
  );
}

/** Reusable metadata-only route fallback. It neither grants translation editing
 * nor mounts any destination reader; the owning server layout keeps its normal
 * sign-in/lifecycle checks and chooses whether to render this entry. */
export function TranslationIntentRecoveryEntry({
  client = translationIntentClient,
}: {
  client?: TranslationIntentClient;
}) {
  const account = api.account.me.useQuery();
  const t = useTranslations("translationIntent");
  const editor = useTranslations("translationEditor");
  const ui = useTranslations("uiPatterns");
  const snapshot = useTranslationIntentRegistry(client);
  const lease = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const actorId =
    account.isSuccess && !account.error ? account.data?.id : undefined;
  const refreshAccount = async () => {
    if (lease.current) return;
    lease.current = true;
    setRefreshing(true);
    try {
      await account.refetch({ throwOnError: true });
    } finally {
      lease.current = false;
      setRefreshing(false);
    }
  };
  return (
    <div className="space-y-4">
      <h1 className="page-title">{t("title")}</h1>
      {account.isLoading && <p role="status">{editor("loading")}</p>}
      {(account.error != null ||
        (account.isSuccess && account.data == null)) && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button
              disabled={refreshing}
              onClick={() => {
                void refreshAccount().catch(() => undefined);
              }}
            >
              {ui("retry")}
            </Button>
          }
        >
          {editor("identityReadFailed")}
        </InlineNotice>
      )}
      {actorId &&
        snapshot.ready &&
        !snapshot.entries.some(
          (entry) => entry.metadata.actorId === actorId,
        ) && <p>{t("noRequests")}</p>}
      <TranslationIntentRecovery
        actorId={actorId}
        refreshAuthority={refreshAccount}
        client={client}
      />
    </div>
  );
}
