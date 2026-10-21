// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";
import ApplicationsPage from "./page";
import Link from "next/link";
import type { ComponentProps } from "react";
import { navigateNotificationFragment } from "~/lib/notification-navigation";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
// Exercise Link's documented SPA-only callback without booting Next's router.
vi.mock("next/link", () => ({
  default: ({
    href,
    onNavigate,
    scroll: _scroll,
    ...props
  }: ComponentProps<typeof Link>) => (
    <a
      {...props}
      href={typeof href === "string" ? href : (href.pathname ?? "")}
      onClick={(event) => {
        props.onClick?.(event);
        if (
          !event.defaultPrevented &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        )
          onNavigate?.({ preventDefault: () => event.preventDefault() });
      }}
    />
  ),
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/app/_components/email-details", () => ({
  EmailDetails: () => null,
}));
vi.mock("~/app/_components/interview-management", () => ({
  InterviewManagement: () => (
    <>
      <p>Interview history</p>
      <Link
        href="/admin/applications#application-a"
        scroll={false}
        onNavigate={(event) =>
          navigateNotificationFragment(
            "/admin/applications#application-a",
            event,
          )
        }
      >
        Manage Alex panel
      </Link>
    </>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    account: { me: { useQuery: () => ({ data: { role: "HEAD" } }) } },
    program: {
      features: { useQuery: () => ({ data: { INTERVIEWS: false } }) },
    },
    admin: {
      tutorApplications: { useQuery: mocks.query },
      tutors: { useQuery: () => ({ data: [] }) },
      setApplicationStatus: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteApplication: { useMutation: () => ({ mutate: vi.fn() }) },
      setApplicationInvalidity: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
  },
}));
const applications = [
  {
    id: "a",
    name: "Alex Chen",
    email: "alex@example.test",
    status: "PENDING",
    type: "INITIAL",
    subjectIds: ["math", "physics"],
  },
  {
    id: "b",
    name: "Bea Lin",
    email: "bea@example.test",
    status: "ACCEPTED",
    type: "ADDITIONAL_SUBJECT",
    subjectIds: ["math"],
  },
  {
    id: "c",
    name: "Cai Wu",
    email: "cai@example.test",
    status: "PENDING",
    type: "HIGHER_LEVEL",
    subjectIds: ["advanced-math"],
  },
].map(({ subjectIds, ...app }) => ({
  ...app,
  requestedTutorId: null,
  qualificationReason: null,
  qualificationSnapshot: null,
  preferredContact: null,
  updatedAt: new Date("2026-09-01"),
  createdAt: new Date(
    app.id === "a"
      ? "2026-09-03"
      : app.id === "b"
        ? "2026-09-01"
        : "2026-09-02",
  ),
  interviewCompletedAt:
    app.id === "a"
      ? new Date("2026-10-02T08:00:00Z")
      : app.id === "c"
        ? new Date("2026-10-01T08:00:00Z")
        : null,
  interviewAt: null,
  interviewers: [],
  votes: [],
  decisionComment: null,
  decidedByTutor: null,
  subjectIntents: subjectIds.map((subjectId) => ({
    subjectId,
    taken: false,
    grade: null,
    hasApScore: false,
    apScore: null,
    selfStudied: false,
    selfStudyNote: null,
    subject: {
      name: subjectId === "physics" ? "Physics" : "Math",
      level: { name: subjectId === "advanced-math" ? "AP" : "Standard" },
    },
  })),
}));
const show = () =>
  render(
    <SessionViewProvider
      identity="head"
      pathname="/admin/applications"
      verified
    >
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <ApplicationsPage />
      </NextIntlClientProvider>
    </SessionViewProvider>,
  );
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => {
  window.sessionStorage.clear();
  mocks.query.mockReturnValue({ data: applications });
  window.history.replaceState(null, "", "/");
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

// Inspect actual keyed cards, so a comparator alone cannot satisfy page ordering.
const renderedIds = () =>
  Array.from(document.querySelectorAll('[id^="application-"]'))
    .map((element) => element.id)
    .filter((id) => !id.startsWith("application-panel-"));

it("sorts the rendered queue and filters recorded completion independently of acceptance", () => {
  show();
  expect(renderedIds()).toEqual([
    "application-a",
    "application-b",
    "application-c",
  ]);
  change("Sort by", "CREATED_ASC");
  expect(renderedIds()).toEqual([
    "application-b",
    "application-c",
    "application-a",
  ]);
  change("Interview completion", "COMPLETED");
  change("Sort by", "COMPLETED_DESC");
  expect(renderedIds()).toEqual(["application-a", "application-c"]);
  expect(screen.getByText("2 of 3 applications")).toBeTruthy();
  expect(screen.getAllByText(/Interview completed:/)).toHaveLength(2);
  change("Application status", "ACCEPTED");
  expect(renderedIds()).toEqual([]);
  change("Interview completion", "NOT_COMPLETED");
  expect(renderedIds()).toEqual(["application-b"]);
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(renderedIds()).toEqual([
    "application-a",
    "application-b",
    "application-c",
  ]);
  change("Sort by", "NAME_DESC");
  expect(renderedIds()).toEqual([
    "application-c",
    "application-b",
    "application-a",
  ]);
});

it("remembers new completion and sorting choices across remounts", () => {
  const page = show();
  change("Interview completion", "COMPLETED");
  change("Sort by", "COMPLETED_ASC");
  page.unmount();
  show();
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Interview completion",
    }).value,
  ).toBe("COMPLETED");
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Sort by" }).value,
  ).toBe("COMPLETED_ASC");
  expect(renderedIds()).toEqual(["application-c", "application-a"]);
});

