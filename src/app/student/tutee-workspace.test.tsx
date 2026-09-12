// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TuteeOverview } from "./tutee-overview";
import { TuteeNavigation } from "./navigation";
import { StudentPortal } from "~/app/_components/student-portal";
const mocks = vi.hoisted(() => ({
  personal: vi.fn(),
  requests: vi.fn(),
  view: "dashboard",
  settings: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ view: mocks.view }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Sep 13" }),
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ promptText: vi.fn(), dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    student: {
      me: { useQuery: mocks.personal },
      feedbackSettings: { useQuery: mocks.settings },
      appeal: { useMutation: () => ({ mutate: vi.fn() }) },
      feedback: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    studentWorkflow: { mine: { useQuery: mocks.requests } },
  },
}));
beforeEach(() => {
  mocks.view = "dashboard";
  mocks.personal.mockReturnValue({
    data: {
      user: { name: "Sam" },
      schedule: [],
      sessions: [],
      cards: [],
      appeals: [],
    },
  });
  mocks.requests.mockReturnValue({ data: [] });
  mocks.settings.mockReturnValue({ data: false });
});
afterEach(cleanup);
it("offers the existing form and account routes without requiring an enrollment", () => {
  render(<TuteeOverview />);
  expect(
    screen.getByRole("link", { name: "requestTutor" }).getAttribute("href"),
  ).toBe("/signup");
  expect(screen.getByText("formHelp")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: /account accountHelp/ })
      .getAttribute("href"),
  ).toBe("/student?view=account");
});
it("links to focused views with a single active navigation item and handles unknown deep links", () => {
  mocks.view = "attendance";
  const { rerender } = render(<TuteeNavigation />);
  expect(
    screen
      .getByRole("link", { name: "attendance" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    screen.getByRole("link", { name: "messages" }).getAttribute("href"),
  ).toBe("/student?view=messages");
  mocks.view = "not-a-view";
  rerender(<TuteeNavigation />);
  expect(
    screen
      .getByRole("link", { name: "dashboard" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
it.each(["messages", "account"])(
  "keeps the %s tab in the tutee workspace",
  (view) => {
    mocks.view = view;
    render(<TuteeNavigation />);
    const tab = screen.getByRole("link", { name: view });
    expect(tab.getAttribute("href")).toBe(`/student?view=${view}`);
    expect(tab.getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(
      document.querySelector('a[href="/my-account"], a[href="/messages"]'),
    ).toBeNull();
  },
);
it("keeps unavailable data distinct from a genuine empty overview", () => {
  mocks.personal.mockReturnValue({
    error: { message: "Connection interrupted" },
  });
  render(<TuteeOverview />);
  expect(screen.getByRole("alert").textContent).toBe("Connection interrupted");
  expect(screen.getByText("—")).toBeTruthy();
});
it("shows schedules without unrelated attendance, disciplinary records or paging controls", () => {
  mocks.personal.mockReturnValue({
    data: {
      schedule: [
        {
          id: "pair-1",
          subject: "Math",
          tutor: { englishName: "Tutor A" },
          dayOfWeek: 1,
          startMin: 930,
          endMin: 990,
          room: null,
        },
      ],
      sessions: [],
      cards: [],
      appeals: [],
    },
  });
  render(<StudentPortal view="schedule" />);
  expect(screen.getByText("Math · Tutor A")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "attendance" })).toBeNull();
  expect(screen.queryByRole("button", { name: "next" })).toBeNull();
});
it("attendance pagination is not enabled by unrelated disciplinary history", () => {
  mocks.personal.mockReturnValue({
    data: {
      schedule: [],
      sessions: [],
      cards: Array.from({ length: 20 }, () => ({ id: "hidden-card" })),
      appeals: [],
    },
  });
  render(<StudentPortal view="attendance" />);
  expect(
    screen.getByRole("button", { name: "next" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByRole("heading", { name: "cards" })).toBeNull();
});
it("support paging is independent of a full attendance page", () => {
  mocks.personal.mockReturnValue({
    data: {
      schedule: [],
      sessions: Array.from({ length: 20 }, () => ({})),
      cards: [],
      appeals: [],
    },
  });
  render(<StudentPortal view="support" />);
  expect(
    screen.getByRole("button", { name: "next" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByRole("heading", { name: "appeals" })).toBeTruthy();
});
it("a full attendance page can move forward while retaining the selected section", () => {
  mocks.personal.mockReturnValue({
    data: {
      schedule: [],
      sessions: Array.from({ length: 20 }, (_, i) => ({
        session: {
          id: String(i),
          date: new Date(),
          pairing: { subject: "Math" },
        },
        status: "PRESENT",
        feedback: null,
      })),
      cards: [],
      appeals: [],
    },
  });
  render(<StudentPortal view="attendance" />);
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  expect(mocks.personal).toHaveBeenLastCalledWith({ page: 1 });
  expect(screen.queryByRole("heading", { name: "cards" })).toBeNull();
});
