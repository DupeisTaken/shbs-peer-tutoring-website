// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import type { LegacySignupDeclineView } from "~/lib/legacy-signup-decline";
import { PUBLISHED_SESSION_DECLINE_MESSAGE } from "~/lib/legacy-signup-decline-error";
import {
  DeclinedLegacySignupCard,
  LegacySignupDeclineActions,
  useLegacySignupDecline,
} from "./legacy-signup-decline";

const mocks = vi.hoisted(() => {
  const account: {
    data: { id: string; role: string } | undefined;
    error: Error | null;
    isFetching: boolean;
  } = {
    data: { id: "staff-1", role: "HEAD" },
    error: null,
    isFetching: false,
  };
  return {
    account,
    accountRead: vi.fn<() => Promise<unknown>>(),
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
  };
});
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () => ({ ...mocks.account, refetch: mocks.accountRead }),
      },
    },
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
  bypassBlocked = false,
}: {
  denied?: boolean;
  removed?: boolean;
  updatedAt?: Date;
  bypassBlocked?: boolean;
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
          disabled={
            !bypassBlocked && actions.blocked({ id: "source", updatedAt })
          }
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
function example(props: Parameters<typeof Entry>[0] = {}, locale = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="UTC"
    >
      <LegacySignupDeclineActions>
        <Entry {...props} />
      </LegacySignupDeclineActions>
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.account = {
    data: { id: "staff-1", role: "HEAD" },
    error: null,
    isFetching: false,
  };
  mocks.accountRead.mockResolvedValue({ isSuccess: true });
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

it.each(
  (["en", "zh"] as const).flatMap((locale) =>
    (["Cancel", "Escape"] as const).flatMap((dismiss) =>
      ([false, true] as const).map((removed) => ({ locale, dismiss, removed })),
    ),
  ),
)(
  "returns $locale $dismiss focus to read-only account recovery (removed opener: $removed)",
  async ({ locale, dismiss, removed }) => {
    const catalog = locale === "zh" ? zh : en;
    const view = render(example({}, locale));
    const opener = screen.getByRole<HTMLButtonElement>("button", {
      name: "Review decline",
    });
    opener.focus();
    open();
    const dialog = screen.getByRole("dialog");
    mocks.account.error = new Error("Synthetic account read failure");
    view.rerender(example({ removed }, locale));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(removed ? !opener.isConnected : opener.disabled).toBe(true);
    expect(
      within(dialog).getByText(catalog.legacySignupDecline.actorLoadFailed),
    ).toBeTruthy();
    if (dismiss === "Cancel") {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: catalog.actionReview.cancel,
        }),
      );
    } else {
      fireEvent.keyDown(dialog, { key: "Escape" });
      // jsdom has no native close watcher; dispatch the browser's cancel request.
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    const retry = screen.getByRole<HTMLButtonElement>("button", {
      name: catalog.legacySignupDecline.actorRetry,
    });
    expect(retry.disabled).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(mocks.accountRead).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    mocks.accountRead.mockImplementationOnce(async () => {
      mocks.account.error = null;
      view.rerender(example({ removed }, locale));
      return { isSuccess: true };
    });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.accountRead).toHaveBeenCalledOnce());
    expect(
      screen.queryByText(catalog.legacySignupDecline.actorLoadFailed),
    ).toBeNull();
    expect(mocks.commit).not.toHaveBeenCalled();
  },
);

it("returns to the original opener when the account recovers just before dismissal", () => {
  const view = render(example());
  const opener = screen.getByRole<HTMLButtonElement>("button", {
    name: "Review decline",
  });
  opener.focus();
  open();
  mocks.account.error = new Error("Synthetic account read failure");
  view.rerender(example());
  expect(opener.disabled).toBe(true);
  mocks.account.error = null;
  view.rerender(example());
  expect(opener.disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.cancel }));
  expect(document.activeElement).toBe(opener);
  expect(
    screen.queryByRole("button", { name: en.legacySignupDecline.actorRetry }),
  ).toBeNull();
  expect(mocks.commit).not.toHaveBeenCalled();
});

