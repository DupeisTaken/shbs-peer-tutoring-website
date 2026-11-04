/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import PairingsPage from "./page";

type PairingRowOverride = {
  id: string;
  subject: string;
  groupId?: string | null;
  group?: { primaryPairingId: string } | null;
  dayOfWeek?: number;
  room?: { name: string } | null;
  roomMode?: "AUTO" | "FIXED" | "NONE" | "LEGACY";
  roomNeedsAssignment?: boolean;
  scheduleConfirmed?: boolean;
  tutees: { tuteeId: string; tutee: { englishName: string } }[];
};

const state = vi.hoisted(() => ({
  sorting: false,
  grouped: false,
  invalidGroup: false,
  rows: null as PairingRowOverride[] | null,
  sortMissing: false,
  confirmed: true,
  readOnly: true,
  mutate: vi.fn(),
  queryError: null as null | { message: string; data?: { code: string } },
  pendingRead: false,
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readOnly,
}));
vi.mock("~/app/_components/room-grid", () => ({ RoomGrid: () => null }));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: () => ["owned-feature-query"],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    admin: new Proxy(
      {},
      {
        get: (_target, key) => ({
          useMutation: () => ({ mutate: state.mutate }),
          useQuery: () => ({
            isSuccess: !(key === "pairings" && state.pendingRead),
            error: key === "tutees" ? state.queryError : null,
            data:
              key === "pairings"
                ? state.pendingRead
                  ? undefined
                  : [
                      {
                        id: "pairing",
                        roomMode: "AUTO",
                        roomNeedsAssignment: false,
                        roomVersion: 1,
                        tutor: { englishName: "Synthetic tutor" },
                        subject: "Synthetic subject",
                        scheduleConfirmed: state.confirmed,
                        dayOfWeek: 1,
                        startMin: 930,
                        endMin: 990,
                        room: null as { name: string } | null,
                        tutees: [] as {
                          tuteeId: string;
                          tutee: { englishName: string };
                        }[],
                      },
                    ]
                      .flatMap((p) =>
                        state.sorting
                          ? [
                              {
                                ...p,
                                id: "z",
                                tutorId: "z",
                                tutor: { englishName: "Zoe Synthetic" },
                                subject: "Physics",
                                dayOfWeek: 5,
                                room: { name: "Room 10" },
                                tutees: [
                                  {
                                    tuteeId: "one",
                                    tutee: { englishName: "One" },
                                  },
                                ],
                              },
                              {
                                ...p,
                                id: "a",
                                tutorId: "a",
                                tutor: { englishName: "Alex Synthetic" },
                                subject: "Chemistry",
                                dayOfWeek: 1,
                                room: { name: "Room 2" },
                                tutees: [],
                              },
                            ]
                          : [p],
                      )
                      .flatMap((p) =>
                        state.rows
                          ? state.rows.map((row) => ({ ...p, ...row }))
                          : [p],
                      )
                      .flatMap((p) => state.grouped ? [
                        { ...p, id: "member-a", groupId: "saved-group", group: { primaryPairingId: "member-a" }, subject: "Chemistry", tutees: [{tuteeId: "student", tutee: {englishName: "Group Student"}}] },
                        { ...p, id: "member-b", groupId: "saved-group", group: { primaryPairingId: "member-a" }, subject: "Mathematics", tutees: state.invalidGroup ? [] : [{tuteeId: "student", tutee: {englishName: "Group Student"}}] },
                        { ...p, id: "independent", groupId: null, subject: "Physics" },
                      ] : [p])
                      .flatMap((p, index) =>
                        state.sortMissing && index === 0
                          ? [
                              p,
                              {
                                ...p,
                                id: "roomless",
                                dayOfWeek: 3,
                                room: null,
                              },
                              {
                                ...p,
                                id: "awaiting",
                                scheduleConfirmed: false,
                                room: { name: "Room 1" },
                              },
                            ]
                          : [p],
                      )
                : key === "assignmentWorkloads"
                  ? {
                      tutors: [
                        { id: "z", count: 10, preferredMaximum: 12 },
                        { id: "a", count: 2, preferredMaximum: 3 },
                      ],
                    }
                  : key === "tutees"
                    ? [
                        { id: "alice", englishName: "Alice Synthetic" },
                        { id: "bob", englishName: "Bob Synthetic" },
                      ]
                    : [],
          }),
        }),
      },
    ),
  },
}));
afterEach(() => {
  cleanup();
  state.sorting = false;
  state.grouped = false;
  state.invalidGroup = false;
  state.rows = null;
  state.sortMissing = false;
  state.confirmed = true;
  state.readOnly = true;
  state.mutate.mockClear();
  state.queryError = null;
  state.pendingRead = false;
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
const mount = (locale: "en" | "zh") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <PairingsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

function savedGroupRows(primaryPairingId = "member-a"): PairingRowOverride[] {
  const tutees = [
    { tuteeId: "student", tutee: { englishName: "Group Student" } },
  ];
  return [
    {
      id: "member-a",
      subject: "Chemistry",
      groupId: "saved-group",
      group: { primaryPairingId },
      tutees,
    },
    {
      id: "member-b",
      subject: "Mathematics",
      groupId: "saved-group",
      group: { primaryPairingId },
      tutees,
    },
    { id: "independent", subject: "Physics", groupId: null, tutees: [] },
  ];
}

it.each([
  ["en", "Mon"],
  ["zh", "周一"],
] as const)(
  "uses the %s locale in both pairing summary and detail schedules",
  (locale, weekday) => {
    mount(locale);
    expect(
      screen.getByRole("cell", { name: `${weekday} 15:30–16:30` }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Synthetic tutor · Synthetic subject/,
      }),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      `${weekday} 15:30–16:30`,
    );
  },
);

it("keeps unconfirmed numeric placeholders out of the Chinese summary and reader", () => {
  state.confirmed = false;
  mount("zh");
  expect(
    screen.getByRole("cell", { name: zh.scheduling.awaiting }),
  ).toBeTruthy();
  expect(screen.queryByText(/15:30/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: /Synthetic tutor · Synthetic subject/ }),
  );
  expect(screen.getByRole("dialog").textContent).toContain(
    zh.scheduling.awaiting,
  );
  expect(screen.queryByText(/15:30/)).toBeNull();
});

