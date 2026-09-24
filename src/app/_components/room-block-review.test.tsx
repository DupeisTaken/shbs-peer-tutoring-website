/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { roomBlockReview } from "~/lib/room-block-review";
import { RoomBlockReview } from "./room-block-review";

afterEach(cleanup);
const original = {
  id: "block",
  roomId: "room",
  dayOfWeek: 1,
  startMin: 720,
  endMin: 780,
  reason: "Original weekly restriction",
};
const targets = {
  RoomUnavailability: [{ record: original }],
  roomBlockContext: { id: "room", name: "Science Room at submission" },
};
function show(operation: string, payload: unknown, evidence: unknown) {
  const summary = roomBlockReview(operation, payload, evidence);
  if (!summary) throw Error("Expected room summary");
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <RoomBlockReview summary={summary} />
    </NextIntlClientProvider>,
  );
}

it("renders a create request with an immutable room name, weekday and clock interval", () => {
  show(
    "admin.createRoomUnavailability",
    {
      roomId: "room",
      dayOfWeek: 2,
      startMin: 780,
      endMin: 840,
      reason: "Assembly",
    },
    { Room: [{ record: { id: "room", name: "Recorded room name" } }] },
  );
  expect(screen.getByText("Recorded room name")).toBeTruthy();
  expect(screen.getByText(/Tuesday/)).toBeTruthy();
  expect(screen.getByText("13:00–14:00")).toBeTruthy();
  expect(screen.getByText("Assembly")).toBeTruthy();
  expect(screen.queryByText("780")).toBeNull();
});

it("compares an edit with its original period and preserves a midnight endpoint", () => {
  show(
    "admin.updateRoomUnavailability",
    {
      id: "block",
      dayOfWeek: 7,
      startMin: 0,
      endMin: 1440,
      reason: "Whole day",
    },
    targets,
  );
  expect(screen.getByText("Science Room at submission")).toBeTruthy();
  expect(screen.getByText("12:00–13:00")).toBeTruthy();
  expect(screen.getByText("00:00–24:00")).toBeTruthy();
  expect(screen.getByText(/Sunday/)).toBeTruthy();
  expect(screen.getByText("Original weekly restriction")).toBeTruthy();
  expect(screen.getByText("Whole day")).toBeTruthy();
});

it("identifies the snapshotted period being removed without requiring payload times", () => {
  show("admin.deleteRoomUnavailability", { id: "block" }, targets);
  expect(screen.getByText("Period to remove")).toBeTruthy();
  expect(screen.getByText("12:00–13:00")).toBeTruthy();
  expect(screen.queryByText("Proposed period")).toBeNull();
});

it("explains missing legacy room evidence while retaining available period evidence", () => {
  show(
    "admin.deleteRoomUnavailability",
    { id: "block" },
    { RoomUnavailability: [{ record: original }] },
  );
  expect(
    screen.getByText("Room name was not recorded in this request."),
  ).toBeTruthy();
  expect(screen.getByText("12:00–13:00")).toBeTruthy();
});

it("does not invent a schedule when legacy evidence is absent or malformed", () => {
  show("admin.deleteRoomUnavailability", { id: "missing" }, null);
  expect(
    screen.getByText("Period details were not recorded in this request."),
  ).toBeTruthy();
  expect(roomBlockReview("admin.updateRoom", {}, {})).toBeNull();
});
