/** @vitest-environment jsdom */
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

const rooms = [{ id: "room", name: "101" }];
const slots = [
  {
    id: "slot",
    label: "Stored label",
    dayOfWeek: 1,
    startMin: 930,
    endMin: 990,
  },
];
const pairings = [
  {
    id: "pair",
    subject: "Math",
    tutorId: "tutor",
    roomId: "room",
    timeSlotId: "slot",
    tutor: { englishName: "Recorded Tutor" },
  },
];
function show(locale: "en" | "zh", data = { rooms, slots }) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
    >
      <RoomGrid {...data} pairings={pairings} blocks={[]} />
    </NextIntlClientProvider>,
  );
}
afterEach(cleanup);
it.each(["en", "zh"] as const)(
  "localizes %s weekday in both table and detail without changing clock or records",
  (locale) => {
    show(locale);
    const label = `${locale === "zh" ? "周一" : "Mon"} 15:30–16:30`;
    expect(screen.getByText(label)).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: label })).toBeTruthy();
    expect(within(dialog).getByText("Math · Recorded Tutor")).toBeTruthy();
  },
);
it.each(["rooms", "slots"] as const)(
  "localizes the successful empty %s state independently",
  (empty) => {
    show("zh", {
      rooms: empty === "rooms" ? [] : rooms,
      slots: empty === "slots" ? [] : slots,
    });
    expect(
      screen.getByText(
        empty === "rooms" ? zh.tablePatterns.noRooms : zh.tablePatterns.noSlots,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  },
);
