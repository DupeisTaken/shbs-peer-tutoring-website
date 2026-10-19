// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { TutorUpcoming } from "./tutor-upcoming";

const state = vi.hoisted(() => ({
  pairings: [] as unknown[],
  interviews: [] as unknown[],
  pairingsError: null as null | { data?: { code: string } },
  interviewsError: null as null | { data?: { code: string } },
  missing: false,
  refreshPairings: vi.fn(),
  refreshInterviews: vi.fn(),
  options: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    tutor: {
      myPairings: {
        useQuery: (_: unknown, options: unknown) => {
          state.options("pairings", options);
          return {
            data: state.missing ? undefined : state.pairings,
            error: state.pairingsError,
            isSuccess: !state.missing && !state.pairingsError,
            refetch: state.refreshPairings,
          };
        },
      },
      myInterviews: {
        useQuery: (_: unknown, options: unknown) => {
          state.options("interviews", options);
          return {
            data: state.missing ? undefined : state.interviews,
            error: state.interviewsError,
            isSuccess: !state.missing && !state.interviewsError,
            refetch: state.refreshInterviews,
          };
        },
      },
    },
  },
}));
const now = new Date("2026-10-18T07:30:00Z");
function page({
  active = true,
  interviewsEnabled = true,
  locale = "en",
  timeZone = "Asia/Shanghai",
  instant = now,
} = {}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone={timeZone}
    >
      <TutorUpcoming
        active={active}
        interviewsEnabled={interviewsEnabled}
        now={instant}
      />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  state.pairings = [
    {
      id: "p",
      subject: "Synthetic Mathematics",
      scheduleConfirmed: true,
      dayOfWeek: 7,
      startMin: 900,
      endMin: 960,
      room: null,
      tutees: [{}],
    },
  ];
  state.interviews = [
    {
      id: "i",
      name: "Synthetic Applicant",
      status: "INTERVIEW",
      isInvalid: false,
      interviewAt: new Date("2026-10-18T08:00:00Z"),
    },
  ];
  state.pairingsError = null;
  state.interviewsError = null;
  state.missing = false;
  vi.clearAllMocks();
  state.refreshPairings.mockImplementation(async () => {
    if (state.pairingsError)
      throw Object.assign(
        new Error("Pairings read failed"),
        state.pairingsError,
      );
    return { data: state.pairings };
  });
  state.refreshInterviews.mockImplementation(async () => {
    if (state.interviewsError)
      throw Object.assign(
        new Error("Interviews read failed"),
        state.interviewsError,
      );
    return { data: state.interviews };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(["en", "zh"])(
  "renders authorized plans, local times and keyboard links in %s without writes",
  (locale) => {
    render(page({ locale }));
    expect(screen.getByText("Synthetic Applicant")).toBeTruthy();
    expect(screen.getByText("Synthetic Mathematics")).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#tutor-pairings",
      "#tutor-interviews",
    ]);
    links[1]!.focus();
    expect(document.activeElement).toBe(links[1]);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(
      document.querySelector('time[datetime="2026-10-18T08:00:00.000Z"]')
        ?.textContent,
    ).toContain(locale === "en" ? "04:00 PM" : "16:00");
  },
);
it.each(["pairings", "interviews"])(
  "conceals both cached sources after %s denial until both freshly recover",
  async (source) => {
    const view = render(page());
    if (source === "pairings")
      state.pairingsError = { data: { code: "UNAUTHORIZED" } };
    else state.interviewsError = { data: { code: "FORBIDDEN" } };
    view.rerender(page());
    expect(screen.queryByText("Synthetic Applicant")).toBeNull();
    expect(screen.queryByText("Synthetic Mathematics")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    // A later automatic success or transport error must not release the boundary.
    state.pairingsError = null;
    state.interviewsError = {};
    view.rerender(page());
    fireEvent.click(
      screen.getByRole("button", {
        name: "Refresh Tutoring sessions / Interviews",
      }),
    );
    await waitFor(() => expect(state.refreshInterviews).toHaveBeenCalledOnce());
    expect(state.refreshPairings).toHaveBeenCalledOnce();
    expect(screen.queryByText("Synthetic Mathematics")).toBeNull();
    state.interviewsError = null;
    view.rerender(page());
    expect(screen.queryByText("Synthetic Applicant")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: /Refresh Tutoring sessions/,
        }).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Refresh Tutoring sessions / Interviews",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("Synthetic Applicant")).toBeTruthy(),
    );
    expect(state.refreshPairings).toHaveBeenCalledTimes(2);
    expect(state.refreshInterviews).toHaveBeenCalledTimes(2);
  },
);
it("keeps useful transient-error evidence with an explicit stale warning and updates on panel removal", () => {
  state.interviewsError = {};
  const view = render(page());
  expect(screen.getByText("Synthetic Applicant")).toBeTruthy();
  expect(screen.getByText(/Could not refresh Interviews/)).toBeTruthy();
  state.interviews = [];
  state.interviewsError = null;
  view.rerender(page());
  expect(screen.queryByText("Synthetic Applicant")).toBeNull();
});
it("holds the shared denial boundary through all pending reads and guards duplicate recovery", async () => {
  state.pairingsError = { data: { code: "FORBIDDEN" } };
  const view = render(page());
  state.pairingsError = null;
  view.rerender(page());
  let finish!: (value: { data: unknown[] }) => void;
  state.refreshInterviews.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Refresh Tutoring sessions / Interviews",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(state.refreshPairings).toHaveBeenCalledOnce());
  expect(state.refreshInterviews).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(true);
  expect(screen.queryByText("Synthetic Mathematics")).toBeNull();
  await act(async () => {
    finish({ data: state.interviews });
  });
  expect(screen.getByText("Synthetic Mathematics")).toBeTruthy();
});
it("recovers only the enabled source when interviews are disabled", async () => {
  state.pairingsError = { data: { code: "FORBIDDEN" } };
  state.interviewsError = { data: { code: "FORBIDDEN" } };
  const view = render(page({ interviewsEnabled: false }));
  state.pairingsError = null;
  view.rerender(page({ interviewsEnabled: false }));
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh Tutoring sessions" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Synthetic Mathematics")).toBeTruthy(),
  );
  expect(state.refreshInterviews).not.toHaveBeenCalled();
});
it("does not claim an empty schedule when a source is still unavailable", () => {
  state.missing = true;
  render(page());
  expect(screen.queryByText(en.tutorUpcoming.empty)).toBeNull();
  expect(screen.getByText("Loading Tutoring sessions…")).toBeTruthy();
});
it("does not claim an empty schedule when a confirmed recurrence needs DST time review", () => {
  state.pairings = [
    {
      id: "dst",
      subject: "Synthetic DST block",
      scheduleConfirmed: true,
      dayOfWeek: 7,
      startMin: 90,
      endMin: 150,
      room: null,
      tutees: [{}],
    },
  ];
  state.interviews = [];
  render(
    page({
      timeZone: "America/New_York",
      instant: new Date("2026-11-01T04:00:00Z"),
    }),
  );
  expect(screen.getByText(/recurring block needs time review/)).toBeTruthy();
  expect(screen.queryByText(en.tutorUpcoming.empty)).toBeNull();
});
it("disables inactive and feature-restricted interview reads and suppresses cached events", () => {
  const view = render(page({ interviewsEnabled: false }));
  expect(screen.queryByText("Synthetic Applicant")).toBeNull();
  expect(state.options).toHaveBeenCalledWith("interviews", {
    enabled: false,
    refetchInterval: false,
  });
  view.rerender(page({ active: false }));
  expect(screen.queryByText("Synthetic Mathematics")).toBeNull();
  expect(state.options).toHaveBeenCalledWith("pairings", {
    enabled: false,
    refetchInterval: false,
  });
});