it("keeps explicit tutee selection while search hides it and creation closes", () => {
  state.readOnly = false;
  mount("en");
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.pairings.newPairing }),
  );
  acknowledgeCreation();
  fireEvent.click(screen.getByRole("checkbox", { name: "Alice Synthetic" }));
  fireEvent.change(screen.getByLabelText(en.admin.pairings.searchTutees), {
    target: { value: "Bob" },
  });
  expect(
    screen.queryByRole("checkbox", { name: "Alice Synthetic" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", {
      name: en.admin.pairings.removeSelected.replace(
        "{name}",
        "Alice Synthetic",
      ),
    }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.common.close }));
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.pairings.newPairing }),
  );
  acknowledgeCreation();
  fireEvent.change(screen.getByLabelText(en.admin.pairings.searchTutees), {
    target: { value: "" },
  });
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Alice Synthetic" })
      .checked,
  ).toBe(true);
});

it("isolates a retained creation selection from an existing pairing editor", () => {
  state.readOnly = false;
  mount("en");
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.pairings.newPairing }),
  );
  acknowledgeCreation();
  fireEvent.click(screen.getByRole("checkbox", { name: "Alice Synthetic" }));
  fireEvent.click(screen.getByRole("button", { name: en.common.close }));
  fireEvent.click(screen.getByRole("button", { name: /^Edit:/ }));
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Alice Synthetic" })
      .checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "Bob Synthetic" }));
  fireEvent.click(screen.getByRole("button", { name: en.common.close }));
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.pairings.newPairing }),
  );
  acknowledgeCreation();
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Alice Synthetic" })
      .checked,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Bob Synthetic" })
      .checked,
  ).toBe(false);
});

function acknowledgeCreation(messages = en) {
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: messages.admin.creationRisk.acknowledgement,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.admin.creationRisk.continue }),
  );
}