it.each(["denial", "unmount"] as const)(
  "does not focus removed account recovery after owner %s",
  (teardown) => {
    const view = render(example());
    screen.getByRole("button", { name: "Review decline" }).focus();
    open();
    const dialog = screen.getByRole("dialog");
    mocks.account.error = new Error("Synthetic account read failure");
    view.rerender(example());
    const retry = screen
      .getAllByRole<HTMLButtonElement>("button", {
        name: en.legacySignupDecline.actorRetry,
      })
      .find((button) => !dialog.contains(button))!;
    const focus = vi.spyOn(retry, "focus");
    if (teardown === "denial") view.rerender(example({ denied: true }));
    else view.unmount();
    expect(retry.isConnected).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    focus.mockRestore();
  },
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
  mocks.account.data = { id: "staff-1", role: "COORDINATOR" };
  mocks.commit.mockRejectedValue({ data: { approvalId: "proposal-1" } });
  render(example());
  open();
  fireEvent.click(
    screen.getByRole("button", { name: en.legacySignupDecline.requestConfirm }),
  );
  await screen.findByText(en.actionReview.queued);
  expect(screen.queryByText(en.actionReview.applied)).toBeNull();
  expect(
    screen
      .getByRole("link", { name: en.actionReview.viewRequest })
      .getAttribute("href"),
  ).toContain("proposal-1");
  expect(mocks.read).not.toHaveBeenCalled();
});

it.each([
  ["en", en],
  ["zh", zh],
] as const)(
  "retains the %s publication refusal review and captured input through pending and rejected writes",
  async (locale, catalog) => {
    let reject!: (reason: Error) => void;
    mocks.commit.mockImplementationOnce(
      () =>
        new Promise((_, rejectWrite) => {
          reject = rejectWrite;
        }),
    );
    const view = render(example({}, locale));
    const opener = screen.getByRole("button", { name: "Review decline" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: catalog.legacySignupDecline.confirm,
    });
    act(() => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
    });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    const captured = mocks.commit.mock.calls[0]?.[0];
    expect(captured).toMatchObject({
      id: "source",
      expectedUpdatedAt: version,
    });
    expect(typeof captured?.clientKey).toBe("string");
    const cancelButton = within(dialog).getByRole("button", {
      name: catalog.actionReview.cancel,
    });
    expect(cancelButton.matches(":disabled")).toBe(true);
    fireEvent.click(cancelButton);
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => reject(new Error(PUBLISHED_SESSION_DECLINE_MESSAGE)));
    expect(within(dialog).getByRole("alert").textContent).toBe(
      catalog.legacySignupDecline.publishedSessionRecords,
    );
    expect(within(dialog).getByText("Captured source")).toBeTruthy();
    expect(screen.queryByText(catalog.actionReview.applied)).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.workloads).not.toHaveBeenCalled();
    view.rerender(
      example({ updatedAt: new Date("2026-11-05T00:00:00Z") }, locale),
    );
    mocks.commit.mockRejectedValueOnce(
      new Error(PUBLISHED_SESSION_DECLINE_MESSAGE),
    );
    fireEvent.click(confirmButton);
    await screen.findByText(
      catalog.legacySignupDecline.publishedSessionRecords,
    );
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(mocks.commit.mock.calls[1]?.[0]).toBe(captured);
    fireEvent.click(
      within(dialog).getByRole("button", { name: catalog.actionReview.cancel }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(mocks.commit).toHaveBeenCalledTimes(2);
  },
);

