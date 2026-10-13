// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  SignupAppealReview,
  SignupAssignmentRelease,
  StudentRequestBoard,
} from "./student-request-board";
const mocks = vi.hoisted(() => ({
  unassign: vi.fn(),
  appeal: vi.fn(),
  refresh: vi.fn(),
}));
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey } from "~/lib/session-view-state";
const query = vi.hoisted(() => ({ ready: true }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
  useFormatter: () => ({ dateTime: () => "date" }),
}));
vi.mock("~/app/_components/timed-action-dialog", () => ({
  TimedActionDialog: ({
    action,
    target,
    onConfirm,
    onCancel,
  }: {
    action: string;
    target: string;
    onConfirm: (ticket: string) => void;
    onCancel: () => void;
  }) => (
    <div role="dialog" data-action={action} data-target={target}>
      <button onClick={() => onConfirm("fresh-ticket")}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: { adminRequests: { invalidate: mocks.refresh } },
      admin: {
        tutees: { invalidate: mocks.refresh },
        pairings: { invalidate: mocks.refresh },
      },
    }),
    account: { me: { useQuery: () => ({ data: { role: "HEAD" } }) } },
    studentWorkflow: {
      headUnassign: { useMutation: () => ({ mutateAsync: mocks.unassign }) },
      resolveSignupAppeal: {
        useMutation: () => ({ mutateAsync: mocks.appeal }),
      },
      adminRequests: {
        useQuery: () => ({
          data: query.ready ? [] : undefined,
          isLoading: !query.ready,
        }),
      },
      legacyReviews: {
        useQuery: () => ({ data: query.ready ? [] : undefined }),
      },
    },
    admin: { tutors: { useQuery: () => ({ data: [] }) } },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.unassign.mockResolvedValue({ ok: true, version: 3 });
  mocks.appeal.mockResolvedValue({ ok: true });
  mocks.refresh.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  query.ready = true;
  sessionStorage.clear();
});

const actionRow = {
  id: "survey",
  name: "Applicant",
  username: null,
  currentVersion: 2,
  invalidityVersion: 4,
  appeal: {
    id: "appeal-record",
    reason: "My request is genuine",
    state: "PENDING",
  },
  pairings: [{ id: "pairing", subject: "Mathematics" }],
} as unknown as Parameters<typeof SignupAppealReview>[0]["row"];
it("captures assignment version when review opens instead of adopting background rows", async () => {
  const mounted = render(
    <SignupAssignmentRelease
      row={actionRow}
      pairing={actionRow.pairings[0]!}
      proposal={false}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "unassign · Mathematics" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("data-target")).toBe("survey:pairing");
  mounted.rerender(
    <SignupAssignmentRelease
      row={{ ...actionRow, currentVersion: 9 }}
      pairing={{ ...actionRow.pairings[0]!, id: "replacement-pairing" }}
      proposal={false}
    />,
  );
  expect(screen.getByRole("dialog").getAttribute("data-target")).toBe(
    "survey:pairing",
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(mocks.unassign).toHaveBeenCalledOnce());
  expect(mocks.unassign.mock.calls[0]?.[0]).toMatchObject({
    id: "survey",
    pairingId: "pairing",
    expectedVersion: 2,
    signedTicket: "fresh-ticket",
  });
});
it("binds appeal consequences to appeal id and captured invalidity version; accepted refresh retries never repeat the decision", async () => {
  mocks.refresh.mockRejectedValue(new Error("Offline"));
  render(<SignupAppealReview row={actionRow} />);
  fireEvent.click(screen.getByRole("button", { name: "reject" }));
  expect(screen.getByRole("dialog").getAttribute("data-target")).toBe(
    "appeal-record:false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await screen.findByText("savedRefresh");
  expect(mocks.appeal.mock.calls[0]?.[0]).toMatchObject({
    id: "appeal-record",
    approve: false,
    expectedInvalidityVersion: 4,
    signedTicket: "fresh-ticket",
  });
  mocks.refresh.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "retryRefresh" }));
  await waitFor(() => expect(screen.queryByText("savedRefresh")).toBeNull());
  expect(mocks.appeal).toHaveBeenCalledOnce();
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

it("honors an early Assigned click through delayed queue reads and restores only the view", () => {
  query.ready = false;
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
  query.ready = true;
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
