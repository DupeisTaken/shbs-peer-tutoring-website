/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  SchoolCalendarDayContext,
  SchoolCalendarNotice,
} from "./school-calendar-notice";
import {
  navigateNotificationFragment,
  schoolCalendarHashDate,
} from "~/lib/notification-navigation";

type Day = {
  date: string;
  isSchoolDay: boolean;
  timetableWeekday: number | null;
  version: number;
  scheduleRevision: number;
};
const state = vi.hoisted(() => ({
  days: [] as Day[] | undefined,
  error: null as null | { message: string; data?: { code?: string } },
  query: vi.fn(),
  refetch: vi.fn(),
  reveal: vi.fn(),
  fetching: false,
}));
vi.mock("./focus-visible-context", () => ({
  focusVisibleContext: state.reveal,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      schoolCalendar: {
        useQuery: (...args: unknown[]) => {
          state.query(...args);
          return {
            data: state.days,
            error: state.error,
            isSuccess: state.days !== undefined && !state.error,
            isFetching: state.fetching,
            refetch: state.refetch,
          };
        },
      },
    },
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T16:05:00Z"));
  state.days = [
    {
      date: "2026-11-01",
      isSchoolDay: true,
      timetableWeekday: 1,
      version: 3,
      scheduleRevision: 2,
    },
  ];
  state.error = null;
  state.fetching = false;
  window.history.replaceState(null, "", "/dashboard");
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const tree = (locale: "en" | "zh" = "en", timeZone = "Asia/Shanghai") => (
  <NextIntlClientProvider
    locale={locale}
    timeZone={timeZone}
    messages={locale === "en" ? en : zh}
  >
    <SchoolCalendarNotice />
  </NextIntlClientProvider>
);

it.each(["en", "zh"] as const)(
  "shows the actual date and mapped timetable in %s",
  (locale) => {
    render(tree(locale));
    expect(document.querySelector('time[datetime="2026-11-01"]')).toBeTruthy();
    expect(
      screen.getByText(
        locale === "en" ? /Follows Mon timetable/ : /采用周一课表/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(state.query).toHaveBeenCalledWith(
      { from: "2026-11-01", to: "2026-11-14" },
      { enabled: true, refetchInterval: 60_000 },
    );
  },
);

it("queries fourteen program-local dates rather than the browser date", () => {
  render(tree("en", "America/Los_Angeles"));
  expect(state.query).toHaveBeenCalledWith(
    { from: "2026-10-31", to: "2026-11-13" },
    expect.anything(),
  );
});

it("updates the bounded query on focus after program-local midnight", () => {
  render(tree());
  vi.setSystemTime(new Date("2026-11-01T16:05:00Z"));
  fireEvent.focus(window);
  expect(state.query).toHaveBeenLastCalledWith(
    { from: "2026-11-02", to: "2026-11-15" },
    expect.anything(),
  );
});

it("preserves agreed-session context for closures and keeps the horizon inclusive", () => {
  state.days = [
    {
      date: "2026-11-14",
      isSchoolDay: false,
      timetableWeekday: null,
      version: 1,
      scheduleRevision: 1,
    },
    {
      date: "2026-11-15",
      isSchoolDay: false,
      timetableWeekday: null,
      version: 1,
      scheduleRevision: 1,
    },
  ];
  render(tree());
  expect(document.querySelector('time[datetime="2026-11-14"]')).toBeTruthy();
  expect(document.querySelector('time[datetime="2026-11-15"]')).toBeNull();
  expect(screen.getByText(en.schoolCalendar.closureWarning)).toBeTruthy();
});

it("makes no cancellation action available in reusable closure context", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SchoolCalendarDayContext
        date="2026-11-01"
        isSchoolDay={false}
        effectiveTimetableWeekday={null}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(/No school/)).toBeTruthy();
  expect(screen.getByText(en.schoolCalendar.closureWarning)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows loading and failed reads without claiming the calendar is empty", () => {
  state.days = undefined;
  const view = render(tree());
  expect(screen.getByText(en.schoolCalendar.loading)).toBeTruthy();
  state.error = { message: "Offline" };
  view.rerender(tree());
  expect(
    screen.getByRole("button", { name: en.schoolCalendar.refresh }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.refresh }),
  );
  expect(state.refetch).toHaveBeenCalledTimes(1);
});

it("hides denied cached dates through transport failures until a fresh successful read", () => {
  const view = render(tree());
  state.error = { message: "Denied", data: { code: "UNAUTHORIZED" } };
  view.rerender(tree());
  expect(document.querySelector("time")).toBeNull();
  state.error = { message: "Offline" };
  view.rerender(tree());
  expect(document.querySelector("time")).toBeNull();
  state.error = null;
  view.rerender(tree());
  expect(document.querySelector('time[datetime="2026-11-01"]')).toBeTruthy();
});

it("retains previously loaded context with a refresh warning on an ordinary read failure", () => {
  window.history.replaceState(null, "", "/dashboard#school-calendar/2026-11-01");
  state.error = { message: "Offline" };
  render(tree());
  expect(document.querySelector('time[datetime="2026-11-01"]')).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText(en.schoolCalendar.currentCalendar)).toBeNull();
});

it("adds no empty panel when there are no date overrides", () => {
  state.days = [];
  render(tree());
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText(en.schoolCalendar.noticeTitle)).toBeNull();
});

