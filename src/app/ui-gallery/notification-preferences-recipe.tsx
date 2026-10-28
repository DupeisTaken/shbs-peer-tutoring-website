"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { notificationCategories } from "~/lib/notification-categories";
import {
  NotificationPreferenceFields,
  type NotificationPreferenceChoice,
} from "~/app/_components/notification-preference-fields";
import { Button } from "~/app/_components/ui/button";
import { FormActions, InlineNotice } from "~/app/_components/ui/patterns";

const initial = notificationCategories.map((category) => ({
  category,
  badgeEnabled: true,
  emailEnabled: false,
}));

/** Local staged choices demonstrate the production fields without sending mail. */
export function NotificationPreferencesRecipe() {
  const t = useTranslations("notificationPreferences");
  const ui = useTranslations("uiPatterns");
  const program = useTranslations("programEmail");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [saved, setSaved] = useState<NotificationPreferenceChoice[]>(initial);
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState(false);
  return (
    <section
      className="card space-y-4 p-5"
      id="notification-preferences-example"
    >
      <h2 className="section-title">{t("title")}</h2>
      <p className="text-sm text-slate-600">{t("help")}</p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={emailEnabled}
          onChange={(event) => setEmailEnabled(event.target.checked)}
        />
        {program("enable")}
      </label>
      {!emailEnabled && (
        <InlineNotice tone="info">{t("disabled")}</InlineNotice>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const accepted = draft.map((row) => ({
            ...row,
            emailEnabled: emailEnabled
              ? row.emailEnabled
              : (saved.find((item) => item.category === row.category)
                  ?.emailEnabled ?? false),
          }));
          setSaved(accepted);
          setDraft(accepted);
          setNotice(true);
        }}
      >
        <NotificationPreferenceFields
          rows={saved.map((row) => ({
            ...row,
            badgeAvailable: row.category !== "reminders",
            emailEditable: emailEnabled,
          }))}
          choices={draft}
          disabled={false}
          onChange={(choice) => {
            setNotice(false);
            setDraft((rows) =>
              rows.map((row) =>
                row.category === choice.category ? choice : row,
              ),
            );
          }}
        />
        <p className="mb-4 text-xs text-slate-600">{t("essential")}</p>
        <FormActions>
          <Button type="submit" variant="primary">
            {t("save")}
          </Button>
          <Button
            onClick={() => {
              setDraft(saved);
              setNotice(false);
            }}
          >
            {ui("cancel")}
          </Button>
        </FormActions>
      </form>
      {notice && (
        <InlineNotice tone="success" announcement="status">
          {t("saved")}
        </InlineNotice>
      )}
    </section>
  );
}
