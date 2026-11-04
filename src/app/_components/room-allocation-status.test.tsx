// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { RoomAllocationStatus } from "./room-allocation-status";
afterEach(cleanup);
function show(
  mode: string,
  needsRoom = false,
  confirmed = true,
  room: { name: string } | null = null,
  locale: "en" | "zh" = "en",
) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <RoomAllocationStatus
        pairing={{
          roomMode: mode,
          roomNeedsAssignment: needsRoom,
          scheduleConfirmed: confirmed,
          room,
        }}
      />
    </NextIntlClientProvider>,
  );
}
it.each(["en", "zh"] as const)(
  "distinguishes intentional no room from unresolved automatic shortage (%s)",
  (locale) => {
    const labels = (locale === "en" ? en : zh).roomAllocation;
    show("NONE", false, true, null, locale);
    expect(screen.getByText(labels.mode.NONE)).toBeTruthy();
    expect(screen.queryByText(labels.needsRoom)).toBeNull();
    cleanup();
    show("AUTO", true, true, null, locale);
    expect(screen.getByText(labels.needsRoom)).toBeTruthy();
    expect(screen.queryByText(labels.mode.NONE)).toBeNull();
  },
);
it.each(["en", "zh"] as const)(
  "does not present an unscheduled fixed selection as a reservation (%s)",
  (locale) => {
    show("FIXED", false, false, { name: "204" }, locale);
    expect(
      screen.getByText((locale === "en" ? en : zh).roomAllocation.awaiting),
    ).toBeTruthy();
    expect(screen.queryByText("204")).toBeNull();
  },
);
it.each([
  ["en", "FIXED"],
  ["en", "AUTO"],
  ["zh", "FIXED"],
  ["zh", "AUTO"],
] as const)(
  "keeps a confirmed room name before its persisted %s/%s status",
  (locale, mode) => {
    const name = "A101 · 北翼协作教学教室 / North wing teaching room";
    const labels = (locale === "en" ? en : zh).roomAllocation;
    show(mode, false, true, { name }, locale);
    const room = screen.getByText(name);
    const status = screen.getByText(labels.mode[mode]);
    expect(
      room.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(labels.awaiting)).toBeNull();
    expect(screen.queryByText(labels.needsRoom)).toBeNull();
  },
);
it.each(["en", "zh"] as const)(
  "does not infer a shortage from a missing automatic reservation (%s)",
  (locale) => {
    const labels = (locale === "en" ? en : zh).roomAllocation;
    show("AUTO", false, true, null, locale);
    expect(screen.getByText(labels.outcome.UNASSIGNED)).toBeTruthy();
    expect(screen.queryByText(labels.needsRoom)).toBeNull();
    expect(screen.queryByText(labels.mode.AUTO)).toBeNull();
  },
);
it("keeps legacy roomlessness distinct from a shortage", () => {
  show("LEGACY");
  expect(screen.getByText("Not allocated")).toBeTruthy();
  expect(screen.queryByText("Needs room")).toBeNull();
});