const changeHash = (hash: string) => {
  window.history.replaceState(null, "", `/dashboard${hash}`);
  fireEvent(window, new HashChangeEvent("hashchange"));
};

it("loads and reveals a validated notification date beyond the upcoming horizon once", () => {
  window.history.replaceState(
    null,
    "",
    "/dashboard#school-calendar/2026-12-01",
  );
  state.days = [
    {
      date: "2026-12-01",
      isSchoolDay: true,
      timetableWeekday: 1,
      version: 1,
      scheduleRevision: 1,
    },
  ];
  const view = render(tree());
  expect(state.query).toHaveBeenLastCalledWith(
    { from: "2026-12-01", to: "2026-12-01" },
    { enabled: true, refetchInterval: 60_000 },
  );
  expect(
    state.query.mock.calls
      .filter((call) => (call[1] as { enabled: boolean }).enabled)
      .every((call) => (call[0] as { from: string }).from === "2026-12-01"),
  ).toBe(true);
  expect(document.querySelector('time[datetime="2026-12-01"]')).toBeTruthy();
  expect(screen.getByText(en.schoolCalendar.currentCalendar)).toBeTruthy();
  expect(state.reveal).toHaveBeenCalledExactlyOnceWith(
    document.getElementById("school-calendar"),
  );
  expect(document.getElementById("school-calendar")?.tabIndex).toBe(-1);
  state.fetching = true;
  view.rerender(tree());
  state.fetching = false;
  view.rerender(tree());
  expect(state.reveal).toHaveBeenCalledTimes(1);
});

it.each(["en", "zh"] as const)(
  "shows the current default for a reset date with no active override in %s",
  (locale) => {
    window.history.replaceState(
      null,
      "",
      "/dashboard#school-calendar/2026-12-06",
    );
    state.days = [];
    render(tree(locale));
    const t = (locale === "en" ? en : zh).schoolCalendar;
    expect(document.querySelector('time[datetime="2026-12-06"]')).toBeTruthy();
    expect(screen.getByText(t.defaultCalendar)).toBeTruthy();
    expect(screen.getByText(t.currentCalendar)).toBeTruthy();
    expect(screen.getByText(t.closureWarning)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: t.viewUpcoming }).getAttribute("href"),
    ).toBe("#school-calendar");
  },
);

it.each([
  "#school-calendar/2026-02-30",
  "#school-calendar/2026-13-01",
  "#school-calendar/2026-12-01/extra",
  "#school-calendar/2026-12-01?private=1",
  "#school-calendar/2026%2D12%2D01",
  "#school-calendar/not-a-date",
])(
  "ignores malformed calendar fragments without making a date-targeted read or revealing (%s)",
  (hash) => {
    expect(schoolCalendarHashDate(hash)).toBeNull();
    window.history.replaceState(null, "", `/dashboard${hash}`);
    render(tree());
    expect(state.query).toHaveBeenLastCalledWith(
      { from: "2026-11-01", to: "2026-11-14" },
      expect.anything(),
    );
    expect(state.reveal).not.toHaveBeenCalled();
    expect(screen.queryByText(en.schoolCalendar.requestedDateTitle)).toBeNull();
  },
);

