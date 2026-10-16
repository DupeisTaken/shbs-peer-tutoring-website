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
import { StudentRequestBoard } from "./student-request-board";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
const mocks = vi.hoisted(() => ({ legacy: vi.fn(), ready: true }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("~/trpc/react", () => ({
  api: {
    studentWorkflow: {
      adminRequests: {
        useQuery: () => ({
          data: mocks.ready ? [] : undefined,
          isLoading: !mocks.ready,
        }),
      },
      legacyReviews: { useQuery: mocks.legacy },
    },
    admin: { tutors: { useQuery: () => ({ data: [] }) } },
  },
}));
beforeEach(() => {
  mocks.ready = true;
  mocks.legacy.mockReturnValue({ data: [] });
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

it("keeps the newer hash arrival when the old pending target cancels in the same event", () => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  window.history.replaceState(null, "", "/admin/requests#request-signup-A");
  const page = (loading: boolean) => (
    <SessionViewProvider identity="head" pathname="/admin/requests" verified>
      <StudentRequestBoard
        additionalLoading={loading}
        additionalEntries={[
          {
            id: "B",
            group: "assigned",
            submittedAt: new Date(),
            content: <article id="request-signup-B">Newer request</article>,
          },
        ]}
      />
    </SessionViewProvider>
  );
  const view = render(page(true));
  act(() => {
    window.history.replaceState(null, "", "/admin/requests#request-signup-B");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  view.rerender(page(false));
  expect(document.activeElement).toBe(screen.getByText("Newer request"));
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce();
  view.unmount();
  vi.restoreAllMocks();
});

it("reveals and focuses the committed record when an animation frame runs before the requested panel commits", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const scroll = vi.fn();
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  window.history.replaceState(null, "", "/admin/requests");
  const page = render(
    <SessionViewProvider identity="head" pathname="/admin/requests" verified>
      <StudentRequestBoard
        additionalEntries={[
          {
            id: "manual-source_123",
            sourceId: "source_123",
            group: "assigned",
            submittedAt: new Date(),
            content: (
              <article id="request-signup-source_123">Committed record</article>
            ),
          },
        ]}
      />
    </SessionViewProvider>,
  );
  expect(screen.queryByText("Committed record")).toBeNull();
  act(() => {
    window.history.replaceState(
      null,
      "",
      "/admin/requests#request-signup-source_123",
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    // React can defer the filter commit beyond the first frame. That frame
    // must not permanently consume an arrival whose record is not mounted yet.
    for (const frame of frames.splice(0)) frame(0);
  });
  const target = screen.getByText("Committed record");
  expect(scroll).toHaveBeenCalled();
  expect(document.activeElement).toBe(target);
  scroll.mockClear();
  fireEvent.wheel(window);
  page.rerender(
    <SessionViewProvider identity="head" pathname="/admin/requests" verified>
      <StudentRequestBoard additionalEntries={[]} />
    </SessionViewProvider>,
  );
  expect(scroll).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it("moves focus with arrows and Home/End without changing the selected request panel", () => {
  render(<StudentRequestBoard />);
  const matching = screen.getByRole("tab", { name: "matching 0" });
  const assigned = screen.getByRole("tab", { name: "assigned 0" });
  matching.focus();
  fireEvent.keyDown(matching, { key: "ArrowRight" });
  expect(document.activeElement).toBe(assigned);
  expect(matching.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(assigned, { key: "End" });
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "processed 0" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(matching);
  fireEvent.click(assigned);
  expect(assigned.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
    assigned.id,
  );
});

it("manual requests participate in tab counts and disappear when another tab is selected", () => {
  render(
    <StudentRequestBoard
      additionalEntries={[
        {
          id: "pending",
          group: "matching",
          submittedAt: new Date(),
          content: <p>Manual pending student</p>,
        },
        {
          id: "assigned",
          group: "assigned",
          submittedAt: new Date(),
          content: <p>Manual assigned student</p>,
        },
      ]}
    />,
  );
  expect(screen.getByRole("tab", { name: "matching 1" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "assigned 1" })).toBeTruthy();
  expect(screen.getByText("Manual pending student")).toBeTruthy();
  expect(screen.queryByText("emptySection")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "assigned 1" }));
  expect(screen.queryByText("Manual pending student")).toBeNull();
  expect(screen.getByText("Manual assigned student")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "processed 0" }));
  expect(screen.getByText("emptySection")).toBeTruthy();
});

it("does not report an empty queue while another intake source is still loading", () => {
  render(<StudentRequestBoard additionalLoading />);
  expect(screen.getByText("loading")).toBeTruthy();
  expect(screen.queryByText("emptySection")).toBeNull();
});
it("reveals a repeated notification fragment after selecting another request tab", async () => {
  window.history.replaceState(
    null,
    "",
    "/admin/requests#request-signup-source_123",
  );
  const entries = [
    {
      id: "manual-source_123",
      sourceId: "source_123",
      group: "assigned" as const,
      submittedAt: new Date(),
      content: <p>Repeated target</p>,
    },
  ];
  render(
    <SessionViewProvider identity="head" pathname="/admin/requests" verified>
      <StudentRequestBoard additionalEntries={entries} />
    </SessionViewProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "processed 0" }));
  expect(screen.queryByText("Repeated target")).toBeNull();
  await act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  expect(screen.getByText("Repeated target")).toBeTruthy();
  expect(
    screen
      .getByRole("tab", { name: "assigned 1" })
      .getAttribute("aria-selected"),
  ).toBe("true");
});
it("defers an explicit notice reveal until the delayed authorized legacy read completes", async () => {
  const identity = "notice-reviewer",
    pathname = "/admin/requests";
  writeViewState(
    window.sessionStorage,
    viewStateKey(identity, pathname, "requests.tab.v1", ""),
    "processed",
  );
  writeViewState(
    window.sessionStorage,
    viewStateKey(identity, pathname, "requests.invalidity.v1", ""),
    "valid",
  );
  window.history.replaceState(
    null,
    "",
    `${pathname}#request-signup-source_123`,
  );
  mocks.legacy.mockReturnValue({ data: undefined });
  const entries = [
    {
      id: "manual-source_123",
      sourceId: "source_123",
      group: "assigned" as const,
      invalid: true,
      submittedAt: new Date(),
      content: <p>Targeted invalid request</p>,
    },
  ];
  const ui = () => (
    <SessionViewProvider identity={identity} pathname={pathname} verified>
      <StudentRequestBoard additionalEntries={entries} />
    </SessionViewProvider>
  );
  const view = render(ui());
  expect(screen.queryByText("Targeted invalid request")).toBeNull();
  mocks.legacy.mockReturnValue({ data: [] });
  view.rerender(ui());
  await waitFor(() =>
    expect(
      screen
        .getByRole("tab", { name: "assigned 1" })
        .getAttribute("aria-selected"),
    ).toBe("true"),
  );
  expect(screen.getByText("Targeted invalid request")).toBeTruthy();
});

it("honors an early Assigned click through delayed queue reads and restores only the view", () => {
  mocks.ready = false;
  mocks.legacy.mockReturnValue({ data: undefined });
  const key = viewStateKey(
    "head-account",
    "/admin/requests",
    "requests.tab.v1",
    "term-1",
  );
  sessionStorage.setItem(key, JSON.stringify("processed"));
  const page = (ready: boolean, denied = false) => (
    <SessionViewProvider
      identity="head-account"
      pathname="/admin/requests"
      verified
    >
      <StudentRequestBoard
        viewScope="term-1"
        viewDenied={denied}
        additionalLoading={!ready}
        additionalEntries={
          ready
            ? [
                {
                  id: "assigned",
                  group: "assigned",
                  submittedAt: new Date(),
                  content: <p>Assigned intake content</p>,
                },
              ]
            : []
        }
      />
    </SessionViewProvider>
  );
  const view = render(page(false));
  expect(
    screen
      .getByRole("tab", { name: "processed 0" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "assigned 0" }));
  expect(
    screen
      .getByRole("tab", { name: "assigned 0" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByText("loading")).toBeTruthy();
  expect(sessionStorage.getItem(key)).toBe(JSON.stringify("assigned"));
  mocks.ready = true;
  mocks.legacy.mockReturnValue({ data: [] });
  view.rerender(page(true));
  expect(
    screen
      .getByRole("tab", { name: "assigned 1" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByText("Assigned intake content")).toBeTruthy();
  expect(Object.values(sessionStorage).join(" ")).not.toContain(
    "Assigned intake content",
  );
  view.rerender(page(true, true));
  expect(screen.queryByRole("tab")).toBeNull();
  expect(sessionStorage.getItem(key)).toBeNull();
  view.unmount();
  render(page(true));
  expect(
    screen
      .getByRole("tab", { name: "matching 0" })
      .getAttribute("aria-selected"),
  ).toBe("true");
});
