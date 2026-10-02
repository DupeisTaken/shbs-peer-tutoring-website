"use client";

import { Activity, useState } from "react";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { SectionTabs } from "./ui/section-tabs";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { translationAccess } from "~/lib/translation-access";
import { LanguagesPanel } from "./languages-panel";
import { TranslationStrings } from "./translation-strings";
import { TranslationComposer } from "./translation-composer";
import { TranslationReview } from "./translation-review";

type View = "strings" | "website" | "review" | "languages";

/** Open editors lazily, retain drafts while hidden, and unmount revoked capabilities. */
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
  if (me.isLoading) return <p role="status">{t("loading")}</p>;
  if (me.error && !me.data)
    return (
      <StatePanel
        kind="error"
        title={me.error.message}
        action={
          <Button onClick={() => void me.refetch()}>{common("retry")}</Button>
        }
      />
    );
  if (!access.enter) return <p role="alert">{t("noAccess")}</p>;
  return (
    <div className="space-y-6 [&_button:not([role=tab])]:min-h-11 lg:[&_button:not([role=tab])]:min-h-10 [&_input:not([type=checkbox])]:min-h-11 lg:[&_input:not([type=checkbox])]:min-h-9 [&_select]:min-h-11 lg:[&_select]:min-h-9">
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
      {me.error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button onClick={() => void me.refetch()}>{common("retry")}</Button>
          }
        >
          {me.error.message}
        </InlineNotice>
      )}
      <fieldset disabled={!!me.error} className="min-w-0">
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
            setVisited((previous) => [...new Set([...previous, view, next])]);
            setSelected(next);
          }}
        >
          {/* Activity retains drafts but removes hidden effects. Authorization is
            outside the retained boundary, so revocation removes both UI and state. */}
          {access.edit &&
            (view === "strings" || visited.includes("strings")) && (
              <Activity mode={view === "strings" ? "visible" : "hidden"}>
                <TranslationStrings />
              </Activity>
            )}
          {access.edit &&
            (view === "website" || visited.includes("website")) && (
              <Activity mode={view === "website" ? "visible" : "hidden"}>
                <TranslationComposer />
              </Activity>
            )}
          {(view === "review" || visited.includes("review")) && (
            <Activity mode={view === "review" ? "visible" : "hidden"}>
              <TranslationReview />
            </Activity>
          )}
          {canOpenLanguages &&
            (view === "languages" || visited.includes("languages")) && (
              <Activity mode={view === "languages" ? "visible" : "hidden"}>
                <LanguagesPanel canAdd={access.edit} />
              </Activity>
            )}
        </SectionTabs>
      </fieldset>
    </div>
  );
}
