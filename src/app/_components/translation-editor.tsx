"use client";

import { Activity, useRef, useState } from "react";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { SectionTabs } from "./ui/section-tabs";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { getQueryKey } from "@trpc/react-query";
import { translationAccess } from "~/lib/translation-access";
import { LanguagesPanel } from "./languages-panel";
import { TranslationStrings } from "./translation-strings";
import { TranslationComposer } from "./translation-composer";
import { TranslationReview } from "./translation-review";
import { useSessionAccessDenied } from "./session-view-state";
import { TranslationIntentRecovery } from "./translation-intent-recovery";

type View = "strings" | "website" | "review" | "languages";

/** Retained owners keep admitted writes; their private DOM follows live authority. */
export function TranslationEditor({
  initialView = "strings",
}: {
  initialView?: View;
}) {
  const t = useTranslations("translationEditor");
  const common = useTranslations("common");
  const languageLabel = useTranslations("localization")("languagesHeading");
  const me = api.account.me.useQuery();
  const access = translationAccess(me.data);
  const denied = useSessionAccessDenied({
    ...me,
    isSuccess: me.isSuccess && me.data != null,
    denialKey: "translation-account",
    queryKey: getQueryKey(api.account.me, undefined, "query"),
  });
  const missingRead = me.isSuccess && me.data == null;
  const readError =
    me.error ?? (missingRead ? new Error(t("identityReadFailed")) : null);
  const concealed = denied || !me.data || !access.enter;
  const [identity, setIdentity] = useState("");
  // A new verified identity gets new owners. Late callbacks remain bound to the
  // previous mounted identity rather than populating another account's drafts.
  const [retrying, setRetrying] = useState(false);
  const retryLease = useRef(false);
  const retryIdentity = async () => {
    if (retryLease.current) return;
    retryLease.current = true;
    setRetrying(true);
    try {
      await me.refetch();
    } finally {
      retryLease.current = false;
      setRetrying(false);
    }
  };
  const [selected, setSelected] = useState<View>(initialView);
  const [visited, setVisited] = useState<View[]>([]);
  // Catalog administration is independent of permission to edit translation text.
  const canOpenLanguages = access.publish || access.edit;
  const view: View =
    selected === "languages" && canOpenLanguages
      ? "languages"
      : access.edit && selected !== "languages"
        ? selected
        : "review";
  const viewLabel = (tab: View) =>
    tab === "languages" ? languageLabel : t(tab);
  if (me.isSuccess && me.data?.id && !me.error && identity !== me.data.id) {
    setIdentity(me.data.id);
    setVisited(concealed ? [] : [view]);
  } else if (!concealed && !visited.includes(view))
    setVisited([...visited, view]);
  const stringsConcealed = concealed || !access.edit;
  const languagesConcealed = concealed || !canOpenLanguages;
  return (
    <div key={identity} className="space-y-6">
      {/* Receipt checks contain no translation payload and remain available to
          the original verified actor after their editing assignment is lost. */}
      <TranslationIntentRecovery
        actorId={!denied && !me.error && me.isSuccess ? me.data?.id : null}
        refreshAuthority={async () => {
          await me.refetch({ throwOnError: true });
        }}
      />
      {me.isLoading && !me.data && <p role="status">{t("loading")}</p>}
      {(denied || (!me.data && !me.isLoading)) && (
        <StatePanel
          kind={denied ? "denied" : "error"}
          title={
            denied
              ? t("noAccess")
              : (readError?.message ?? t("identityReadFailed"))
          }
          action={
            <Button disabled={retrying} onClick={() => void retryIdentity()}>
              {common("retry")}
            </Button>
          }
        />
      )}
      {!denied && me.data && !access.enter && (
        <p role="alert">{t("noAccess")}</p>
      )}
      <div hidden={concealed} className="space-y-6">
        <header className="space-y-2 border-b border-slate-200 pb-5">
          <p className="text-accent-700 text-xs font-semibold tracking-widest uppercase">
            {t("workspace")}
          </p>
          <h1 className="page-title">{t("title")}</h1>
          <p className="muted max-w-2xl">
            {t(
              access.edit
                ? access.publish
                  ? "publisherHelp"
                  : "editorHelp"
                : "reviewerHelp",
            )}
          </p>
        </header>
        {!concealed && readError && (
          <InlineNotice
            tone="error"
            announcement="alert"
            action={
              <Button disabled={retrying} onClick={() => void retryIdentity()}>
                {common("retry")}
              </Button>
            }
          >
            {readError.message}
          </InlineNotice>
        )}
        <fieldset disabled={!!readError} className="min-w-0">
          <SectionTabs<View>
            label={t("title")}
            items={(
              [
                ...(access.edit ? (["strings", "website"] as const) : []),
                "review",
                ...(canOpenLanguages ? (["languages"] as const) : []),
              ] as View[]
            ).map((tab) => ({ value: tab, label: viewLabel(tab) }))}
            value={view}
            onChange={(next) => {
              if (concealed || readError) return;
              setVisited((previous) => [...new Set([...previous, view, next])]);
              setSelected(next);
            }}
          >
            {/* Concealment renders owners even for hidden tabs, removing private
            DOM while their admitted writes and accepted receipts stay alive. */}
            {visited.includes("strings") && (
              <Activity
                mode={
                  stringsConcealed || view === "strings" ? "visible" : "hidden"
                }
              >
                <TranslationStrings concealed={stringsConcealed} />
              </Activity>
            )}
            {visited.includes("website") && (
              <Activity
                mode={
                  stringsConcealed || view === "website" ? "visible" : "hidden"
                }
              >
                <TranslationComposer concealed={stringsConcealed} />
              </Activity>
            )}
            {visited.includes("review") && (
              <Activity
                mode={concealed || view === "review" ? "visible" : "hidden"}
              >
                <TranslationReview concealed={concealed} />
              </Activity>
            )}
            {visited.includes("languages") && (
              <Activity
                mode={
                  languagesConcealed || view === "languages"
                    ? "visible"
                    : "hidden"
                }
              >
                <LanguagesPanel
                  canAdd={access.edit}
                  concealed={languagesConcealed}
                />
              </Activity>
            )}
          </SectionTabs>
        </fieldset>
      </div>
    </div>
  );
}
