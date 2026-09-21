import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { parseProgramDateTime } from "./program-time";

/** Display-only: keep the IANA identifier as the saved value and resolve both the
 * localized name and the offset at the supplied instant, never at today's date. */
export function programTimeZoneLabel(
  timeZone: string,
  instant: Date,
  locale = "en",
): string {
  const zonePart = (language: string, style: "long" | "short" | "longOffset") =>
    new Intl.DateTimeFormat(language, { timeZone, timeZoneName: style })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")!.value;
  const name = zonePart(locale, "long");
  // English short names provide familiar EST/EDT where ICU supports them. ICU's
  // GMT fallback is not an abbreviation, so do not print it twice. Keep GMT and
  // ASCII digits stable across locales for an unambiguous, searchable offset.
  const short = zonePart("en-US", "short");
  const offset = zonePart("en-US", "longOffset").replace(/^GMT$/, "GMT+00:00");
  const abbreviation =
    short.startsWith("GMT") || short === name ? "" : ` · ${short}`;
  const region = timeZone.replaceAll("_", " ").replaceAll("/", " / ");
  return `${region} — ${name}${abbreviation} (${offset})`;
}

/** Incomplete or ambiguous local inputs have no single instant. Do not invent an
 * offset for them; submission still uses the existing strict conversion/error. */
export function programTimeZoneInputLabel(
  value: string,
  timeZone = DEFAULT_TIME_ZONE,
  locale = "en",
): string {
  try {
    return programTimeZoneLabel(
      timeZone,
      parseProgramDateTime(value, timeZone),
      locale,
    );
  } catch {
    return timeZone.replaceAll("_", " ").replaceAll("/", " / ");
  }
}