it.each([
  ["en", "Version conflict: source 42 changed"],
  ["zh", "Version conflict: source 42 changed"],
  [
    "en",
    "Cannot delete a tutee with published dated-session records. Set them inactive and preserve the session history instead.",
  ],
  [
    "zh",
    "Cannot delete a tutee with published dated-session records. Set them inactive and preserve the session history instead.",
  ],
] as const)(
  "keeps unmatched %s inline refusal details raw: %s",
  async (locale, message) => {
    const catalog = locale === "zh" ? zh : en;
    mocks.commit.mockRejectedValueOnce(new Error(message));
    render(example({}, locale));
    open();
    fireEvent.click(
      screen.getByRole("button", { name: catalog.legacySignupDecline.confirm }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it.each([
  ["en", en],
  ["zh", zh],
] as const)(
  "discloses direct and proposed declines in %s before submission",
  (locale, catalog) => {
    for (const role of ["HEAD", "ADMIN", "COORDINATOR"] as const) {
      mocks.account.data = { id: "staff-1", role };
      const view = render(example({}, locale));
      open();
      const proposal = role === "COORDINATOR";
      const copy = catalog.legacySignupDecline;
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("heading", {
          name: (proposal ? copy.requestTitle : copy.title).replace(
            "{name}",
            "Captured source",
          ),
        }),
      ).toBeTruthy();
      expect(
        within(dialog).getByText(
          proposal ? copy.requestConsequence : copy.consequence,
        ),
      ).toBeTruthy();
      expect(
        within(dialog).getByRole("button", {
          name: proposal ? copy.requestConfirm : copy.confirm,
        }),
      ).toBeTruthy();
      expect(
        within(dialog).queryByRole("button", {
          name: proposal ? copy.confirm : copy.requestConfirm,
        }),
      ).toBeNull();
      expect(mocks.commit).not.toHaveBeenCalled();
      view.unmount();
    }
  },
);

it.each([
  ["unknown", undefined, false, false],
  ["loading", undefined, true, false],
  ["refreshing", { id: "staff-1", role: "HEAD" }, true, false],
  ["failed initial read", undefined, false, true],
  ["failed cached direct read", { id: "staff-1", role: "HEAD" }, false, true],
  [
    "failed cached proposal read",
    { id: "staff-1", role: "COORDINATOR" },
    false,
    true,
  ],
  ["non-management account", { id: "staff-1", role: "VIEWER" }, false, false],
] as const)(
  "blocks decline admission for %s actor information",
  (_case, data, isFetching, failed) => {
    mocks.account = {
      data,
      error: failed ? new Error("Synthetic account read failure") : null,
      isFetching,
    };
    const view = render(example());
    expect(
      screen
        .getByRole("button", { name: "Review decline" })
        .matches(":disabled"),
    ).toBe(true);
    // A caller cannot bypass the feature-owned readiness gate by omitting disabled.
    view.rerender(example({ bypassBlocked: true }));
    open();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.commit).not.toHaveBeenCalled();
  },
);

it("recovers the actor read through reads only before admitting a Coordinator request", async () => {
  mocks.account = {
    data: undefined,
    error: new Error("Synthetic account read failure"),
    isFetching: false,
  };
  const view = render(example());
  expect(screen.getByText(en.legacySignupDecline.actorLoadFailed)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.legacySignupDecline.actorRetry }),
  );
  await waitFor(() => expect(mocks.accountRead).toHaveBeenCalledOnce());
  expect(mocks.commit).not.toHaveBeenCalled();
  mocks.account = {
    data: { id: "staff-1", role: "COORDINATOR" },
    error: null,
    isFetching: false,
  };
  view.rerender(example());
  open();
  expect(
    screen.getByRole("button", { name: en.legacySignupDecline.requestConfirm }),
  ).toBeTruthy();
  expect(mocks.commit).not.toHaveBeenCalled();
});

it.each([
  ["en", en],
  ["zh", zh],
] as const)(
  "recovers failed actor reads inside the same %s Coordinator review and retains its original intent",
  async (locale, catalog) => {
    const clientKey = "00000000-0000-4000-8000-000000000697";
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(clientKey);
    try {
      mocks.account.data = { id: "staff-1", role: "COORDINATOR" };
      const view = render(example({}, locale));
      open();
      const dialog = screen.getByRole("dialog");
      const copy = catalog.legacySignupDecline;
      const changedSourceVersion = new Date("2026-11-05T00:00:00Z");
      const rerender = () =>
        view.rerender(example({ updatedAt: changedSourceVersion }, locale));
      const holdAccountRead = () => {
        let settle!: (next: typeof mocks.account) => void;
        mocks.accountRead.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              mocks.account = { ...mocks.account, isFetching: true };
              rerender();
              settle = (next) => {
                mocks.account = next;
                rerender();
                resolve({ isSuccess: !next.error });
              };
            }),
        );
        return (next: typeof mocks.account) => act(async () => settle(next));
      };
      expect(uuid).toHaveBeenCalledOnce();
      expect(
        within(dialog).queryByRole("button", { name: copy.actorRetry }),
      ).toBeNull();
      mocks.account.error = new Error("Synthetic account read failure");
      rerender();
      expect(within(dialog).getByText(copy.actorLoadFailed)).toBeTruthy();
      const failRead = holdAccountRead();
      fireEvent.click(
        within(dialog).getByRole("button", { name: copy.actorRetry }),
      );
      expect(mocks.accountRead).toHaveBeenCalledOnce();
      expect(mocks.commit).not.toHaveBeenCalled();
      expect(
        within(dialog)
          .getByRole("button", { name: copy.actorRetry })
          .matches(":disabled"),
      ).toBe(true);
      fireEvent.click(
        within(dialog).getByRole("button", { name: copy.requestConfirm }),
      );
      await within(dialog).findByText(copy.actorUnavailable);
      expect(mocks.commit).not.toHaveBeenCalled();
      await failRead({
        data: { id: "staff-1", role: "COORDINATOR" },
        error: new Error("Synthetic failed retry"),
        isFetching: false,
      });
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(within(dialog).getByText(copy.actorLoadFailed)).toBeTruthy();
      expect(
        within(dialog)
          .getByRole("button", { name: copy.actorRetry })
          .matches(":disabled"),
      ).toBe(false);
      expect(mocks.commit).not.toHaveBeenCalled();
      const recoverRead = holdAccountRead();
      fireEvent.click(
        within(dialog).getByRole("button", { name: copy.actorRetry }),
      );
      expect(mocks.accountRead).toHaveBeenCalledTimes(2);
      expect(mocks.commit).not.toHaveBeenCalled();
      expect(
        within(dialog)
          .getByRole("button", { name: copy.actorRetry })
          .matches(":disabled"),
      ).toBe(true);
      await recoverRead({
        data: { id: "staff-1", role: "COORDINATOR" },
        error: null,
        isFetching: false,
      });
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(
        within(dialog).queryByRole("button", { name: copy.actorRetry }),
      ).toBeNull();
      expect(within(dialog).getByText("Captured source")).toBeTruthy();
      expect(uuid).toHaveBeenCalledOnce();
      mocks.commit.mockRejectedValueOnce(
        new Error("Synthetic write rejection"),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: copy.requestConfirm }),
      );
      await within(dialog).findByText("Synthetic write rejection");
      const captured = mocks.commit.mock.calls[0]?.[0];
      expect(captured).toEqual({
        id: "source",
        expectedUpdatedAt: version,
        clientKey,
      });
      mocks.commit.mockRejectedValueOnce({
        data: { approvalId: "recovered-original-intent" },
      });
      fireEvent.click(
        within(dialog).getByRole("button", { name: copy.requestConfirm }),
      );
      await within(dialog).findByText(catalog.actionReview.queued);
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(mocks.commit).toHaveBeenCalledTimes(2);
      expect(mocks.commit.mock.calls[1]?.[0]).toBe(captured);
      expect(uuid).toHaveBeenCalledOnce();
      expect(mocks.read).not.toHaveBeenCalled();
    } finally {
      uuid.mockRestore();
    }
  },
);

