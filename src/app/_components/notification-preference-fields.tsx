"use client";

import { useTranslations } from "next-intl";
import type { NotificationCategory } from "~/lib/notification-categories";
import { SettingRow } from "./ui/patterns";

export type NotificationPreferenceChoice = {
  category: NotificationCategory;
  badgeEnabled: boolean;
  emailEnabled: boolean;
};
export type NotificationPreferenceAvailability =
  NotificationPreferenceChoice & {
    badgeAvailable: boolean;
    emailEditable: boolean;
  };

/** The same staged, labelled controls serve account settings and the gallery.
 * Availability stays authoritative even while the caller retains a dirty draft. */
export function NotificationPreferenceFields({
  rows,
  choices,
  disabled,
  onChange,
}: {
  rows: NotificationPreferenceAvailability[];
  choices: NotificationPreferenceChoice[];
  disabled: boolean;
  onChange: (choice: NotificationPreferenceChoice) => void;
}) {
  const t = useTranslations("notificationPreferences");
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => {
        const choice =
          choices.find((item) => item.category === row.category) ?? row;
        const category = t(`categories.${row.category}`);
        return (
          <div key={row.category} className="py-4">
            <SettingRow
              stackOnMobile
              label={category}
              description={t(`descriptions.${row.category}`)}
              control={
                <>
                  {row.badgeAvailable ? (
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-accent-600 h-4 w-4"
                        disabled={disabled}
                        aria-label={t("badgeFor", { category })}
                        checked={choice.badgeEnabled}
                        onChange={(event) =>
                          onChange({
                            ...choice,
                            badgeEnabled: event.target.checked,
                          })
                        }
                      />
                      {t("badge")}
                    </label>
                  ) : (
                    <span className="px-2 text-xs text-slate-600">
                      {t("emailOnly")}
                    </span>
                  )}
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-accent-600 h-4 w-4"
                      disabled={disabled || !row.emailEditable}
                      aria-label={t("emailFor", { category })}
                      checked={
                        row.emailEditable
                          ? choice.emailEnabled
                          : row.emailEnabled
                      }
                      onChange={(event) =>
                        onChange({
                          ...choice,
                          emailEnabled: event.target.checked,
                        })
                      }
                    />
                    {t("email")}
                  </label>
                </>
              }
            />
          </div>
        );
      })}
    </div>
  );
}
