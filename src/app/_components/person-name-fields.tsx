"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { FieldRequirement } from "./field-requirement";
import { preservesLegacyName, type PersonNameDraft } from "~/lib/person-name";
import { isLatinPrimaryName } from "~/lib/profile-policy";

/** One accessible layout for intake and profile editing; legacy names are shown without guessing a split. */
export function PersonNameFields({
  value,
  onChange,
  legacyName,
  originalValue,
  requireLastName = false,
}: {
  value: PersonNameDraft;
  onChange: (value: PersonNameDraft) => void;
  legacyName?: string | null;
  originalValue?: PersonNameDraft;
  requireLastName?: boolean;
}) {
  const t = useTranslations("personName");
  const policyText = useTranslations("profilePolicy");
  const [touched, setTouched] = useState<
    Partial<Record<keyof PersonNameDraft, boolean>>
  >({});
  const id = useId();
  const preserved = preservesLegacyName(value, originalValue, legacyName);
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      {legacyName && !value.firstName && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
          {t(preserved ? "legacyPreserved" : "legacy", { name: legacyName })}
        </p>
      )}
      {(
        ["firstName", "lastName", "preferredName", "alternativeNames"] as const
      ).map((key) => {
        const required =
          !preserved &&
          (key === "firstName" || (key === "lastName" && requireLastName));
        const invalid =
          key !== "alternativeNames" &&
          !!value[key].trim() &&
          !isLatinPrimaryName(value[key]);
        return (
          <div
            key={key}
            className={
              key === "firstName" || key === "lastName"
                ? "min-w-0"
                : "min-w-0 sm:col-span-2"
            }
          >
            <label className="label" htmlFor={`${id}-${key}`}>
              {t(key)}
              <FieldRequirement state={required ? "required" : "optional"} />
            </label>
            <input
              id={`${id}-${key}`}
              name={key}
              className="input min-h-11 w-full lg:min-h-10"
              value={value[key]}
              required={required}
              maxLength={key === "alternativeNames" ? 200 : 100}
              autoComplete={
                key === "firstName"
                  ? "given-name"
                  : key === "lastName"
                    ? "family-name"
                    : key === "preferredName"
                      ? "nickname"
                      : "off"
              }
              aria-invalid={touched[key] && invalid ? true : undefined}
              aria-describedby={`${id}-${key}-help${touched[key] && invalid ? ` ${id}-${key}-error` : ""}`}
              onBlur={() =>
                setTouched((previous) => ({ ...previous, [key]: true }))
              }
              onChange={(event) =>
                onChange({ ...value, [key]: event.target.value })
              }
            />
            <p className="muted mt-1 text-xs" id={`${id}-${key}-help`}>
              {t(`${key}Help`)}
            </p>
            {touched[key] && invalid && (
              <p
                id={`${id}-${key}-error`}
                className="mt-1 text-sm text-red-700"
              >
                {policyText("latinRequired")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
