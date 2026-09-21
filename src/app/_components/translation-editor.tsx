"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { translationAccess } from "~/lib/translation-access";
import { TranslationStrings } from "./translation-strings";
import { TranslationComposer } from "./translation-composer";
import { TranslationReview } from "./translation-review";

type View = "strings" | "website" | "review";

/** Mount only the selected editor: reviewers never issue translator-only content queries. */
export function TranslationEditor({
  initialView = "strings",
}: {
  initialView?: View;
}) {
  const t = useTranslations("translationEditor");
  const me = api.account.me.useQuery();
  const access = translationAccess(me.data);
  const [selected, setSelected] = useState<View>(initialView);
  const view = access.edit ? selected : "review";
  if (me.isLoading) return <p role="status">{t("loading")}</p>;
  if (me.error) return <p role="alert">{me.error.message}</p>;
  if (!access.enter) return <p role="alert">{t("noAccess")}</p>;
  return (
    <div className="space-y-6 [&_button]:min-h-11 lg:[&_button]:min-h-9 [&_input:not([type=checkbox])]:min-h-11 lg:[&_input:not([type=checkbox])]:min-h-9 [&_select]:min-h-11 lg:[&_select]:min-h-9">
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
      <nav className="flex flex-wrap gap-2" aria-label={t("title")}>
        {(
          [
            ...(access.edit ? (["strings", "website"] as const) : []),
            "review",
          ] as const
        ).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={view === tab}
            aria-controls="translation-panel"
            className={view === tab ? "btn-primary" : "btn-secondary"}
            onClick={() => setSelected(tab)}
          >
            {t(tab)}
          </button>
        ))}
      </nav>
      <section id="translation-panel" aria-label={t(view)}>
        {view === "strings" ? (
          <TranslationStrings />
        ) : view === "website" ? (
          <TranslationComposer />
        ) : (
          <TranslationReview />
        )}
      </section>
    </div>
  );
}
