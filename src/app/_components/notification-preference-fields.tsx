"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
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
    badgeLocked?: boolean;
    emailLocked?: boolean;
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
  const id = useId();
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
                    <label className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-accent-600 h-4 w-4"
                        disabled={disabled || row.badgeLocked}
                        aria-label={t("badgeFor", { category })}
                        aria-describedby={
                          row.badgeLocked
                            ? `${id}-${row.category}-badge-required`
                            : undefined
                        }
                        checked={row.badgeLocked ? true : choice.badgeEnabled}
                        onChange={(event) =>
                          onChange({
                            ...choice,
                            badgeEnabled: event.target.checked,
                          })
                        }
                      />
                      <span>
                        <span className="block">{t("badge")}</span>
                        {row.badgeLocked && (
                          <span
                            id={`${id}-${row.category}-badge-required`}
                            className="block text-xs font-medium text-slate-600"
                          >
                            {t("locked")}
                          </span>
                        )}
                      </span>
                    </label>
                  ) : (
                    <span className="px-2 text-xs text-slate-600">
                      {t("emailOnly")}
                    </span>
                  )}
                  <label className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-accent-600 h-4 w-4"
                      disabled={
                        disabled || !row.emailEditable || row.emailLocked
                      }
                      aria-label={t("emailFor", { category })}
                      aria-describedby={
                        row.emailLocked
                          ? `${id}-${row.category}-email-required`
                          : undefined
                      }
                      checked={
                        row.emailLocked
                          ? true
                          : row.emailEditable
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
                    <span>
                      <span className="block">{t("email")}</span>
                      {row.emailLocked && (
                        <span
                          id={`${id}-${row.category}-email-required`}
                          className="block text-xs font-medium text-slate-600"
                        >
                          {t("locked")}
                        </span>
                      )}
                    </span>
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
