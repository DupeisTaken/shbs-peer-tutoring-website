import { TRPCError } from "@trpc/server";
import { LOCALES } from "~/i18n/config";
import { translationMessageCompatibility } from "~/lib/translation-message-contract";
import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";
import esMessages from "../../../messages/es.json";
import jaMessages from "../../../messages/ja.json";
import koMessages from "../../../messages/ko.json";
import elMessages from "../../../messages/el.json";
import deMessages from "../../../messages/de.json";
import frMessages from "../../../messages/fr.json";

/** The writer and review-request admission share the same trusted message bases. */
const messages: Record<string, Record<string, unknown>> = {
  en: enMessages,
  zh: zhMessages,
  es: esMessages,
  ja: jaMessages,
  ko: koMessages,
  el: elMessages,
  de: deMessages,
  fr: frMessages,
};

function flatten(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value))
      flatten(value as Record<string, unknown>, path, out);
    else if (typeof value === "string") out[path] = value;
  }
  return out;
}

export function interfaceMessageBases(locale: string) {
  const english = flatten(messages.en ?? {});
  const local = (LOCALES as readonly string[]).includes(locale)
    ? flatten(messages[locale] ?? {})
    : english;
  return { english, local };
}

/** This validates content only. Actual language existence and actor authority
 * remain under the caller's existing destination lock and permission boundary. */
export function validateInterfaceMessage(
  locale: string,
  key: string,
  value: string,
) {
  const { english, local } = interfaceMessageBases(locale);
  const source = english[key];
  const base = local[key] ?? source;
  if (!source)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unknown translation key.",
    });
  // Explicit clear/default repair retains the existing draft/publication boundary.
  if (value.trim() && value !== base) {
    const compatibility = translationMessageCompatibility(source, value);
    if (!compatibility.compatible) {
      if (compatibility.reason === "source-syntax")
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "The source message cannot be validated. Leave the current translation unchanged and contact the program team.",
        });
      const details =
        compatibility.reason === "arguments"
          ? [
              compatibility.missing.length
                ? `Missing: ${compatibility.missing.join(", ")}.`
                : "",
              compatibility.unexpected.length
                ? `Unexpected: ${compatibility.unexpected.join(", ")}.`
                : "",
              compatibility.changed.length
                ? `Changed value type: ${compatibility.changed.join(", ")}.`
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          : "Invalid ICU syntax. Check placeholders and plural clauses.";
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${details} Keep the source argument names, value types and rich-text tags. Correct the translation or clear it to use the default. Reject an older incompatible draft and submit a corrected draft.`,
      });
    }
  }
  return { base };
}