it("rejects unsupported stored completion and sorting values", () => {
  const key = viewStateKey(
    "head",
    "/admin/applications",
    "applications.filters.v1",
    "",
  );
  writeViewState(window.sessionStorage, key, {
    search: "",
    status: "",
    type: "",
    subjectId: "",
    completion: "ACCEPTED",
    sort: "UPDATED_DESC",
  });
  show();
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Interview completion",
    }).value,
  ).toBe("");
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Sort by" }).value,
  ).toBe("");
  expect(renderedIds()).toEqual([
    "application-a",
    "application-b",
    "application-c",
  ]);
});

it("focuses the revealed application after filters commit rather than consuming a pre-commit frame", () => {
  window.history.replaceState(null, "", "/admin/applications");
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const page = show();
  change("Name or email", "Bea");
  expect(screen.queryByText("Alex Chen")).toBeNull();
  change("Interview completion", "NOT_COMPLETED");
  change("Sort by", "NAME_DESC");
  act(() => {
    window.history.replaceState(null, "", "/admin/applications#application-a");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    for (const frame of frames.splice(0)) frame(0);
  });
  const target = document.getElementById("application-a");
  expect(target).not.toBeNull();
  expect(document.activeElement).toBe(target);
  expect(scroll).toHaveBeenCalledWith({ block: "center" });
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Interview completion",
    }).value,
  ).toBe("");
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Sort by" }).value,
  ).toBe("");
  page.unmount();
  vi.restoreAllMocks();
});

it("restores the authorized queue filters after slow choices, lets an application hash reveal its target, and clears denial", () => {
  const key = viewStateKey(
    "head",
    "/admin/applications",
    "applications.filters.v1",
    "",
  );
  writeViewState(window.sessionStorage, key, {
    search: "Bea",
    status: "ACCEPTED",
    type: "ADDITIONAL_SUBJECT",
    subjectId: "math",
  });
  const tree = () => (
    <SessionViewProvider
      identity="head"
      pathname="/admin/applications"
      verified
    >
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <ApplicationsPage />
      </NextIntlClientProvider>
    </SessionViewProvider>
  );
  mocks.query.mockReturnValue({ data: undefined, isLoading: true });
  const page = render(tree());
  expect(window.sessionStorage.getItem(key)).toContain("Bea");
  mocks.query.mockReturnValue({ data: applications });
  page.rerender(tree());
  expect(screen.getByText("Bea Lin")).toBeTruthy();
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Interview completion",
    }).value,
  ).toBe("");
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Sort by" }).value,
  ).toBe("");
  expect(screen.queryByText("Alex Chen")).toBeNull();
  act(() => {
    window.history.replaceState(null, "", "/#application-a");
    window.dispatchEvent(new Event("hashchange"));
  });
  expect(screen.getByText("Alex Chen")).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
  mocks.query.mockReturnValue({
    data: applications,
    error: { message: "Denied", data: { code: "FORBIDDEN" } },
  });
  page.rerender(tree());
  expect(screen.queryByText("Alex Chen")).toBeNull();
  expect(window.sessionStorage.getItem(key)).toBeNull();
});