it.each([
  ["en", en],
  ["zh", zh],
] as const)(
  "keeps a recovered non-management actor from reviving the original %s review",
  async (locale, catalog) => {
    mocks.account.data = { id: "staff-1", role: "COORDINATOR" };
    const view = render(example({}, locale));
    open();
    const dialog = screen.getByRole("dialog");
    const copy = catalog.legacySignupDecline;
    mocks.account.error = new Error("Synthetic account read failure");
    view.rerender(example({}, locale));
    mocks.accountRead.mockImplementationOnce(async () => {
      mocks.account = {
        data: { id: "staff-1", role: "VIEWER" },
        error: null,
        isFetching: false,
      };
      view.rerender(example({}, locale));
      return { isSuccess: true };
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: copy.actorRetry }),
    );
    await within(dialog).findByText(copy.actorDenied);
    expect(mocks.accountRead).toHaveBeenCalledOnce();
    fireEvent.click(
      within(dialog).getByRole("button", { name: copy.requestConfirm }),
    );
    await within(dialog).findByText(copy.actorChanged);
    expect(mocks.commit).not.toHaveBeenCalled();
    mocks.accountRead.mockImplementationOnce(async () => {
      mocks.account = {
        data: { id: "staff-1", role: "COORDINATOR" },
        error: null,
        isFetching: false,
      };
      view.rerender(example({}, locale));
      return { isSuccess: true };
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: copy.actorRetry }),
    );
    await waitFor(() => {
      expect(
        within(dialog).queryByRole("button", { name: copy.actorRetry }),
      ).toBeNull();
    });
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.click(
      within(dialog).getByRole("button", { name: copy.requestConfirm }),
    );
    await within(dialog).findByText(copy.actorChanged);
    expect(mocks.accountRead).toHaveBeenCalledTimes(2);
    expect(mocks.commit).not.toHaveBeenCalled();
  },
);
it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "retains the %s review but blocks its write while the actor read is unknown, pending or failed",
  async (role) => {
    mocks.account.data = { id: "staff-1", role };
    const view = render(example());
    open();
    const dialog = screen.getByRole("dialog");
    const label =
      role === "COORDINATOR"
        ? en.legacySignupDecline.requestConfirm
        : en.legacySignupDecline.confirm;
    for (const next of [
      { data: undefined, error: null, isFetching: false },
      { data: { id: "staff-1", role }, error: null, isFetching: true },
      {
        data: { id: "staff-1", role },
        error: new Error("Synthetic read failure"),
        isFetching: false,
      },
    ]) {
      mocks.account = next;
      view.rerender(example());
      expect(screen.getByRole("dialog")).toBe(dialog);
      fireEvent.click(within(dialog).getByRole("button", { name: label }));
      await within(dialog).findByText(en.legacySignupDecline.actorUnavailable);
      expect(mocks.commit).not.toHaveBeenCalled();
    }
    mocks.account = {
      data: { id: "staff-1", role },
      error: null,
      isFetching: false,
    };
    view.rerender(example());
    if (role === "COORDINATOR") {
      mocks.commit.mockRejectedValueOnce({
        data: { approvalId: "recovered-proposal" },
      });
    }
    fireEvent.click(within(dialog).getByRole("button", { name: label }));
    await screen.findByText(
      role === "COORDINATOR" ? en.actionReview.queued : en.actionReview.applied,
    );
    expect(mocks.commit).toHaveBeenCalledOnce();
  },
);

