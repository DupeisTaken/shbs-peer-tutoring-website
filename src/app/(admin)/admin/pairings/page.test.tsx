/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import PairingsPage from "./page";

const state = vi.hoisted(() => ({
  confirmed: true,
  readOnly: true,
  mutate: vi.fn(),
  queryError: null as null | { message: string },
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readOnly,
}));
vi.mock("~/app/_components/room-grid", () => ({ RoomGrid: () => null }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    admin: new Proxy(
      {},
      {
        get: (_target, key) => ({
          useMutation: () => ({ mutate: state.mutate }),
          useQuery: () => ({
            isSuccess: true,
            error: key === "tutees" ? state.queryError : null,
            data:
              key === "pairings"
                ? [
                    {
                      id: "pairing",
                      tutor: { englishName: "Synthetic tutor" },
                      subject: "Synthetic subject",
                      scheduleConfirmed: state.confirmed,
                      dayOfWeek: 1,
                      startMin: 930,
                      endMin: 990,
                      room: null,
                      tutees: [],
                    },
                  ]
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
  state.confirmed = true;
  state.readOnly = true;
  state.mutate.mockClear();
  state.queryError = null;
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