it("follows hash changes and returns to upcoming without letting clock refreshes replace the requested date", () => {
  render(tree());
  changeHash("#school-calendar/2026-12-01");
  expect(state.query).toHaveBeenLastCalledWith(
    { from: "2026-12-01", to: "2026-12-01" },
    expect.anything(),
  );
  vi.setSystemTime(new Date("2026-11-03T16:05:00Z"));
  fireEvent.focus(window);
  expect(state.query).toHaveBeenLastCalledWith(
    { from: "2026-12-01", to: "2026-12-01" },
    expect.anything(),
  );
  const back = screen.getByRole("link", {
    name: en.schoolCalendar.viewUpcoming,
  });
  expect(back.getAttribute("href")).toBe("#school-calendar");
  changeHash(back.getAttribute("href")!);
  expect(state.query).toHaveBeenLastCalledWith(
    { from: "2026-11-04", to: "2026-11-17" },
    expect.anything(),
  );
  expect(screen.queryByText(en.schoolCalendar.requestedDateTitle)).toBeNull();
  expect(
    screen.queryByRole("link", { name: en.schoolCalendar.viewUpcoming }),
  ).toBeNull();
});

it("relinquishes a delayed reveal when the user scrolls or navigates elsewhere", () => {
  window.history.replaceState(
    null,
    "",
    "/dashboard#school-calendar/2026-12-01",
  );
  state.days = undefined;
  const view = render(tree());
  fireEvent.wheel(window);
  state.days = [];
  view.rerender(tree());
  expect(state.reveal).not.toHaveBeenCalled();
  state.days = undefined;
  changeHash("#school-calendar/2026-12-02");
  changeHash("#other-section");
  state.days = [];
  view.rerender(tree());
  expect(state.reveal).not.toHaveBeenCalled();
});

it("never reveals or renders a denied date while cached data or a transport failure remains", () => {
  window.history.replaceState(
    null,
    "",
    "/dashboard#school-calendar/2026-12-01",
  );
  state.days = [
    {
      date: "2026-12-01",
      isSchoolDay: false,
      timetableWeekday: null,
      version: 1,
      scheduleRevision: 1,
    },
  ];
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  const view = render(tree());
  expect(document.querySelector("time")).toBeNull();
  expect(screen.queryByText(en.schoolCalendar.currentCalendar)).toBeNull();
  expect(state.reveal).not.toHaveBeenCalled();
  state.error = { message: "Offline" };
  view.rerender(tree());
  expect(document.querySelector("time")).toBeNull();
  expect(state.reveal).not.toHaveBeenCalled();
});

it.each(["/dashboard", "/student"])(
  "handles same-page notification activation and deliberate repeated date activation on %s",
  (route) => {
    window.history.replaceState(null, "", route);
    render(tree());
    const event = { preventDefault: vi.fn() };
    act(() => {
      navigateNotificationFragment(
        `${route}#school-calendar/2026-12-01`,
        event,
      );
    });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(state.query).toHaveBeenLastCalledWith(
      { from: "2026-12-01", to: "2026-12-01" },
      expect.anything(),
    );
    expect(document.querySelector('time[datetime="2026-12-01"]')).toBeTruthy();
    expect(state.reveal).toHaveBeenCalledTimes(1);
    fireEvent.wheel(window);
    act(() => {
      navigateNotificationFragment(
        `${route}#school-calendar/2026-12-01`,
        event,
      );
    });
    expect(state.reveal).toHaveBeenCalledTimes(2);
  },
);

it("does not reveal twice for paired Back/Forward location events", () => {
  render(tree());
  const oldURL = window.location.href;
  window.history.replaceState(
    null,
    "",
    "/dashboard#school-calendar/2026-12-01",
  );
  fireEvent(window, new PopStateEvent("popstate"));
  expect(state.reveal).toHaveBeenCalledTimes(1);
  fireEvent(
    window,
    new HashChangeEvent("hashchange", { oldURL, newURL: window.location.href }),
  );
  expect(state.reveal).toHaveBeenCalledTimes(1);
});
