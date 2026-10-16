/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import TimeSlotsPage from "./page";

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
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
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.timeslots.addSlot }),
  );
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Synthetic draft slot",
  );
});