it.each(["en", "zh"] as const)(
  "requires a fresh acknowledgement before each pairing editor opening (%s)",
  (locale) => {
    state.readOnly = false;
    const messages = locale === "en" ? en : zh;
    mount(locale);
    const trigger = screen.getByRole("button", {
      name: messages.admin.pairings.newPairing,
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(
      screen.queryByRole("dialog", {
        name: messages.admin.pairings.newPairing,
      }),
    ).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.admin.creationRisk.continue,
      }).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: messages.admin.creationRisk.cancel }),
    );
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    acknowledgeCreation(messages);
    expect(
      screen.getByRole("dialog", { name: messages.admin.pairings.newPairing }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Alice Synthetic" }));
    fireEvent.click(
      screen.getByRole("button", { name: messages.common.close }),
    );
    fireEvent.click(trigger);
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: messages.admin.creationRisk.acknowledgement,
      }).checked,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: messages.admin.creationRisk.cancel }),
    );
    fireEvent.click(trigger);
    acknowledgeCreation(messages);
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: "Alice Synthetic",
      }).checked,
    ).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  },
);

it("keeps manual pairing creation unavailable to read-only viewers", () => {
  mount("en");
  expect(
    screen.queryByRole("button", { name: en.admin.pairings.newPairing }),
  ).toBeNull();
  expect(
    screen.queryByRole("dialog", { name: en.admin.creationRisk.pairing.title }),
  ).toBeNull();
});

it("keeps an acknowledged warning cancellable when pairing reference data fails", () => {
  state.readOnly = false;
  const view = mount("en");
  const trigger = screen.getByRole("button", {
    name: en.admin.pairings.newPairing,
  });
  fireEvent.click(trigger);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: en.admin.creationRisk.acknowledgement,
    }),
  );
  state.queryError = { message: "Reference refresh failed" };
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        <PairingsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const proceed = screen.getByRole<HTMLButtonElement>("button", {
    name: en.admin.creationRisk.continue,
  });
  expect(proceed.disabled).toBe(true);
  fireEvent.click(proceed);
  expect(
    screen.queryByRole("dialog", { name: en.admin.pairings.newPairing }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.creationRisk.cancel }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  state.queryError = null;
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        <PairingsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(trigger);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: en.admin.creationRisk.acknowledgement,
    }).checked,
  ).toBe(false);
  acknowledgeCreation();
  expect(
    screen.getByRole("dialog", { name: en.admin.pairings.newPairing }),
  ).toBeTruthy();
  expect(state.mutate).not.toHaveBeenCalled();
});

