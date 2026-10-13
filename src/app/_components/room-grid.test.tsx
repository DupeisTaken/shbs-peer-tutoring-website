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
import { SessionViewProvider } from "./session-view-state";
import { viewStateKey } from "~/lib/session-view-state";

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
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
it("restores layout and deliberate room selection only when the current catalog is ready", () => {
  const key = viewStateKey(
    "head-account",
    "/admin/pairings",
    "room-grid-selection-v1",
    "management:term-a",
  );
  sessionStorage.setItem(
    key,
    JSON.stringify({ owner: "management", ids: ["removed", "room"] }),
  );
  const view = (ready: boolean) => (
    <SessionViewProvider
      identity="head-account"
      pathname="/admin/pairings"
      verified
    >
      <NextIntlClientProvider locale="en" messages={en}>
        <RoomGrid
          rooms={ready ? rooms : []}
          slots={ready ? slots : []}
          pairings={pairings}
          blocks={[]}
          catalogReady={ready}
          viewScope="term-a"
        />
      </NextIntlClientProvider>
    </SessionViewProvider>
  );
  const first = render(view(false));
  expect(sessionStorage.getItem(key)).toContain("removed");
  first.rerender(view(true));
  expect(sessionStorage.getItem(key)).toBe(
    JSON.stringify({ owner: "management", ids: ["room"] }),
  );
  fireEvent.click(
    screen.getByRole("tab", { name: en.roomSchedule.individual }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.roomSchedule.clearRooms }),
  );
  first.unmount();
  render(view(true));
  expect(
    screen
      .getByRole("tab", { name: en.roomSchedule.individual })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByText(en.roomSchedule.noSelection)).toBeTruthy();
});
it("recalls validated detail filters without storing pairing or unavailable-reason evidence", () => {
  const view = () => (
    <SessionViewProvider
      identity="head-account"
      pathname="/admin/pairings"
      verified
    >
      <NextIntlClientProvider locale="en" messages={en}>
        <RoomGrid
          rooms={rooms}
          slots={slots}
          pairings={pairings}
          blocks={[]}
          viewScope="term-a"
        />
      </NextIntlClientProvider>
    </SessionViewProvider>
  );
  const first = render(view());
  fireEvent.click(
    screen.getByRole("button", { name: en.roomSchedule.allDetails }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(en.roomSchedule.day), {
    target: { value: "1" },
  });
  fireEvent.change(within(dialog).getByLabelText(en.roomSchedule.room), {
    target: { value: "room" },
  });
  first.unmount();
  render(view());
  fireEvent.click(
    screen.getByRole("button", { name: en.roomSchedule.allDetails }),
  );
  expect(
    within(screen.getByRole("dialog")).getByLabelText<HTMLSelectElement>(
      en.roomSchedule.day,
    ).value,
  ).toBe("1");
  expect(
    within(screen.getByRole("dialog")).getByLabelText<HTMLSelectElement>(
      en.roomSchedule.room,
    ).value,
  ).toBe("room");
  const saved = Object.keys(sessionStorage)
    .map((key) => sessionStorage.getItem(key))
    .join(" ");
  expect(saved).not.toContain("Recorded Tutor");
  expect(saved).not.toContain("Math");
});
it("does not append an empty outside-catalog separator to a matched recorded schedule", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RoomGrid
        rooms={rooms}
        slots={slots}
        blocks={[]}
        pairings={[
          {
            ...pairings[0]!,
            scheduleConfirmed: true,
            dayOfWeek: 1,
            startMin: 930,
            endMin: 990,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.roomSchedule.allDetails }),
  );
  const detail = within(screen.getByRole("dialog")).getByText(
    /101 · Mon 15:30–16:30/,
  );
  expect(detail.textContent?.trim()).toBe("101 · Mon 15:30–16:30");
});
it("uses an account username or localized unlinked-name fallback in active detail rows", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RoomGrid
        rooms={rooms}
        slots={slots}
        pairings={[
          {
            ...pairings[0]!,
            id: "linked",
            subject: "Linked subject",
            tutor: {
              englishName: "",
              username: "oldrosterhandle",
              user: { username: "canonicalhandle" },
            },
          },
          {
            ...pairings[0]!,
            id: "unlinked",
            subject: "Unlinked subject",
            tutor: { englishName: "" },
          },
        ]}
        blocks={[]}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.roomSchedule.allDetails }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(
      "Linked subject · canonicalhandle",
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("dialog")).getByText(
      `Unlinked subject · ${en.participantNames.unnamed}`,
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/oldrosterhandle/)).toBeNull();
});
it.each(["en", "zh"] as const)(
  "localizes %s weekday in both table and detail without changing clock or records",
  (locale) => {
    show(locale);
    const label = `${locale === "zh" ? "周一" : "Mon"} 15:30–16:30`;
    expect(screen.getByText(label)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: `${(locale === "zh" ? zh : en).tablePatterns.schedule}: ${label}`,
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: label })).toBeTruthy();
    expect(within(dialog).getByText("Math · Recorded Tutor")).toBeTruthy();
  },
);

