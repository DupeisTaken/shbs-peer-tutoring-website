/** @vitest-environment jsdom */
import type { ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { RoomGrid } from "./room-grid";

afterEach(cleanup);
type Pairing = ComponentProps<typeof RoomGrid>["pairings"][number];
const slot = {
  id: "slot",
  label: "Published",
  dayOfWeek: 1,
  startMin: 900,
  endMin: 960,
};
const pairing: Pairing = {
  id: "pairing",
  subject: "Mathematics",
  tutorId: "tutor",
  roomId: "room",
  timeSlotId: "different-slot",
  scheduleConfirmed: true,
  dayOfWeek: 1,
  startMin: 930,
  endMin: 990,
  tutor: { englishName: "Synthetic Tutor" },
};

function show(
  pairings: Pairing[],
  extras: Partial<ComponentProps<typeof RoomGrid>> = {},
  locale = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      <RoomGrid
        rooms={[{ id: "room", name: "A101" }]}
        slots={[slot]}
        pairings={pairings}
        blocks={[]}
        {...extras}
      />
    </NextIntlClientProvider>,
  );
}

// The catalog link is metadata: authoritative copied intervals govern every visible cell.
it.each(["different-slot", null])(
  "counts an overlapping confirmed booking with catalog link %s in summary and details",
  (timeSlotId) => {
    show([{ ...pairing, timeSlotId }]);
    expect(screen.getByText("1 record")).toBeTruthy();
    expect(screen.queryByText("Available")).toBeNull();
    const opener = screen.getByRole("button", { name: /View schedule/ });
    expect(opener.closest("td")).toBe(opener.closest("tr")?.lastElementChild);
    fireEvent.click(opener);
    expect(
      within(screen.getByRole("dialog")).getByText(
        /Mathematics · Synthetic Tutor/,
      ),
    ).toBeTruthy();
  },
);

it.each([
  { label: "awaiting", scheduleConfirmed: false, startMin: 900, endMin: 960 },
  {
    label: "adjacent after",
    scheduleConfirmed: true,
    startMin: 960,
    endMin: 1020,
  },
  {
    label: "adjacent before",
    scheduleConfirmed: true,
    startMin: 840,
    endMin: 900,
  },
  {
    label: "different day",
    scheduleConfirmed: true,
    dayOfWeek: 2,
    startMin: 900,
    endMin: 960,
  },
])(
  "does not reserve the visible interval for $label",
  ({ label: _label, ...changes }) => {
    show([{ ...pairing, timeSlotId: slot.id, ...changes }]);
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.queryByText("1 record")).toBeNull();
  },
);

it("keeps recurring blackout detail distinct from booking availability", () => {
  show([], {
    blocks: [
      {
        id: "block",
        roomId: "room",
        dayOfWeek: 1,
        startMin: 910,
        endMin: 920,
        reason: "Assembly",
      },
    ],
  });
  expect(screen.getByText("Unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /View schedule/ }));
  expect(within(screen.getByRole("dialog")).getByText(/Assembly/)).toBeTruthy();
});

it("translates distinct empty room and unpublished-slot states", () => {
  const view = show([], { rooms: [] }, "zh");
  expect(screen.getByText(zh.roomAllocation.noRooms)).toBeTruthy();
  view.unmount();
  show([], { slots: [] }, "zh");
  expect(screen.getByText(zh.roomAllocation.noSlots)).toBeTruthy();
});
