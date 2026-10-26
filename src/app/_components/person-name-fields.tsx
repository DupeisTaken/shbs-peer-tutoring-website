"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { FieldRequirement } from "./field-requirement";
import { preservesLegacyName, type PersonNameDraft } from "~/lib/person-name";
import { isLatinPrimaryName } from "~/lib/profile-policy";
import {
  DEFAULT_NAME_FIELDS,
  hasVisibleNameFields,
  type NameFieldStates,
  type NameAccountType,
} from "~/lib/name-field-policy";
import { api } from "~/trpc/react";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { Button } from "./ui/button";

/** One accessible layout for intake and profile editing; legacy names are shown without guessing a split. */
export function PersonNameFields({
  value,
  onChange,
  legacyName,
  originalValue,
  requireLastName = false,
  states = DEFAULT_NAME_FIELDS,
  showHidden = false,
  preserveLegacyRequiredFields = false,
  disabled = false,
}: {
  value: PersonNameDraft;
  onChange: (value: PersonNameDraft) => void;
  legacyName?: string | null;
  originalValue?: PersonNameDraft;
  requireLastName?: boolean;
  states?: NameFieldStates;
  /** Authorized staff edit retained originals, even when the participant field is hidden. */
  showHidden?: boolean;
  /** Audited application corrections may retain all unsplit Latin originals;
   * promotion readiness is checked separately. Other editors keep their policy. */
  preserveLegacyRequiredFields?: boolean;
  disabled?: boolean;
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
      {legacyName &&
        !value.firstName &&
        (showHidden ||
          (["firstName", "lastName", "preferredName"] as const).every(
            (key) => states[key] !== "hidden",
          )) && (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
            {t(preserved ? "legacyPreserved" : "legacy", { name: legacyName })}
          </p>
        )}
      {(
        ["firstName", "lastName", "preferredName", "alternativeNames"] as const
      ).map((key) => {
        if (states[key] === "hidden" && !showHidden) return null;
        const required =
          !(preserved && (key === "firstName" ||
            (preserveLegacyRequiredFields && key !== "alternativeNames"))) &&
          (states[key] === "required" ||
            (key === "lastName" && requireLastName));
        const invalid =
          key !== "alternativeNames" &&
          !!value[key].trim() &&
          value[key].trim() !== originalValue?.[key].trim() &&
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
              <FieldRequirement
                state={
                  states[key] === "hidden"
                    ? "hidden"
                    : required
                      ? "required"
                      : "optional"
                }
              />
            </label>
            <input
              ref={(input) => {
                // Keep native validity in sync even for prefilled drafts and
                // prop updates. Known Latin-name errors need no server round trip.
                input?.setCustomValidity(
                  invalid ? policyText("latinRequired") : "",
                );
              }}
              id={`${id}-${key}`}
              name={key}
              className="input min-h-11 w-full aria-invalid:border-red-400 lg:min-h-10"
              value={value[key]}
              disabled={disabled}
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
              {states[key] === "hidden" && showHidden && (
                <> {t("hiddenRetained")}</>
              )}
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

/** Unknown policy stays non-editable; cached visibility is retained through read recovery. */
export function useNameFieldPresentation() {
  const [ready, setReady] = useState(false);
  const [states, setStates] = useState<NameFieldStates>();
  const observe = useCallback((available: boolean, known?: NameFieldStates) => {
    setReady(available);
    if (known)
      setStates((previous) =>
        JSON.stringify(previous) === JSON.stringify(known) ? previous : known,
      );
  }, []);
  return {
    ready,
    hasFields: !!states && hasVisibleNameFields(states),
    hasLatinFields: !!states && hasVisibleNameFields(states, true),
    observe,
  };
}

/** Intake chooses its registration type; a shared profile resolves its current owner's role on the server. */
export function ConfiguredPersonNameFields({
  accountType,
  profileTarget,
  management = false,
  onPolicyAvailabilityChange,
  ...props
}: Omit<
  React.ComponentProps<typeof PersonNameFields>,
  "states" | "showHidden" | "requireLastName"
> & {
  accountType?: NameAccountType;
  profileTarget?: { userId?: string; tutorId?: string; tuteeId?: string };
  management?: boolean;
  onPolicyAvailabilityChange?: (
    available: boolean,
    states?: NameFieldStates,
  ) => void;
}) {
  const t = useTranslations("nameFields");
  const intake = api.program.nameFieldPolicy.useQuery(undefined, {
    enabled: !!accountType,
  });
  const profile = api.program.nameFieldsForProfile.useQuery(
    profileTarget ?? {},
    { enabled: !accountType },
  );
  const states = accountType
    ? intake.data?.policies[accountType]
    : profile.data?.states;
  const error = accountType ? intake.error : profile.error;
  const available = !!states && !error;
  useEffect(() => {
    onPolicyAvailabilityChange?.(available, states);
  }, [available, states, onPolicyAvailabilityChange]);
  const refresh = () => (accountType ? intake.refetch() : profile.refetch());
  return (
    <div className="space-y-3">
      {error && (
        <StatePanel
          kind="error"
          title={t("loadFailed")}
          action={
            <Button onClick={() => void refresh()}>{t("refresh")}</Button>
          }
        />
      )}
      {states &&
        !accountType &&
        !management &&
        !hasVisibleNameFields(states) && (
          <InlineNotice>{t("hiddenProfileHelp")}</InlineNotice>
        )}
      {states ? (
        <PersonNameFields
          {...props}
          states={states}
          showHidden={management}
          disabled={!available || props.disabled}
        />
      ) : (
        !error && <StatePanel kind="loading" title={t("loading")} />
      )}
    </div>
  );
}
