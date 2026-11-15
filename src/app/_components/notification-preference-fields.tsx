"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { NotificationCategory } from "~/lib/notification-categories";

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
    <div className="min-w-0 divide-y divide-slate-100">
      {rows.map((row) => {
        const choice =
          choices.find((item) => item.category === row.category) ?? row;
        const category = t(`categories.${row.category}`);
        return (
          <div
            key={row.category}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] items-center gap-3 py-4 sm:gap-4"
          >
            <div className="min-w-0 break-words">
              <p className="text-sm font-semibold">{category}</p>
              <p className="mt-1 text-sm text-slate-600">
                {t(`descriptions.${row.category}`)}
              </p>
            </div>
            <div role="group" aria-label={category} className="min-w-0">
              {/* Shared track minimums align every row and let enlarged text stack. */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
                {row.badgeAvailable ? (
                  <label className="relative flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-accent-600 h-4 w-4 shrink-0"
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
                    <span className="min-w-0 break-words">
                      <span className="block">{t("badge")}</span>
                      {row.badgeLocked && (
                        <span
                          id={`${id}-${row.category}-badge-required`}
                          className="sr-only"
                        >
                          {t("locked")}
                        </span>
                      )}
                    </span>
                  </label>
                ) : (
                  <span className="flex min-h-11 items-center px-2 text-xs text-slate-600">
                    {t("emailOnly")}
                  </span>
                )}
                <label className="relative flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-accent-600 h-4 w-4 shrink-0"
                    disabled={disabled || !row.emailEditable || row.emailLocked}
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
                  <span className="min-w-0 break-words">
                    <span className="block">{t("email")}</span>
                    {row.emailLocked && (
                      <span
                        id={`${id}-${row.category}-email-required`}
                        className="sr-only"
                      >
                        {t("locked")}
                      </span>
                    )}
                  </span>
                </label>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
