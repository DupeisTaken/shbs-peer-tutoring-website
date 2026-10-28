import { expect, it } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { eventTitle } from "./event-title";

it.each([
  ["en", en],
  ["zh", zh],
] as const)(
  "uses authored titles without exposing raw events in %s",
  (locale, messages) => {
    const lookup = (key: string) =>
      key
        .split(".")
        .reduce<unknown>(
          (value, part) =>
            value && typeof value === "object" && part in value
              ? (value as Record<string, unknown>)[part]
              : undefined,
          messages,
        );
    const t = Object.assign(
      (key: string) => {
        const text = lookup(key);
        if (typeof text !== "string")
          throw new Error(`Missing ${locale} title: ${key}`);
        return text;
      },
      { has: (key: string) => typeof lookup(key) === "string" },
    );
    expect(
      eventTitle(t, { operation: "recovery.voidAdmission", kind: "REVERSAL" }),
    ).toBe(messages.approvals.review.operations.recovery_voidAdmission);
    expect(
      eventTitle(t, {
        operation: "future.untranslatedMutation",
        entity: "TutorApplication",
      }),
    ).toBe(
      `${messages.eventTitles.ACTION} · ${messages.approvals.review.entities.TutorApplication}`,
    );
    expect(eventTitle(t, { entity: "FUTURE_RAW_TABLE" })).toBe(
      messages.eventTitles.ACTION,
    );
    for (const operation of [
      "INTERNAL_UNKNOWN_EVENT",
      "future.untranslatedMutation",
      "",
      null,
    ]) {
      expect(eventTitle(t, { operation, kind: "ATTEMPT" })).toBe(
        messages.eventTitles.ATTEMPT,
      );
      expect(eventTitle(t, { operation, kind: "REVERSAL" })).toBe(
        messages.eventTitles.REVERSAL,
      );
      expect(eventTitle(t, { operation, kind: "FUTURE_KIND" })).toBe(
        messages.eventTitles.ACTION,
      );
    }
  },
);
