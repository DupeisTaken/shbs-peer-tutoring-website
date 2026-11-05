// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  SignupAssignmentRelease,
  StudentRequestBoard,
} from "./student-request-board";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import RequestsPage from "./page";

const mocks = vi.hoisted(() => ({
  accountId: undefined as string | undefined,
  pathname: "/admin/requests",
  ready: false,
  denied: false,
  period: undefined as { termId: string } | null | undefined,
  periodIsLoading: false,
  unassign: vi.fn(),
  assign: vi.fn(),
  decline: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
  useFormatter: () => ({ dateTime: () => "date" }),
}));
vi.mock("~/app/_components/timed-action-dialog", () => ({
  TimedActionDialog: ({ title }: { title: string }) => (
    <div role="dialog" aria-label={title}>
      Private captured review
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
    account: {
      me: {
        useQuery: () => ({
          data: mocks.accountId
            ? { id: mocks.accountId, role: "HEAD" }
            : undefined,
        }),
      },
    },
    studentWorkflow: {
      headUnassign: { useMutation: () => ({ mutateAsync: mocks.unassign }) },
      adminRequests: {
        useQuery: () => ({
          data: mocks.ready ? [] : undefined,
          isLoading: !mocks.ready,
          isFetching: false,
          isSuccess: mocks.ready && !mocks.denied,
          error: mocks.denied ? { data: { code: "FORBIDDEN" } } : null,
        }),
      },
      legacyReviews: {
        useQuery: () => ({
          data: mocks.ready ? [] : undefined,
          isSuccess: mocks.ready,
        }),
      },
    },
    admin: {
      tutors: { useQuery: () => ({ data: [], isSuccess: true }) },
      declineSignup: { useMutation: () => ({ mutateAsync: mocks.decline }) },
      assignSignup: {
        useMutation: () => ({
          mutateAsync: mocks.assign,
          isPending: false,
          error: null,
        }),
      },
      subjectEligibility: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      subjects: {
        useQuery: () => ({
          data: [
            { id: "math", name: "Mathematics", active: true, level: null },
          ],
          isLoading: false,
          error: null,
        }),
      },
      assignmentWorkloads: {
        useQuery: () => ({
          data: { termId: "term-1", tutors: [] },
          isSuccess: true,
          isLoading: false,
          isFetching: false,
          error: null,
        }),
      },
      tutees: {
        useQuery: () => ({
          data: mocks.ready
            ? [
                {
                  id: "hydration-intake",
                  englishName: "Synthetic delayed intake",
                  signupSource: "STAFF",
                  status: "PENDING",
                  intakeTermId: "term-1",
                  signupSubmittedAt: new Date("2026-10-01"),
                  createdAt: new Date("2026-10-01"),
                  updatedAt: new Date("2026-10-01"),
                  firstChoice: { id: "math", name: "Mathematics" },
                  secondChoice: null,
                  signupDecline: null,
                  gradeLevel: "10",
                  email: null,
                  phone: null,
                  preferredContact: null,
                  user: null,
                  owner: null,
                  availabilities: [],
                  signedRulebook: true,
                  signatureName: "Synthetic delayed intake",
                  isInvalid: false,
                  invalidReason: null,
                  invalidatedAt: null,
                  invalidatedByName: null,
                  invalidityVersion: 0,
                  hasPendingInvalidityAppeal: false,
                  bannedMatch: null,
                },
              ]
            : undefined,
          isLoading: !mocks.ready,
          isSuccess: mocks.ready,
        }),
      },
      pairings: { useQuery: () => ({ data: [], isSuccess: true }) },
      currentPeriod: {
        useQuery: () => ({
          data: mocks.period,
          isLoading: mocks.periodIsLoading,
          isPending: mocks.period === undefined,
          isFetching: mocks.periodIsLoading,
          isSuccess: mocks.period !== undefined,
        }),
      },
    },
  },
}));

