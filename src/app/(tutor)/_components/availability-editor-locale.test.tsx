// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { AvailabilityEditor } from "./availability-editor";

const state = vi.hoisted(() => ({ save: vi.fn(), reset: vi.fn() }));
// Intentionally unsorted catalog input: locale only changes presentation, while
// the editor still orders ISO weekdays and submits the original slot IDs.
const slots = [
  { id: "sunday", label: "Weekend", dayOfWeek: 7, startMin: 900, endMin: 960 },
  { id: "monday", label: "Morning", dayOfWeek: 1, startMin: 480, endMin: 540 },
  ...[2, 3, 4, 5, 6].map((dayOfWeek) => ({
    id: `day-${dayOfWeek}`,
    label: `Day ${dayOfWeek}`,
    dayOfWeek,
    startMin: 600,
    endMin: 660,
  })),
];
vi.mock("~/trpc/react", () => ({
  api: {
    tutor: {
      myAvailability: {
        useQuery: () => ({
          data: { slots, selectedSlotIds: ["monday"] },
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      setAvailability: {
        useMutation: () => ({
          mutate: state.save,
          reset: state.reset,
          isPending: false,
          isSuccess: false,
          error: null,
        }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  {
    locale: "en",
    messages: en,
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },
  {
    locale: "zh",
    messages: zh,
    weekdays: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
  },
])(
  "localizes $locale visible and accessible weekdays without changing Save IDs",
  ({ locale, messages, weekdays }) => {
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <AvailabilityEditor />
      </NextIntlClientProvider>,
    );
    const groups = screen.getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(
      weekdays,
    );
    for (const weekday of weekdays) {
      const heading = screen.getByText(weekday);
      // Guard the painted leaf: a readable parent cannot fix a faded child.
      expect(heading.classList.contains("text-slate-600")).toBe(true);
      expect(heading.classList.contains("text-slate-400")).toBe(false);
    }
    const monday = screen.getByRole("group", { name: weekdays[0] });
    const sunday = screen.getByRole("group", { name: weekdays[6] });
    const morning = within(monday).getByRole("button", {
      name: "Morning (08:00–09:00)",
    });
    const weekend = within(sunday).getByRole("button", {
      name: "Weekend (15:00–16:00)",
    });
    expect(morning.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(morning);
    fireEvent.click(weekend);
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.availability.save }),
    );
    expect(state.save).toHaveBeenCalledExactlyOnceWith({ slotIds: ["sunday"] });
    expect(
      slots.map(({ dayOfWeek, startMin, endMin }) => ({
        dayOfWeek,
        startMin,
        endMin,
      })),
    ).toEqual([
      { dayOfWeek: 7, startMin: 900, endMin: 960 },
      { dayOfWeek: 1, startMin: 480, endMin: 540 },
      ...[2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        startMin: 600,
        endMin: 660,
      })),
    ]);
  },
);