it.each([
  { id: "staff-1", role: "ADMIN" },
  { id: "another-staff", role: "COORDINATOR" },
  { id: "staff-1", role: "VIEWER" },
])(
  "requires a new review after observed actor drift to $id / $role, including a later return",
  async (changed) => {
    mocks.account.data = { id: "staff-1", role: "COORDINATOR" };
    const view = render(example());
    open();
    const dialog = screen.getByRole("dialog");
    mocks.account.data = changed;
    view.rerender(example());
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en.legacySignupDecline.requestConfirm,
      }),
    );
    await within(dialog).findByText(en.legacySignupDecline.actorChanged);
    expect(mocks.commit).not.toHaveBeenCalled();
    // Returning to the original actor/role does not revive its old authority episode.
    mocks.account.data = { id: "staff-1", role: "COORDINATOR" };
    view.rerender(example());
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en.legacySignupDecline.requestConfirm,
      }),
    );
    await within(dialog).findByText(en.legacySignupDecline.actorChanged);
    expect(mocks.commit).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.actionReview.cancel }),
    );
    open();
    mocks.commit.mockRejectedValueOnce({
      data: { approvalId: "fresh-proposal" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: en.legacySignupDecline.requestConfirm,
      }),
    );
    await screen.findByText(en.actionReview.queued);
    expect(mocks.commit).toHaveBeenCalledOnce();
  },
);

it("retains a Coordinator's captured target, version and client key after an ordinary rejection", async () => {
  mocks.account.data = { id: "staff-1", role: "COORDINATOR" };
  mocks.commit.mockRejectedValueOnce(new Error("Version conflict"));
  const view = render(example());
  open();
  fireEvent.click(
    screen.getByRole("button", { name: en.legacySignupDecline.requestConfirm }),
  );
  await screen.findByText("Version conflict");
  const captured = mocks.commit.mock.calls[0]?.[0];
  expect(captured).toMatchObject({ id: "source", expectedUpdatedAt: version });
  expect(typeof captured?.clientKey).toBe("string");
  view.rerender(example({ updatedAt: new Date("2026-11-05T00:00:00Z") }));
  mocks.commit.mockRejectedValueOnce({
    data: { approvalId: "retained-proposal" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.legacySignupDecline.requestConfirm }),
  );
  await screen.findByText(en.actionReview.queued);
  expect(mocks.commit.mock.calls[1]?.[0]).toBe(captured);
  expect(mocks.read).not.toHaveBeenCalled();
});

it("keeps accepted-write refresh recovery read-only when the actor read later fails", async () => {
  mocks.read.mockRejectedValueOnce(new Error("Read unavailable"));
  const view = render(example());
  open();
  confirm();
  await screen.findByText(en.actionReview.refreshFailed);
  const dialog = screen.getByRole("dialog");
  mocks.account.error = new Error("Synthetic account read failure");
  view.rerender(example({ removed: true }));
  mocks.accountRead.mockImplementationOnce(async () => {
    mocks.account.error = null;
    view.rerender(example({ removed: true }));
    return { isSuccess: true };
  });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: en.legacySignupDecline.actorRetry,
    }),
  );
  await waitFor(() => {
    expect(
      within(dialog).queryByRole("button", {
        name: en.legacySignupDecline.actorRetry,
      }),
    ).toBeNull();
  });
  expect(mocks.accountRead).toHaveBeenCalledOnce();
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog")).toBe(dialog);
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.actionReview.close }),
  );
  const reads = mocks.read.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.retry }));
  await screen.findByText(en.actionReview.applied);
  expect(mocks.read.mock.calls.length).toBeGreaterThan(reads);
  expect(mocks.commit).toHaveBeenCalledOnce();
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