it("combines search, status, type and subjects and resets the full list", () => {
  show();
  change("Name or email", " ALEX@EXAMPLE ");
  change("Application status", "PENDING");
  change("Request type", "INITIAL");
  change("Requested subject", "physics");
  expect(screen.getByText("1 of 3 applications")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Alex Chen/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Bea Lin/ })).toBeNull();
  // Options always come from the full queue, including the separate same-named level.
  expect(screen.getByRole("option", { name: "Math · AP" })).toBeTruthy();
  change("Requested subject", "advanced-math");
  expect(
    screen.getByText(en.admin.applications.filters.noMatches),
  ).toBeTruthy();
  expect(screen.getByText("Interview history")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByText("3 of 3 applications")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Cai Wu/ })).toBeTruthy();
});
it("defaults to active validity while retaining ordinary accepted and rejected workflow states", () => {
  mocks.query.mockReturnValue({
    data: applications.map((app) => ({
      ...app,
      isInvalid: app.id === "a",
      status: app.id === "c" ? "REJECTED" : app.status,
    })),
  });
  show();
  expect(
    screen.getByRole("button", { name: "Active entries", pressed: true }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Alex Chen/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Bea Lin/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Cai Wu/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All entries" }));
  expect(screen.getByRole("button", { name: /Alex Chen/ })).toBeTruthy();
});
it("filters invalid entries independently of the original application status", () => {
  mocks.query.mockReturnValue({
    data: applications.map((app) => ({ ...app, isInvalid: app.id === "a" })),
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  expect(screen.getByText("1 of 3 applications")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Alex Chen/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Bea Lin/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  change("Application status", "ACCEPTED");
  expect(
    screen.getByText(en.admin.applications.filters.noMatches),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Active entries" }));
  expect(screen.getByRole("button", { name: /Bea Lin/ })).toBeTruthy();
});
it("reveals the direct application link after a filter hid the destination", () => {
  show();
  change("Name or email", "Cai");
  act(() => {
    window.location.hash = "#application-a";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(
    screen
      .getByRole("button", { name: /Alex Chen/ })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(screen.getByText("3 of 3 applications")).toBeTruthy();
});

it("resets filters when the history link repeats the current hash", () => {
  window.history.replaceState(null, "", "/admin/applications#application-a");
  show();
  change("Name or email", "Cai");
  fireEvent.click(screen.getByRole("link", { name: "Manage Alex panel" }));
  expect(
    screen
      .getByRole("button", { name: /Alex Chen/ })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(screen.getByText("3 of 3 applications")).toBeTruthy();
});

it("reveals and focuses a filtered-out history destination after the fragment commits, then reopens a collapsed same-hash target", () => {
  window.history.replaceState({ __NA: true }, "", "/admin/applications");
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  show();
  change("Application status", "ACCEPTED");
  expect(document.getElementById("application-a")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Manage Alex panel" }));
  act(() => {
    for (const frame of frames.splice(0)) frame(0);
  });
  expect(window.location.hash).toBe("#application-a");
  expect(window.history.state).toEqual({ __NA: true });
  expect(
    screen
      .getByRole("button", { name: /Alex Chen/ })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(document.activeElement).toBe(document.getElementById("application-a"));
  fireEvent.click(screen.getByRole("button", { name: /Alex Chen/ }));
  expect(
    screen
      .getByRole("button", { name: /Alex Chen/ })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("link", { name: "Manage Alex panel" }));
  act(() => {
    for (const frame of frames.splice(0)) frame(0);
  });
  expect(
    screen
      .getByRole("button", { name: /Alex Chen/ })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  vi.restoreAllMocks();
});
it("reveals the same notification fragment again after later filtering", async () => {
  window.history.replaceState(null, "", "/#application-a");
  show();
  change("Name or email", "Cai");
  await act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  expect(screen.getByRole("button", { name: /Alex Chen/ })).toBeTruthy();
  expect(
    screen.getByRole<HTMLInputElement>("searchbox", { name: "Name or email" })
      .value,
  ).toBe("");
});
it("distinguishes an empty queue from filtered results, loading and query errors", () => {
  mocks.query.mockReturnValue({ data: [], isLoading: false });
  const view = show();
  expect(screen.getByText(en.admin.applications.empty)).toBeTruthy();
  expect(
    screen.queryByText(en.admin.applications.filters.noMatches),
  ).toBeNull();
  view.unmount();
  mocks.query.mockReturnValue({ isLoading: true });
  const loading = show();
  expect(screen.getByRole("status").textContent).toBe(en.workflows.loading);
  loading.unmount();
  mocks.query.mockReturnValue({ error: new Error("Cannot load queue") });
  show();
  expect(screen.getByRole("alert").textContent).toBe("Cannot load queue");
  expect(screen.queryByText(en.admin.applications.empty)).toBeNull();
});

it("filters recalled qualification requests from the current application lifecycle", () => {
  mocks.query.mockReturnValue({
    data: [
      ...applications,
      {
        ...applications[1],
        id: "recalled",
        name: "Recalled Request",
        status: "RECALLED",
      },
    ],
  });
  show();
  change("Application status", "RECALLED");
  expect(screen.getByText("1 of 4 applications")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Recalled Request/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Alex Chen/ })).toBeNull();
});
