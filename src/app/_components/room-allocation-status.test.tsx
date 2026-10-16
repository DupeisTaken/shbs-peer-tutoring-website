// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { RoomAllocationStatus } from "./room-allocation-status";
afterEach(cleanup);
function show(
  mode: string,
  needsRoom = false,
  confirmed = true,
  room: { name: string } | null = null,
) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
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
it("distinguishes intentional no room from unresolved automatic shortage", () => {
  show("NONE");
  expect(screen.getByText("No physical room")).toBeTruthy();
  expect(screen.queryByText("Needs room")).toBeNull();
  cleanup();
  show("AUTO", true);
  expect(screen.getByText("Needs room")).toBeTruthy();
  expect(screen.queryByText("No physical room")).toBeNull();
});
it("does not present an unscheduled fixed selection as a reservation", () => {
  show("FIXED", false, false, { name: "204" });
  expect(screen.getByText("Awaiting schedule")).toBeTruthy();
  expect(screen.queryByText("204")).toBeNull();
});
it("keeps legacy roomlessness distinct from a shortage", () => {
  show("LEGACY");
  expect(screen.getByText("Not allocated")).toBeTruthy();
  expect(screen.queryByText("Needs room")).toBeNull();
});
