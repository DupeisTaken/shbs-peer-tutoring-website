// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import type { LegacySignupDeclineView } from "~/lib/legacy-signup-decline";
import {
  DeclinedLegacySignupCard,
  LegacySignupDeclineActions,
  useLegacySignupDecline,
} from "./legacy-signup-decline";

const mocks = vi.hoisted(() => ({
  commit:
    vi.fn<
      (input: {
        id: string;
        expectedUpdatedAt: Date;
        clientKey: string;
      }) => Promise<unknown>
    >(),
  read: vi.fn<() => Promise<void>>(),
  workloads: vi.fn<() => Promise<void>>(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      declineSignup: { useMutation: () => ({ mutateAsync: mocks.commit }) },
    },
    useUtils: () => ({
      admin: {
        tutees: { invalidate: mocks.read },
        pairings: { invalidate: mocks.read },
      },
      studentWorkflow: {
        adminRequests: { invalidate: mocks.read },
        legacyReviews: { invalidate: mocks.read },
      },
    }),
  },
}));
vi.mock("~/lib/workload-cache", () => ({
  invalidateWorkloads: () => mocks.workloads(),
}));
const version = new Date("2026-11-04T00:00:00Z");

function Entry({
  denied = false,
  removed = false,
  updatedAt = version,
}: {
  denied?: boolean;
  removed?: boolean;
  updatedAt?: Date;
}) {
  const actions = useLegacySignupDecline()!;
  const revoke = actions.revoke;
  useEffect(() => {
    if (denied) revoke();
  }, [denied, revoke]);
  if (denied) return <p>Access denied</p>;
  return (
    <>
      {!removed && (
        <button
          disabled={actions.blocked({ id: "source", updatedAt })}
          onClick={() =>
            actions.open({ id: "source", updatedAt, name: "Captured source" })
          }
        >
          Review decline
        </button>
      )}
      {actions.dialog}
    </>
  );
}
function example(props: Parameters<typeof Entry>[0] = {}) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <LegacySignupDeclineActions>
        <Entry {...props} />
      </LegacySignupDeclineActions>
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.commit.mockResolvedValue({ ok: true });
  mocks.read.mockResolvedValue(undefined);
  mocks.workloads.mockResolvedValue(undefined);
});
afterEach(cleanup);
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Review decline" }));
const confirm = () =>
  fireEvent.click(
    screen.getByRole("button", { name: en.legacySignupDecline.confirm }),
  );

it("cancels without writing and retains the exact admitted payload through rejection and background source changes", async () => {
  const view = render(example());
  open();
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.cancel }));
  expect(mocks.commit).not.toHaveBeenCalled();
  mocks.commit.mockRejectedValueOnce(new Error("Version conflict"));
  open();
  confirm();
  await screen.findByText("Version conflict");
  const captured: unknown = mocks.commit.mock.calls[0]?.[0];
  expect(captured).toMatchObject({
    id: "source",
    expectedUpdatedAt: version,
  });
  expect(typeof mocks.commit.mock.calls[0]?.[0].clientKey).toBe("string");
  view.rerender(example({ updatedAt: new Date("2026-11-05T00:00:00Z") }));
  confirm();
  await screen.findByText(en.actionReview.applied);
  expect(mocks.commit).toHaveBeenCalledTimes(2);
  expect(mocks.commit.mock.calls[1]?.[0]).toEqual(captured);
});

it("keeps accepted refresh recovery after the card moves to Closed and offers only reads after closing", async () => {
  const view = render(example());
  mocks.read.mockRejectedValueOnce(new Error("Read unavailable"));
  open();
  confirm();
  await screen.findByText(en.actionReview.refreshFailed);
  view.rerender(example({ removed: true }));
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.close }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const reads = mocks.read.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.retry }));
  await screen.findByText(en.actionReview.applied);
  expect(mocks.read.mock.calls.length).toBeGreaterThan(reads);
  expect(mocks.commit).toHaveBeenCalledTimes(1);
});

it("conceals a denied review while its admitted write settles and retains the accepted-key fence", async () => {
  let settle!: (result: unknown) => void;
  mocks.commit.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const view = render(example());
  open();
  confirm();
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
  view.rerender(example({ denied: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Captured source")).toBeNull();
  await act(async () => settle({ ok: true }));
  view.rerender(example());
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Review decline",
      }).disabled,
    ).toBe(true),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.commit).toHaveBeenCalledTimes(1);
});

it("shows a queued management proposal without claiming a decline was applied", async () => {
  mocks.commit.mockRejectedValue({ data: { approvalId: "proposal-1" } });
  render(example());
  open();
  confirm();
  await screen.findByText(en.actionReview.queued);
  expect(screen.queryByText(en.actionReview.applied)).toBeNull();
  expect(
    screen
      .getByRole("link", { name: en.actionReview.viewRequest })
      .getAttribute("href"),
  ).toContain("proposal-1");
  expect(mocks.read).not.toHaveBeenCalled();
});

const decline: LegacySignupDeclineView = {
  state: "DECLINED",
  termId: "period",
  resolvedAt: version,
  resolvedById: "reviewer",
  resolvedByName: "Staff Reviewer",
  snapshot: {
    schemaVersion: 1,
    source: {
      id: "source",
      englishName: "Captured name",
      firstName: null,
      lastName: null,
      preferredName: null,
      legacyName: null,
      alternativeNames: null,
      notes: null,
      email: "captured@example.test",
      phone: null,
      preferredContact: "Captured contact",
      gradeLevel: "10",
      academicallyGraduated: false,
      signupSource: "STAFF",
      intakeTermId: null,
      signupSubmittedAt: version.toISOString(),
      createdAt: version.toISOString(),
      status: "PENDING",
      firstChoice: { id: "subject", name: "Captured course" },
      secondChoice: null,
      signedRulebook: true,
      signatureName: "Captured signature",
      signedAt: version.toISOString(),
    },
    decisionPeriod: {
      id: "period",
      name: "Captured period",
      schoolYear: "2026-2027",
      quarter: "Q1",
    },
    availability: [
      {
        id: "slot",
        label: "Captured slot",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    ],
    ownership: {
      userId: "owner",
      retainedOwnerId: "owner",
      personId: "person",
      historyIdentityRevision: 2,
    },
    pairings: [],
  },
};
it.each(["en", "zh"] as const)(
  "renders immutable Closed intake in %s without mounting any mutation or assignment controls",
  async (locale) => {
    const messages = locale === "zh" ? zh : en;
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="UTC"
      >
        <DeclinedLegacySignupCard decline={decline} order={3} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Captured name")).toBeTruthy();
    fireEvent.click(screen.getByText(messages.legacySignupDecline.snapshot));
    expect(await screen.findByText(/Captured course/)).toBeTruthy();
    expect(screen.getByText("captured@example.test")).toBeTruthy();
    expect(screen.getByText(/Captured signature/)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: messages.admin.requests.decline }),
    ).toBeNull();
    expect(mocks.commit).not.toHaveBeenCalled();
  },
);