it("scales combined and individual schedules to 22 rooms with seven weekday columns", () => {
  const manyRooms = Array.from({ length: 22 }, (_, index) => ({
    id: `room-${index}`,
    name: `Room ${index + 1}`,
  }));
  show("en", { rooms: manyRooms, slots });
  expect(screen.getAllByRole("columnheader")).toHaveLength(24);
  fireEvent.click(
    screen.getByRole("tab", { name: en.roomSchedule.individual }),
  );
  expect(screen.getAllByRole("table")).toHaveLength(22);
  for (const table of screen.getAllByRole("table"))
    expect(within(table).getAllByRole("columnheader")).toHaveLength(9);
});

it("derives tutor defaults from arriving pairings without discarding an explicit empty selection", () => {
  const allRooms = [rooms[0]!, { id: "other", name: "202" }];
  const tree = (data: typeof pairings, tutorId = "tutor") => (
    <NextIntlClientProvider locale="en" messages={en}>
      <RoomGrid
        rooms={allRooms}
        slots={slots}
        pairings={data}
        blocks={[]}
        highlightTutorId={tutorId}
      />
    </NextIntlClientProvider>
  );
  const view = render(tree([]));
  expect(screen.getByRole("status").textContent).toBe(
    en.roomSchedule.noSelection,
  );
  view.rerender(tree(pairings));
  expect(
    screen.getByRole("button", { name: "101" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "202" }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(
    screen.getByRole("button", { name: en.roomSchedule.clearRooms }),
  );
  view.rerender(tree([...pairings]));
  expect(screen.getByRole("status").textContent).toBe(
    en.roomSchedule.noSelection,
  );
  view.rerender(
    tree(
      [{ ...pairings[0]!, tutorId: "new-owner", roomId: "other" }],
      "new-owner",
    ),
  );
  expect(
    screen.getByRole("button", { name: "202" }).getAttribute("aria-pressed"),
  ).toBe("true");
});

it("uses recorded recurring times for occupancy when an old slot link points at a changed catalog row", () => {
  const changed = { ...slots[0]!, startMin: 600, endMin: 660 };
  const actual = { ...changed, id: "actual", startMin: 930, endMin: 990 };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RoomGrid
        rooms={rooms}
        slots={[changed, actual]}
        pairings={[
          {
            ...pairings[0]!,
            dayOfWeek: 1,
            startMin: 930,
            endMin: 990,
            scheduleConfirmed: true,
          },
        ]}
        blocks={[]}
      />
    </NextIntlClientProvider>,
  );
  const rows = screen.getAllByRole("row");
  expect(within(rows[1]!).getByText(en.tablePatterns.available)).toBeTruthy();
  expect(within(rows[2]!).getByText("1 record")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.roomSchedule.allDetails }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(/Mon 15:30–16:30/, {
      selector: "p",
    }),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("dialog")).getByText(
      /Outside the active slot catalog/,
    ),
  ).toBeTruthy();
});

it("opens individual row details at the chosen interval while retaining a way to reach every record", () => {
  const later = { ...slots[0]!, id: "later", startMin: 1020, endMin: 1080 };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RoomGrid
        rooms={rooms}
        slots={[slots[0]!, later]}
        pairings={[
          ...pairings,
          {
            ...pairings[0]!,
            id: "later-pair",
            timeSlotId: later.id,
            subject: "Later subject",
          },
        ]}
        blocks={[]}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("tab", { name: en.roomSchedule.individual }),
  );
  const triggers = screen.getAllByRole("button", { name: /View details: 101/ });
  fireEvent.click(triggers[0]!);
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByLabelText<HTMLSelectElement>(en.roomSchedule.time)
      .value,
  ).toBe("930:990");
  expect(within(dialog).queryByText(/Later subject/)).toBeNull();
  fireEvent.change(within(dialog).getByLabelText(en.roomSchedule.time), {
    target: { value: "" },
  });
  expect(within(dialog).getByText(/Later subject/)).toBeTruthy();
});

it("keeps every overlapping block and unmapped/unconfirmed record reachable in the reader", () => {
  const blocks = [1, 2].map((id) => ({
    id: `block-${id}`,
    roomId: "room",
    dayOfWeek: 1,
    startMin: 900,
    endMin: 1000,
    reason: `Original reason ${id}`,
  }));
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RoomGrid
        rooms={rooms}
        slots={slots}
        pairings={[
          ...pairings,
          {
            ...pairings[0]!,
            id: "unmapped",
            subject: "Legacy schedule",
            timeSlotId: null,
            dayOfWeek: 2,
            startMin: 600,
            endMin: 660,
          },
          {
            ...pairings[0]!,
            id: "unconfirmed",
            subject: "Not reserved",
            scheduleConfirmed: false,
          },
        ]}
        blocks={blocks}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getByLabelText(en.tablePatterns.unavailable).textContent).toBe(
    "×",
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.roomSchedule.allDetails }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/Original reason 1/)).toBeTruthy();
  expect(within(dialog).getByText(/Original reason 2/)).toBeTruthy();
  expect(within(dialog).getByText(/Legacy schedule/)).toBeTruthy();
  expect(
    within(dialog).getByText(new RegExp(en.roomSchedule.unconfirmed)),
  ).toBeTruthy();
});
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