const actionRow = {
  id: "synthetic-survey",
  currentVersion: 2,
  pairings: [{ id: "synthetic-pairing", subject: "Mathematics" }],
} as unknown as Parameters<typeof SignupAssignmentRelease>[0]["row"];
function PrivateDraft() {
  const [draft, setDraft] = useState("");
  return (
    <article id="request-signup-private">
      <label>
        Private draft
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <SignupAssignmentRelease
        row={actionRow}
        pairing={actionRow.pairings[0]!}
        proposal={false}
      />
    </article>
  );
}
type PageOptions = {
  identity?: string;
  verified?: boolean;
  scope?: string;
  scopeLoading?: boolean;
  viewDenied?: boolean;
};
function page({
  identity = "server-head",
  verified = true,
  scope = "term-1",
  scopeLoading = false,
  viewDenied = false,
}: PageOptions = {}) {
  return (
    // The production query provider is keyed by this server-owned identity.
    <SessionViewProvider
      key={identity}
      identity={identity}
      pathname={mocks.pathname}
      verified={verified}
    >
      <StudentRequestBoard
        viewScope={scope}
        viewScopeLoading={scopeLoading}
        viewDenied={viewDenied}
        additionalLoading={!mocks.ready}
        additionalEntries={
          mocks.ready
            ? [
                {
                  id: "private",
                  group: "processed",
                  submittedAt: new Date("2026-10-01"),
                  content: <PrivateDraft />,
                },
                {
                  id: "notice",
                  group: "assigned",
                  submittedAt: new Date("2026-10-02"),
                  content: (
                    <article id="request-signup-notice">
                      Assigned notification record
                    </article>
                  ),
                },
              ]
            : []
        }
      />
    </SessionViewProvider>
  );
}
const choose = (tab: string) =>
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${tab} `) }));
const selected = () =>
  screen
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true")!.textContent;
const tabKey = (scope = "term-1", identity = "server-head") =>
  viewStateKey(identity, "/admin/requests", "requests.tab.v1", scope);
const pending: PageOptions = {
  verified: false,
  scope: "no-active-period",
  scopeLoading: true,
};
function ActualRequestsPage() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <SessionViewProvider
        identity="server-head"
        pathname="/admin/requests"
        verified
      >
        <RequestsPage />
      </SessionViewProvider>
    </QueryClientProvider>
  );
}
const actualPage = () => <ActualRequestsPage />;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountId = undefined;
  mocks.pathname = "/admin/requests";
  mocks.ready = false;
  mocks.denied = false;
  mocks.period = undefined;
  mocks.periodIsLoading = false;
  mocks.refresh.mockResolvedValue(undefined);
  mocks.assign.mockResolvedValue({ ok: true, fulfilled: false });
  mocks.decline.mockResolvedValue({ ok: true });
  sessionStorage.clear();
  window.history.replaceState(null, "", "/admin/requests");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["account first", "period first", "together"] as const)(
  "keeps the actual page's Closed click when the initial period query is pending but idle: %s",
  (order) => {
    // A saved Closed view can hide a reset. Both scopes deliberately remember
    // Needs matching, so only this page opening's explicit click can win.
    writeViewState(sessionStorage, tabKey("no-active-period"), "matching");
    writeViewState(sessionStorage, tabKey(), "matching");
    const view = render(actualPage());
    choose("processed");
    expect(selected()).toBe("processed 0");
    mocks.periodIsLoading = true;
    view.rerender(actualPage());
    if (order === "account first") mocks.accountId = "head";
    else if (order === "period first") {
      mocks.period = { termId: "term-1" };
      mocks.periodIsLoading = false;
    }
    view.rerender(actualPage());
    mocks.accountId = "head";
    mocks.period = { termId: "term-1" };
    mocks.periodIsLoading = false;
    mocks.ready = true;
    view.rerender(actualPage());
    expect(screen.getByRole("tab", { name: "matching 1" })).toBeTruthy();
    expect(selected()).toBe("processed 0");
    expect(sessionStorage.getItem(tabKey())).toBe(JSON.stringify("processed"));
  },
);

it("treats an actual null period response as resolved and keeps the initial Closed click", () => {
  writeViewState(sessionStorage, tabKey("no-active-period"), "matching");
  const view = render(actualPage());
  choose("processed");
  mocks.accountId = "head";
  mocks.ready = true;
  mocks.period = null;
  view.rerender(actualPage());
  expect(selected()).toBe("processed 0");
  expect(screen.getByText("admin.requests.noTerm")).toBeTruthy();
  expect(screen.queryByText("loading")).toBeNull();
});

it("resets an actual resolved no-period view when a later active period arrives", () => {
  mocks.accountId = "head";
  mocks.ready = true;
  mocks.period = null;
  const view = render(actualPage());
  choose("processed");
  mocks.period = { termId: "term-1" };
  view.rerender(actualPage());
  expect(selected()).toBe("matching 1");
  expect(screen.getByText(/Synthetic delayed intake/)).toBeTruthy();
  expect(screen.queryByText("admin.requests.noTerm")).toBeNull();
  expect(mocks.assign).not.toHaveBeenCalled();
  expect(mocks.decline).not.toHaveBeenCalled();
});

it.each(["assigned", "processed"] as const)(
  "keeps an early %s click through the first account read without browser storage",
  (tab) => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const view = render(page());
    choose(tab);
    expect(selected()).toBe(`${tab} 0`);
    mocks.accountId = "head";
    mocks.ready = true;
    view.rerender(page());
    expect(selected()).toBe(`${tab} 1`);
  },
);

it.each(["account first", "period first", "together"] as const)(
  "keeps an explicit Closed choice through initial account and active-period hydration: %s",
  (order) => {
    writeViewState(sessionStorage, tabKey(), "assigned");
    const view = render(page(pending));
    choose("processed");
    if (order === "account first") {
      mocks.accountId = "head";
      view.rerender(page(pending));
    } else if (order === "period first") {
      view.rerender(page({ verified: false }));
    }
    expect(selected()).toBe("processed 0");
    mocks.accountId = "head";
    mocks.ready = true;
    view.rerender(page({ verified: false }));
    expect(selected()).toBe("processed 1");
    // Neither private content nor the unverified choice is written to storage.
    expect(sessionStorage.getItem(tabKey())).toBe(JSON.stringify("assigned"));
    view.rerender(page());
    expect(selected()).toBe("processed 1");
    expect(sessionStorage.getItem(tabKey())).toBe(JSON.stringify("processed"));
    expect(Object.values(sessionStorage).join(" ")).not.toContain(
      "Private draft",
    );
  },
);

it("keeps an early choice when the first period read confirms no active period", () => {
  const view = render(page(pending));
  choose("processed");
  mocks.accountId = "head";
  mocks.ready = true;
  view.rerender(page({ scope: "no-active-period" }));
  expect(selected()).toBe("processed 1");
});

it("restores the resolved period's saved view without carrying a provisional remembered view", () => {
  writeViewState(sessionStorage, tabKey("no-active-period"), "processed");
  writeViewState(sessionStorage, tabKey(), "assigned");
  const view = render(page({ scope: "no-active-period", scopeLoading: true }));
  expect(selected()).toBe("processed 0");
  mocks.accountId = "head";
  mocks.ready = true;
  view.rerender(page());
  expect(selected()).toBe("assigned 1");
});

it("retains Needs matching when loading completes without an explicit or remembered choice", () => {
  const view = render(page(pending));
  mocks.accountId = "head";
  mocks.ready = true;
  view.rerender(page());
  expect(selected()).toBe("matching 0");
});

it("retains private drafts and captured reviews for a refetch of the same account", () => {
  mocks.accountId = "head";
  mocks.ready = true;
  const view = render(page());
  choose("processed");
  fireEvent.change(screen.getByLabelText("Private draft"), {
    target: { value: "Synthetic retained draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "unassign" }));
  view.rerender(page());
  expect(screen.getByLabelText<HTMLInputElement>("Private draft").value).toBe(
    "Synthetic retained draft",
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(mocks.unassign).not.toHaveBeenCalled();
});

it.each(["another account", "account disappears"] as const)(
  "disposes private drafts and captured reviews when %s",
  (change) => {
    mocks.accountId = "head";
    mocks.ready = true;
    const view = render(page());
    choose("processed");
    fireEvent.change(screen.getByLabelText("Private draft"), {
      target: { value: "Synthetic old-account draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "unassign" }));
    mocks.accountId = change === "another account" ? "other-head" : undefined;
    view.rerender(page());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Private draft").value).toBe(
      "",
    );
    mocks.accountId = "head";
    view.rerender(page());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Private draft").value).toBe(
      "",
    );
  },
);

it.each(["account", "route", "denial"] as const)(
  "drops initial-period manual provenance on an intervening %s boundary",
  (boundary) => {
    const view = render(page(pending));
    choose("processed");
    if (boundary === "account")
      view.rerender(page({ ...pending, identity: "server-other" }));
    else if (boundary === "route") {
      mocks.pathname = "/admin/other";
      window.history.replaceState(null, "", mocks.pathname);
      view.rerender(page(pending));
    } else view.rerender(page({ ...pending, viewDenied: true }));
    mocks.accountId = "head";
    mocks.ready = true;
    view.rerender(
      page({
        verified: false,
        identity: boundary === "account" ? "server-other" : "server-head",
      }),
    );
    expect(selected()).toBe("matching 0");
  },
);

it("drops the initial handoff at later real period changes and does not revive it on return", () => {
  const view = render(page(pending));
  choose("processed");
  mocks.accountId = "head";
  mocks.ready = true;
  view.rerender(page({ verified: false }));
  expect(selected()).toBe("processed 1");
  view.rerender(page({ verified: false, scope: "term-2" }));
  expect(selected()).toBe("matching 0");
  view.rerender(page({ verified: false }));
  expect(selected()).toBe("matching 0");
});

it("lets an initial notification destination override a loading click once, without replaying on account hydration", () => {
  window.history.replaceState(
    null,
    "",
    "/admin/requests#request-signup-notice",
  );
  const view = render(page({ scope: "no-active-period", scopeLoading: true }));
  choose("processed");
  mocks.ready = true;
  view.rerender(page());
  expect(selected()).toBe("assigned 1");
  expect(screen.getByText("Assigned notification record")).toBeTruthy();
  choose("processed");
  mocks.accountId = "head";
  view.rerender(page());
  expect(selected()).toBe("processed 1");
  expect(screen.queryByText("Assigned notification record")).toBeNull();
  expect(mocks.unassign).not.toHaveBeenCalled();
});
