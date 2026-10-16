/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
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
import { ReadOnlyProvider } from "~/app/_components/read-only";
import TimeSlotsPage from "./page";

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => {
      const target = { invalidate: vi.fn().mockResolvedValue(undefined) };
      return {
        admin: {
          timeSlots: target,
          pairings: target,
          assignmentWorkloads: target,
        },
        tutor: {
          myPairings: target,
          schedule: target,
          workloadPreference: target,
        },
        student: { me: target },
        studentWorkflow: { mine: target },
        pairingGroups: { mine: target },
        notification: { list: target, unreadCount: target },
      };
    },
    admin: {
      timeSlots: {
        useQuery: () => ({
          data: [
            {
              id: "slot",
              label: "Synthetic slot",
              dayOfWeek: 1,
              startMin: 930,
              endMin: 990,
              active: true,
            },
          ],
          isSuccess: true,
        }),
      },
      createTimeSlot: { useMutation: () => ({}) },
      updateTimeSlot: { useMutation: () => ({ reset: vi.fn() }) },
      deleteTimeSlot: { useMutation: () => ({}) },
    },
  },
}));
afterEach(cleanup);

function mount(locale: "en" | "zh", readOnly: boolean) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <ReadOnlyProvider value={readOnly}>
          <TimeSlotsPage />
        </ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

it.each([
  ["en", "Mon"],
  ["zh", "周一"],
] as const)(
  "keeps the complete %s summary and guidance accessible without a duplicate reader",
  (locale, weekday) => {
    mount(locale, true);
    expect(screen.getByRole("cell", { name: weekday })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "15:30–16:30" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Synthetic slot/ })).toBeNull();
    expect(
      screen.queryByRole("columnheader", {
        name: (locale === "en" ? en : zh).tablePatterns.actions,
      }),
    ).toBeNull();
    expect(
      screen.getByText(
        (locale === "en" ? en : zh).admin.timeslots.propagationNote,
      ),
    ).toBeTruthy();
  },
);

it("keeps authorized editing and propagation guidance after removing the redundant reader", () => {
  mount("en", false);
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.admin.timeslots.edit}: Synthetic slot`,
    }),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(
    screen.getAllByText(en.admin.timeslots.propagationNote).length,
  ).toBeGreaterThan(0);
});

it("keeps a new slot draft after dismissing and reopening creation", () => {
  mount("en", false);
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.timeslots.addSlot }),
  );
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Synthetic draft slot" } });
  fireEvent.click(screen.getByRole("button", { name: en.common.close }));
  expect(screen.queryByRole("textbox")).toBeNull();
  // Editing an existing slot owns different fields from the retained creation draft.
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.admin.timeslots.edit}: Synthetic slot`,
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByRole<HTMLInputElement>("textbox")
      .value,
  ).toBe("Synthetic slot");
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.timeslots.cancel }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.timeslots.addSlot }),
  );
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Synthetic draft slot",
  );
});

it.each(["en", "zh"] as const)(
  "retains all seven localized weekdays in the %s creation form",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    mount(locale, false);
    fireEvent.click(
      screen.getByRole("button", { name: copy.admin.timeslots.addSlot }),
    );
    const day = within(screen.getByRole("dialog")).getByRole("combobox", {
      name: copy.admin.timeslots.day,
    });
    const options = within(day).getAllByRole<HTMLOptionElement>("option");
    expect(options.map((option) => option.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    expect(options[0]?.textContent).toBe(locale === "en" ? "Mon" : "周一");
    expect(options[6]?.textContent).toBe(locale === "en" ? "Sun" : "周日");
  },
);