it("expires ongoing sessions on its clock tick and cleans up the clock on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T07:59:50Z"));
  const view = render(page());
  expect(screen.getByText("Synthetic Mathematics")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(screen.queryByText("Synthetic Mathematics")).toBeNull();
  expect(screen.queryByText("Synthetic Applicant")).toBeNull();
  expect(screen.getByText(en.tutorUpcoming.empty)).toBeTruthy();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("recomputes the seven-date horizon on focus and across program-local midnight", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T15:59:45Z"));
  state.interviews = [
    {
      id: "last-next-week",
      name: "New seventh date",
      status: "PENDING",
      isInvalid: false,
      interviewAt: new Date("2026-10-24T16:05:00Z"),
    },
  ];
  render(page());
  expect(screen.queryByText("New seventh date")).toBeNull();
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(screen.queryByText("New seventh date")).toBeNull();
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(screen.getByText("New seventh date")).toBeTruthy();
});

it("activates the workflow link and transfers focus to the existing authorized section", () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("scrollBy", vi.fn());
  // Browser scrolling itself is covered by the live capture; jsdom only models focus.
  const target = document.createElement("section");
  target.id = "tutor-interviews";
  target.tabIndex = -1;
  target.scrollIntoView = vi.fn();
  document.body.append(target);
  render(page());
  const link = screen.getByRole("link", {
    name: "View workflow for Synthetic Applicant",
  });
  link.focus();
  fireEvent.click(link);
  expect(document.activeElement).toBe(target);
  target.remove();
});