function arrivalPage(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <PairingsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function revealSpy() {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  return scroll;
}
it("reveals a shortage target only after authorized async data commits", () => {
  const scroll = revealSpy(),
    client = new QueryClient();
  window.history.replaceState(null, "", "/admin/pairings#pairing");
  state.pendingRead = true;
  const page = render(arrivalPage(client));
  expect(document.getElementById("pairing")).toBeNull();
  expect(scroll).not.toHaveBeenCalled();
  state.pendingRead = false;
  page.rerender(arrivalPage(client));
  expect(document.activeElement).toBe(document.getElementById("pairing"));
  expect(scroll).toHaveBeenCalledOnce();
});
it.each(["active", "pending", "needsRoom"] as const)(
  "opens a filtered-out record through its exact validated arrival (%s)",
  (filter) => {
    const scroll = revealSpy();
    state.rows = [
      {
        id: "pairing",
        subject: "Target",
        room: filter === "pending" ? { name: "204" } : null,
        tutees: [],
      },
    ];
    window.history.replaceState(null, "", "/admin/pairings");
    render(arrivalPage(new QueryClient()));
    fireEvent.click(
      screen.getByRole("button", {
        name: filter === "needsRoom" ? /Needs room/ : en.roomAllocation[filter],
      }),
    );
    expect(document.getElementById("pairing")).toBeNull();
    act(() => {
      window.history.replaceState(null, "", "/admin/pairings#pairing");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(document.activeElement).toBe(document.getElementById("pairing"));
    expect(
      screen
        .getByRole("button", { name: en.roomAllocation.all })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(scroll).toHaveBeenCalledOnce();
  },
);
it("does not resurrect a cancelled loading arrival or denied cached record", () => {
  const scroll = revealSpy(),
    client = new QueryClient();
  window.history.replaceState(null, "", "/admin/pairings#pairing");
  state.pendingRead = true;
  const page = render(arrivalPage(client));
  fireEvent.wheel(window);
  state.pendingRead = false;
  page.rerender(arrivalPage(client));
  expect(scroll).not.toHaveBeenCalled();
  state.queryError = { message: "Denied", data: { code: "FORBIDDEN" } };
  page.rerender(arrivalPage(client));
  expect(document.getElementById("pairing")).toBeNull();
  state.queryError = null;
  page.rerender(arrivalPage(client));
  expect(scroll).not.toHaveBeenCalled();
});

// Exercise the final six-column page: the five pairing facts sort, while Actions
// and tutor-wide workload advice retain their own feature boundaries.
it.each(["en", "zh"] as const)(
  "cycles every information column without writes (%s)",
  (locale) => {
    state.sorting = true;
    state.readOnly = false;
    mount(locale);
    const messages = locale === "en" ? en : zh;
    const headings = [
      messages.admin.pairings.colTutor,
      messages.admin.pairings.colSubject,
      messages.admin.pairings.colWhen,
      messages.admin.pairings.colRoom,
      messages.admin.pairings.colTutees,
    ];
    const ids = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.id);
    expect(ids()).toEqual(["z", "a"]);
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(
      screen.queryByRole("button", { name: messages.tablePatterns.actions }),
    ).toBeNull();
    expect(
      screen.queryByRole("columnheader", {
        name: messages.tutorWorkload.countHeading,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("columnheader", {
        name: messages.tutorWorkload.preferenceHeading,
      }),
    ).toBeNull();
    for (const name of headings) {
      const header = screen.getByRole("button", { name });
      fireEvent.click(header);
      const sortsNames = name === messages.admin.pairings.colTutees;
      expect(ids()).toEqual(sortsNames ? ["z", "a"] : ["a", "z"]);
      expect(header.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
      fireEvent.click(header);
      expect(ids()).toEqual(["z", "a"]);
      expect(header.closest("th")?.getAttribute("aria-sort")).toBe(
        "descending",
      );
      fireEvent.click(header);
      expect(ids()).toEqual(["z", "a"]);
      expect(header.closest("th")?.hasAttribute("aria-sort")).toBe(false);
    }
    expect(state.mutate).not.toHaveBeenCalled();
  },
);

it.each([
  ["en", false],
  ["zh", false],
  ["en", true],
  ["zh", true],
] as const)(
  "sorts room badges and schedules by their reserved values (%s, read-only: %s)",
  (locale, readOnly) => {
    state.sorting = true;
    state.sortMissing = true;
    state.readOnly = readOnly;
    mount(locale);
    const messages = locale === "en" ? en : zh;
    const table = within(
      screen.getByRole("table", { name: messages.admin.pairings.title }),
    );
    const ids = () =>
      table
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.id);
    const original = ["z", "roomless", "awaiting", "a"];
    expect(ids()).toEqual(original);
    const room = table.getByRole("button", {
      name: messages.admin.pairings.colRoom,
    });
    fireEvent.click(room);
    expect(ids()).toEqual(["a", "z", "roomless", "awaiting"]);
    fireEvent.click(room);
    expect(ids()).toEqual(["z", "a", "roomless", "awaiting"]);
    fireEvent.click(room);
    expect(ids()).toEqual(original);
    const when = table.getByRole("button", {
      name: messages.admin.pairings.colWhen,
    });
    fireEvent.click(when);
    expect(ids()).toEqual(["a", "roomless", "z", "awaiting"]);
    fireEvent.click(when);
    expect(ids()).toEqual(["z", "roomless", "a", "awaiting"]);
    fireEvent.click(when);
    expect(ids()).toEqual(original);
    // Row identity and its reader survive sorting; sorting grants no write access.
    const first = within(table.getAllByRole("row")[1]!);
    fireEvent.click(
      first.getByRole("button", {
        name: `${messages.tablePatterns.details}: Zoe Synthetic · Physics`,
      }),
    );
    expect(screen.getByRole("dialog").textContent).toContain("Room 10");
    expect(
      Boolean(
        first.queryByRole("button", {
          name: `${messages.admin.pairings.edit}: Zoe Synthetic · Physics`,
        }),
      ),
    ).toBe(!readOnly);
    expect(state.mutate).not.toHaveBeenCalled();
  },
);

it.each(["en", "zh"] as const)(
  "shares saved-group facts and a common roster across subjects (%s)",
  (locale) => {
    state.grouped = true;
    state.confirmed = false;
    mount(locale);
    const messages = locale === "en" ? en : zh;
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    const reference = messages.pairingGroups.reference.replace(
      "{id}",
      "saved-group",
    );
    const first = document.getElementById("member-a")!;
    const second = document.getElementById("member-b")!;
    expect(first.closest("tbody")).toBe(second.closest("tbody"));
    expect(
      within(first)
        .getByRole("cell", { name: "Synthetic tutor" })
        .getAttribute("rowspan"),
    ).toBe("2");
    const schedule = first.querySelector<HTMLTableCellElement>(
      "td[data-sort-value]",
    )!;
    expect(schedule.textContent).toBe(messages.scheduling.awaiting);
    expect(schedule.rowSpan).toBe(2);
    expect(first.querySelectorAll('td[rowspan="2"]')).toHaveLength(4);
    expect(
      within(first).getByRole<HTMLTableCellElement>("cell", {
        name: "Group Student",
      }).rowSpan,
    ).toBe(2);
    expect(within(second).queryByText("Group Student")).toBeNull();
    expect(within(second).queryByText("Synthetic tutor")).toBeNull();
    expect(screen.queryByText(reference)).toBeNull();
    expect(
      within(first).getByRole("cell", { name: "Chemistry" }).textContent,
    ).toBe("Chemistry");
    expect(
      within(second).getByRole("cell", { name: "Mathematics" }).textContent,
    ).toBe("Mathematics");
    const independent = document.getElementById("independent")!;
    expect(independent.closest("tbody")).not.toBe(first.closest("tbody"));
    expect(within(independent).getByText("Synthetic tutor")).toBeTruthy();
    expect(independent.textContent).not.toContain(reference);
    expect(screen.queryByRole("button", { name: /^Edit:/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Synthetic tutor · Chemistry/ }),
    );
    const dialog = screen.getByRole("dialog");
    const group = within(dialog)
      .getByRole("heading", { name: reference })
      .closest("section")!;
    expect(
      within(group).getByText(messages.pairingGroups.status.awaiting),
    ).toBeTruthy();
    expect(within(group).getByText("Chemistry + Mathematics")).toBeTruthy();
    expect(within(group).getAllByText("Group Student")).toHaveLength(1);
    expect(within(group).getByText("Chemistry, Mathematics")).toBeTruthy();
    expect(state.mutate).not.toHaveBeenCalled();
  },
);

it("keeps incomplete saved-group membership and exposes repair evidence in Details", () => {
  state.grouped = true;
  state.invalidGroup = true;
  mount("en");
  expect(document.getElementById("member-a")!.closest("tbody")).toBe(
    document.getElementById("member-b")!.closest("tbody"),
  );
  expect(screen.queryByText(en.pairingGroups.status.needsRepair)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: /Synthetic tutor · Chemistry/ }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(en.pairingGroups.needsRepair),
  ).toBeTruthy();
  expect(state.mutate).not.toHaveBeenCalled();
});

it.each(["en", "zh"] as const)(
  "preserves repeated-subject student assignments and an independent multi-student pairing (%s)",
  (locale) => {
    state.rows = [
      {
        id: "math-alice",
        subject: "Mathematics",
        groupId: "same-subject",
        group: { primaryPairingId: "math-alice" },
        tutees: [
          { tuteeId: "alice", tutee: { englishName: "Alice Synthetic" } },
        ],
      },
      {
        id: "math-bob",
        subject: "Mathematics",
        groupId: "same-subject",
        group: { primaryPairingId: "math-alice" },
        tutees: [{ tuteeId: "bob", tutee: { englishName: "Bob Synthetic" } }],
      },
      {
        id: "math-independent",
        subject: "Mathematics",
        groupId: null,
        tutees: [
          { tuteeId: "charlie", tutee: { englishName: "Charlie Synthetic" } },
          { tuteeId: "dana", tutee: { englishName: "Dana Synthetic" } },
        ],
      },
    ];
    mount(locale);
    const alice = document.getElementById("math-alice")!;
    const bob = document.getElementById("math-bob")!;
    const independent = document.getElementById("math-independent")!;
    expect(alice.closest("tbody")).toBe(bob.closest("tbody"));
    expect(alice.closest("tbody")).not.toBe(independent.closest("tbody"));
    expect(
      within(alice).getByRole<HTMLTableCellElement>("cell", {
        name: "Mathematics",
      }).rowSpan,
    ).toBe(2);
    expect(within(bob).queryByText("Mathematics")).toBeNull();
    expect(within(alice).getByText("Alice Synthetic")).toBeTruthy();
    expect(within(alice).queryByText("Bob Synthetic")).toBeNull();
    expect(within(bob).getByText("Bob Synthetic")).toBeTruthy();
    expect(within(bob).queryByText("Alice Synthetic")).toBeNull();
    expect(
      within(alice).getByRole<HTMLTableCellElement>("cell", {
        name: "Alice Synthetic",
      }).rowSpan,
    ).toBe(1);
    expect(
      within(bob).getByRole<HTMLTableCellElement>("cell", {
        name: "Bob Synthetic",
      }).rowSpan,
    ).toBe(1);
    expect(within(independent).getByText("Charlie Synthetic")).toBeTruthy();
    expect(within(independent).getByText("Dana Synthetic")).toBeTruthy();
    expect(within(independent).queryByRole("cell", { name: "2" })).toBeNull();
    expect(
      within(independent).getByRole("cell", { name: "Synthetic tutor" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(state.mutate).not.toHaveBeenCalled();
  },
);

it.each([true, false])(
  "compares full roster identity sets instead of order or names (same students: %s)",
  (sameStudents) => {
    const roster = [
      { tuteeId: "alex", tutee: { englishName: "Alex Synthetic" } },
      { tuteeId: "sam", tutee: { englishName: "Sam Synthetic" } },
    ];
    const reversed = [...roster]
      .reverse()
      .map((student) =>
        sameStudents
          ? student
          : { ...student, tuteeId: `other-${student.tuteeId}` },
      );
    state.rows = savedGroupRows()
      .slice(0, 2)
      .map((row, index) => ({
        ...row,
        subject: "Mathematics",
        tutees: index === 0 ? roster : reversed,
      }));
    if (sameStudents)
      state.rows.push({
        id: "peer",
        subject: "Physics",
        groupId: null,
        tutees: reversed,
      });
    mount("en");
    const first = within(document.getElementById("member-a")!);
    const second = within(document.getElementById("member-b")!);
    expect(
      first.getByRole<HTMLTableCellElement>("cell", { name: /Alex Synthetic/ })
        .rowSpan,
    ).toBe(sameStudents ? 2 : 1);
    expect(Boolean(second.queryByText("Alex Synthetic"))).toBe(!sameStudents);
    expect(Boolean(second.queryByText("Sam Synthetic"))).toBe(!sameStudents);
    if (sameStudents) {
      // Equal displayed names tie regardless of group size or enrollment order.
      const tutees = screen.getByRole("button", {
        name: en.admin.pairings.colTutees,
      });
      for (let direction = 0; direction < 2; direction++) {
        fireEvent.click(tutees);
        expect(
          screen
            .getAllByRole("row")
            .slice(1)
            .map((row) => row.id),
        ).toEqual(["member-a", "member-b", "peer"]);
      }
    }
    expect(state.mutate).not.toHaveBeenCalled();
  },
);

it("sorts interleaving subjects as saved groups while retaining every member action", () => {
  const roster = [
    { tuteeId: "student", tutee: { englishName: "Group Student" } },
  ];
  state.rows = [
    {
      id: "biology",
      subject: "Biology",
      groupId: "science",
      group: { primaryPairingId: "physics" },
      tutees: roster,
    },
    {
      id: "physics",
      subject: "Physics",
      groupId: "science",
      group: { primaryPairingId: "physics" },
      tutees: roster,
    },
    { id: "chemistry", subject: "Chemistry", groupId: null, tutees: roster },
  ];
  state.readOnly = false;
  mount("en");
  const table = within(
    screen.getByRole("table", { name: en.admin.pairings.title }),
  );
  const ids = () =>
    table
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.id);
  expect(ids()).toEqual(["physics", "biology", "chemistry"]);
  const subject = table.getByRole("button", {
    name: en.admin.pairings.colSubject,
  });
  fireEvent.click(subject);
  expect(ids()).toEqual(["chemistry", "physics", "biology"]);
  fireEvent.click(subject);
  expect(ids()).toEqual(["physics", "biology", "chemistry"]);
  fireEvent.click(subject);
  expect(ids()).toEqual(["physics", "biology", "chemistry"]);
  for (const [id, label] of [
    ["physics", "Physics"],
    ["biology", "Biology"],
  ]) {
    const row = within(document.getElementById(id!)!);
    expect(
      row.getByRole("button", {
        name: `${en.admin.pairings.edit}: Synthetic tutor · ${label}`,
      }),
    ).toBeTruthy();
    expect(
      row.getByRole("button", { name: en.admin.pairings.delete }),
    ).toBeTruthy();
    expect(
      row.getByRole("button", {
        name: `${en.tablePatterns.details}: Synthetic tutor · ${label}`,
      }),
    ).toBeTruthy();
  }
  expect(state.mutate).not.toHaveBeenCalled();
});

it.each([
  ["en", false],
  ["zh", false],
  ["en", true],
  ["zh", true],
] as const)(
  "filters complete groups by schedule and room readiness (%s, read-only: %s)",
  (locale, readOnly) => {
    const assigned = { scheduleConfirmed: true, room: { name: "204" } };
    state.readOnly = readOnly;
    state.rows = [
      { ...assigned, id: "assigned", subject: "Assigned", tutees: [] },
      {
        id: "no-room-needed",
        subject: "No physical room",
        roomMode: "NONE",
        tutees: [],
      },
      {
        ...assigned,
        id: "awaiting",
        subject: "Awaiting",
        scheduleConfirmed: false,
        tutees: [],
      },
      {
        id: "roomless",
        subject: "Room needed",
        roomNeedsAssignment: true,
        tutees: [],
      },
      ...savedGroupRows()
        .slice(0, 2)
        .map((row, index) => ({
          ...row,
          ...assigned,
          id: `active-${index}`,
          groupId: "active-group",
          group: { primaryPairingId: "active-0" },
        })),
      ...savedGroupRows()
        .slice(0, 2)
        .map((row, index) => ({
          ...row,
          room: index === 0 ? assigned.room : null,
          roomNeedsAssignment: index === 1,
        })),
      ...savedGroupRows()
        .slice(0, 2)
        .map((row, index) => ({
          ...row,
          ...assigned,
          id: `schedule-${index}`,
          groupId: "schedule-group",
          group: { primaryPairingId: "schedule-0" },
          scheduleConfirmed: index === 0,
        })),
    ];
    mount(locale);
    const messages = locale === "en" ? en : zh;
    const ids = () =>
      within(screen.getByRole("table", { name: messages.admin.pairings.title }))
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.id);
    const all = [
      "assigned",
      "no-room-needed",
      "awaiting",
      "roomless",
      "active-0",
      "active-1",
      "member-a",
      "member-b",
      "schedule-0",
      "schedule-1",
    ];
    expect(ids()).toEqual(all);
    for (const [label, expected] of [
      [
        messages.roomAllocation.active,
        ["assigned", "no-room-needed", "active-0", "active-1"],
      ],
      [
        messages.roomAllocation.pending,
        [
          "awaiting",
          "roomless",
          "member-a",
          "member-b",
          "schedule-0",
          "schedule-1",
        ],
      ],
      [
        messages.roomAllocation.needsRoomReservations.replace("{count}", "2"),
        ["roomless", "member-a", "member-b"],
      ],
      [messages.roomAllocation.all, all],
    ] as const) {
      const button = screen.getByRole("button", { name: label });
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(ids()).toEqual(expected);
    }
    expect(state.mutate).not.toHaveBeenCalled();
  },
);

it("retains every saved member when the room filter matches only one member", () => {
  state.rows = savedGroupRows();
  state.rows[0]!.roomNeedsAssignment = true;
  mount("en");
  fireEvent.click(screen.getByRole("button", { name: /Needs room/ }));
  const first = document.getElementById("member-a")!;
  const second = document.getElementById("member-b")!;
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(first.closest("tbody")).toBe(second.closest("tbody"));
  expect(document.getElementById("independent")).toBeNull();
  expect(
    within(first).getByRole<HTMLTableCellElement>("cell", {
      name: "Group Student",
    }).rowSpan,
  ).toBe(2);
  expect(within(second).queryByText("Group Student")).toBeNull();
  expect(state.mutate).not.toHaveBeenCalled();
});

it("shows divergent schedule and room facts on their own saved-group members", () => {
  state.rows = savedGroupRows();
  state.rows[1]!.dayOfWeek = 2;
  state.rows[1]!.room = { name: "Repair Room" };
  mount("en");
  const first = document.getElementById("member-a")!;
  const second = document.getElementById("member-b")!;
  expect(first.closest("tbody")).toBe(second.closest("tbody"));
  expect(
    within(first).getByRole<HTMLTableCellElement>("cell", {
      name: "Mon 15:30–16:30",
    }).rowSpan,
  ).toBe(1);
  expect(
    within(second).getByRole<HTMLTableCellElement>("cell", {
      name: "Tue 15:30–16:30",
    }).rowSpan,
  ).toBe(1);
  expect(within(second).getByText("Repair Room")).toBeTruthy();
  expect(within(first).queryByText("Repair Room")).toBeNull();
  fireEvent.click(
    within(second).getByRole("button", {
      name: `${en.tablePatterns.details}: Synthetic tutor · Mathematics`,
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(en.pairingGroups.needsRepair),
  ).toBeTruthy();
  expect(state.mutate).not.toHaveBeenCalled();
});

it("reveals a nonprimary saved-group member through its original notification anchor", () => {
  state.rows = savedGroupRows("member-b");
  const scroll = revealSpy();
  window.history.replaceState(null, "", "/admin/pairings#member-a");
  mount("en");
  expect(document.activeElement).toBe(document.getElementById("member-a"));
  expect(scroll).toHaveBeenCalledOnce();
  expect(document.getElementById("member-a")!.closest("tbody")).toBe(
    document.getElementById("member-b")!.closest("tbody"),
  );
  expect(state.mutate).not.toHaveBeenCalled();
});

it.each(["active", "pending", "needsRoom"] as const)(
  "keeps a deliberate %s filter when an arrival is still waiting for its read",
  (filter) => {
    const scroll = revealSpy();
    const client = new QueryClient();
    state.rows = [
      {
        id: "pairing",
        subject: "Target",
        room: filter === "pending" ? { name: "204" } : null,
        tutees: [],
      },
    ];
    window.history.replaceState(null, "", "/admin/pairings#pairing");
    state.pendingRead = true;
    const page = render(arrivalPage(client));
    const label =
      filter === "needsRoom" ? /Needs room/ : en.roomAllocation[filter];
    fireEvent.click(screen.getByRole("button", { name: label }));
    state.pendingRead = false;
    page.rerender(arrivalPage(client));
    expect(
      screen.getByRole("button", { name: label }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.getElementById("pairing")).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
  },
);

it.each(["active", "pending", "needsRoom"] as const)(
  "does not reapply an already revealed arrival after a user selects %s",
  (filter) => {
    const scroll = revealSpy();
    const client = new QueryClient();
    state.rows = [
      {
        id: "pairing",
        subject: "Target",
        room: filter === "pending" ? { name: "204" } : null,
        tutees: [],
      },
    ];
    window.history.replaceState(null, "", "/admin/pairings#pairing");
    const page = render(arrivalPage(client));
    expect(scroll).toHaveBeenCalledOnce();
    const label =
      filter === "needsRoom" ? /Needs room/ : en.roomAllocation[filter];
    fireEvent.click(screen.getByRole("button", { name: label }));
    page.rerender(arrivalPage(client));
    expect(document.getElementById("pairing")).toBeNull();
    expect(
      screen.getByRole("button", { name: label }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(scroll).toHaveBeenCalledOnce();
  },
);
