"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  translationIntentClient,
  type TranslationIntentClient,
  type TranslationIntentSnapshot,
} from "~/lib/translation-intent-client";

const serverSnapshot: TranslationIntentSnapshot = {
  ready: false,
  storageError: false,
  entries: [],
};

/** A passive way back after a former workspace redirects away. Only the shared
 * metadata store is observed here; the destination owns all live recovery reads. */
export function TranslationIntentRecoveryLink({
  actorId,
  client = translationIntentClient,
}: {
  actorId?: string | null;
  client?: TranslationIntentClient;
}) {
  const t = useTranslations("translationIntent");
  const snapshot = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    () => serverSnapshot,
  );
  useEffect(() => {
    if (actorId) client.hydrate();
  }, [actorId, client]);
  if (
    !actorId ||
    !snapshot.ready ||
    !snapshot.entries.some(
      (entry) =>
        entry.metadata.actorId === actorId && entry.status !== "PENDING",
    )
  )
    return null;

  return (
    <aside className="mx-auto w-full max-w-7xl px-4 pt-3 lg:px-6">
      {/* A native link cannot prefetch a destination or receipt on hover. */}
      <a
        href="/localization"
        className="btn-secondary inline-flex min-h-11 items-center"
      >
        {t("title")}
      </a>
    </aside>
  );
}
