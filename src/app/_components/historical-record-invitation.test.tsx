/** @vitest-environment jsdom */
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
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { HistoricalRecordInvitation } from "./historical-record-invitation";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";
import type { RouterOutputs } from "~/trpc/react";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  stop: vi.fn(),
  receipt: vi.fn(),
  refetch: vi.fn(),
  query: vi.fn(),
  error: null as null | { message: string; data?: { code: string } },
  status: null as RouterOutputs["tuteeHistory"]["exactInvitationStatus"],
  sendPending: false,
  callbacks: null as null | {
    onSuccess: (data: unknown) => Promise<void>;
    onError: (error: unknown) => void;
    onSettled: () => void;
  },
}));
const sources = [
  { kind: "TUTOR" as const, id: "tutor-history" },
  { kind: "TUTEE" as const, id: "tutee-history" },
];
const preview = {
  fingerprint: "a".repeat(64),
  sources: sources.map((source) => ({
    ...source,
    name: source.kind === "TUTOR" ? "Original Tutor" : "Original Tutee",
  })),
  blocked: [],
  canInvite: true,
};
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tuteeHistory: {
        previewExactInvitation: { fetch: mocks.preview },
        exactInvitationReceipt: { fetch: mocks.receipt },
      },
    }),
    tuteeHistory: {
      exactInvitationStatus: {
        useQuery: (input: unknown) => {
          mocks.query(input);
          return {
            data: mocks.status,
            error: mocks.error,
            isFetching: false,
            isLoading: false,
            refetch: mocks.refetch,
          };
        },
      },
      inviteExact: {
        useMutation: (callbacks: typeof mocks.callbacks) => {
          mocks.callbacks = callbacks;
          return { mutate: mocks.send, isPending: mocks.sendPending };
        },
      },
      cancelExactInvitation: {
        useMutation: () => ({ mutateAsync: mocks.cancel, isPending: false }),
      },
      abandonExactInvitation: {
        useMutation: () => ({ mutateAsync: mocks.stop, isPending: false }),
      },
    },
  },
}));
vi.mock("./tutee-history", () => ({
  HistoryError: ({ message }: { message: string }) => (
    <p role="alert">{message}</p>
  ),
}));

// CombineRecords independently registers its child's reported uncertainty. This
// ancestor is essential: a direct ProfileDialog cannot expose nested busy loops.
function PendingAncestor({
  chosen,
  accessDenied,
}: {
  chosen: typeof sources;
  accessDenied: boolean;
}) {
  const [pending, setPending] = useState(false);
  useDialogPending(pending);
  return (
    <>
      <button disabled={pending}>Sibling change</button>
      <HistoricalRecordInvitation
        sources={chosen}
        accessDenied={accessDenied}
        onPendingChange={setPending}
      />
    </>
  );
}
function view(
  locale: "en" | "zh" = "en",
  chosen = sources,
  accessDenied = false,
  onClose?: () => void,
  mirroredAncestor = false,
) {
  const invitation = mirroredAncestor ? (
    <PendingAncestor chosen={chosen} accessDenied={accessDenied} />
  ) : (
    <HistoricalRecordInvitation sources={chosen} accessDenied={accessDenied} />
  );
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="UTC"
    >
      {onClose ? (
        <ProfileDialog title="Historical setup" onClose={onClose}>
          {invitation}
        </ProfileDialog>
      ) : (
        invitation
      )}
    </NextIntlClientProvider>
  );
}
async function review(locale: "en" | "zh" = "en") {
  const copy = locale === "en" ? en : zh;
  fireEvent.change(screen.getByLabelText(copy.tuteeHistory.email), {
    target: { value: "alumni@example.test" },
  });
  fireEvent.change(screen.getByLabelText(copy.combineRecords.evidence), {
    target: { value: "Verified original records with the recipient" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: copy.historicalInvitation.review }),
  );
  await screen.findByText("Original Tutor");
}
function send(locale: "en" | "zh" = "en") {
  const copy = locale === "en" ? en : zh;
  fireEvent.click(screen.getByLabelText(copy.historicalInvitation.acknowledge));
  fireEvent.click(
    screen.getByRole("button", { name: copy.tuteeHistory.sendInvitation }),
  );
}
function uncertainStatus(attemptId: string, revision = "b".repeat(64)) {
  return {
    revision,
    invitation: null,
    attempt: {
      attemptId,
      status: "UNCERTAIN" as const,
      expiresAt: null,
      email: "alumni@example.test",
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = null;
  mocks.status = null;
  mocks.sendPending = false;
  mocks.preview.mockResolvedValue(preview);
  mocks.refetch.mockImplementation(async () => ({ data: mocks.status }));
  mocks.receipt.mockResolvedValue(null);
  mocks.cancel.mockResolvedValue({ cancelled: true });
  mocks.stop.mockImplementation(async (input: { operationId: string }) => ({
    attemptId: input.operationId,
    status: "ABANDONED",
    expiresAt: null,
  }));
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "reviews exact Tutor/Tutee records before delivery in %s",
  async (locale) => {
    render(view(locale));
    await review(locale);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(screen.getByText("Original Tutee")).toBeTruthy();
    expect(mocks.preview).toHaveBeenCalledWith(
      { sources, email: "alumni@example.test" },
      { staleTime: 0 },
    );
    expect(
      screen.getByText(
        (locale === "en" ? en : zh).historicalInvitation.consequences,
      ),
    ).toBeTruthy();
  },
);

it("freezes source scope across directory refreshes and clears review on recipient edits", async () => {
  const mounted = render(view());
  await review();
  mounted.rerender(
    view("en", [...sources, { kind: "TUTOR", id: "later-member" }]),
  );
  send();
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      sources,
      email: "alumni@example.test",
      fingerprint: preview.fingerprint,
      operationId: expect.any(String) as unknown,
    }),
  );
  expect(mocks.query).toHaveBeenLastCalledWith({ sources });
  act(() => {
    mocks.callbacks!.onSettled();
  });
  fireEvent.change(screen.getByLabelText(en.tuteeHistory.email), {
    target: { value: "different@example.test" },
  });
  expect(screen.queryByText("Original Tutor")).toBeNull();
});

it("does not send a blocked or unacknowledged invitation", async () => {
  mocks.preview.mockResolvedValue({
    ...preview,
    blocked: ["CURRENT_WORK"],
    canInvite: false,
  });
  render(view());
  await review();
  send();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(
    screen.getByText(en.historicalInvitation.blocked.CURRENT_WORK),
  ).toBeTruthy();
});

it("admits one send and recovers a lost response by reading its original receipt", async () => {
  render(view());
  await review();
  send();
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.sendInvitation }),
  );
  expect(mocks.send).toHaveBeenCalledTimes(1);
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string })
    .operationId;
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  mocks.receipt.mockResolvedValue({
    attemptId: operationId,
    status: "PUBLISHED",
    expiresAt: new Date(),
    email: "alumni@example.test",
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.historicalInvitation.checkReceipt }),
  );
  await screen.findByText(en.tuteeHistory.invitation_PUBLISHED);
  expect(mocks.receipt).toHaveBeenCalledWith({ operationId }, { staleTime: 0 });
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it.each(["en", "zh"] as const)(
  "retries a never-admitted invitation with its original intent and keeps the native modal fenced in %s",
  async (locale) => {
    const copy = locale === "en" ? en : zh;
    const close = vi.fn();
    const mounted = render(view(locale, sources, false, close));
    await review(locale);
    send(locale);
    const intent = mocks.send.mock.calls[0]![0] as { operationId: string };
    act(() => {
      mocks.callbacks!.onError({ message: "network interrupted" });
      mocks.callbacks!.onSettled();
    });
    const closeButton = screen.getByRole<HTMLButtonElement>("button", {
      name: copy.accountProfile.close,
    });
    expect(closeButton.disabled).toBe(true);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(close).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", {
        name: copy.historicalInvitation.retryExact,
      }),
    ).toBeNull();
    for (let attempt = 0; attempt < 2; attempt++) {
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name: copy.historicalInvitation.checkReceipt,
          }),
        );
      });
    }
    expect(mocks.receipt).toHaveBeenCalledTimes(2);
    expect(mocks.receipt).toHaveBeenLastCalledWith(
      { operationId: intent.operationId },
      { staleTime: 0 },
    );
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(copy.historicalInvitation.notRecorded),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: copy.historicalInvitation.review })
        .matches(":disabled"),
    ).toBe(true);
    expect(
      screen.getByLabelText(copy.tuteeHistory.email).matches(":disabled"),
    ).toBe(true);
    expect(
      screen.queryByRole("button", {
        name: copy.tuteeHistory.cancelInvitation,
      }),
    ).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);

    // A directory change cannot widen the original review or supply a fresh key.
    mounted.rerender(
      view(
        locale,
        [...sources, { kind: "TUTOR", id: "later-member" }],
        false,
        close,
      ),
    );
    const retry = screen.getByRole<HTMLButtonElement>("button", {
      name: copy.historicalInvitation.retryExact,
    });
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[1]![0]).toEqual(intent);
    expect(closeButton.disabled).toBe(true);
    await act(async () => {
      await mocks.callbacks!.onSuccess({
        attemptId: intent.operationId,
        status: "PUBLISHED",
        expiresAt: new Date(),
      });
      mocks.callbacks!.onSettled();
    });
    expect(closeButton.disabled).toBe(false);
    expect(
      screen.getByText(copy.tuteeHistory.invitation_PUBLISHED),
    ).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  },
);

it("requires a fresh authorized scope read before allowing an exact retry", async () => {
  render(view());
  await review();
  send();
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  mocks.refetch.mockRejectedValueOnce(new Error("scope disconnected"));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.retryExact })
      .matches(":disabled"),
  ).toBe(true);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.retryExact })
      .matches(":disabled"),
  ).toBe(false);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("keeps a rejected exact retry uncertain until the late original operation has a receipt", async () => {
  const close = vi.fn();
  render(view("en", sources, false, close));
  await review();
  send();
  const intent = mocks.send.mock.calls[0]![0] as { operationId: string };
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.historicalInvitation.retryExact }),
  );
  act(() => {
    mocks.callbacks!.onError({
      message: "rate limited",
      data: { code: "TOO_MANY_REQUESTS" },
    });
    mocks.callbacks!.onSettled();
  });
  expect(
    screen
      .getByRole("button", { name: en.accountProfile.close })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.review })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: en.historicalInvitation.retryExact }),
  ).toBeNull();
  mocks.receipt.mockResolvedValue({
    attemptId: intent.operationId,
    status: "PUBLISHED",
    expiresAt: new Date(),
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(
    screen
      .getByRole("button", { name: en.accountProfile.close })
      .matches(":disabled"),
  ).toBe(false);
  expect(mocks.receipt).toHaveBeenLastCalledWith(
    { operationId: intent.operationId },
    { staleTime: 0 },
  );
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[1]![0]).toEqual(intent);
});

it("conceals the frozen retry after authoritative denial and retains denial through a transport failure", async () => {
  const mounted = render(view());
  await review();
  send();
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  mocks.error = { message: "forbidden", data: { code: "FORBIDDEN" } };
  mounted.rerender(view());
  expect(
    screen.queryByRole("button", { name: en.historicalInvitation.retryExact }),
  ).toBeNull();
  expect(
    screen.queryByText(
      en.tuteeHistory.invitationRecipient.replace(
        "{email}",
        "alumni@example.test",
      ),
    ),
  ).toBeNull();
  mocks.error = { message: "network interrupted" };
  mounted.rerender(view());
  expect(
    screen.queryByRole("button", { name: en.historicalInvitation.retryExact }),
  ).toBeNull();
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it.each(["en", "zh"] as const)(
  "keeps the stop review usable beneath an ancestor pending fence and cancels without writes in %s",
  async (locale) => {
    const copy = locale === "en" ? en : zh;
    const close = vi.fn();
    render(view(locale, sources, false, close, true));
    await review(locale);
    send(locale);
    act(() => {
      mocks.callbacks!.onError({ message: "network interrupted" });
      mocks.callbacks!.onSettled();
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: copy.historicalInvitation.checkReceipt,
        }),
      );
    });
    const opener = screen.getByRole<HTMLButtonElement>("button", {
      name: copy.historicalInvitation.stopRequest,
    });
    opener.focus();
    fireEvent.click(opener);
    const confirmation = screen.getByRole("region", {
      name: copy.historicalInvitation.stopRequest,
    });
    expect(
      within(confirmation)
        .getByRole("button", {
          name: copy.historicalInvitation.confirmStopRequest,
        })
        .matches(":disabled"),
    ).toBe(false);
    expect(
      screen
        .getByRole("button", { name: copy.accountProfile.close })
        .matches(":disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Sibling change" })
        .matches(":disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: copy.historicalInvitation.retryExact })
        .matches(":disabled"),
    ).toBe(true);
    expect(mocks.stop).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: copy.uiPatterns.cancel,
      }),
    );
    expect(
      screen.queryByRole("region", {
        name: copy.historicalInvitation.stopRequest,
      }),
    ).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.keyDown(
      screen.getByRole("region", {
        name: copy.historicalInvitation.stopRequest,
      }),
      { key: "Escape" },
    );
    expect(
      screen.queryByRole("region", {
        name: copy.historicalInvitation.stopRequest,
      }),
    ).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(close).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  },
);

it("admits one stop beneath an ancestor fence, then recovers its accepted result with reads before a fresh invitation", async () => {
  render(view("en", sources, false, vi.fn(), true));
  await review();
  send();
  const intent = mocks.send.mock.calls[0]![0] as { operationId: string };
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.historicalInvitation.stopRequest }),
  );
  const confirmation = screen.getByRole("region", {
    name: en.historicalInvitation.stopRequest,
  });
  const confirm = within(confirmation).getByRole("button", {
    name: en.historicalInvitation.confirmStopRequest,
  });
  let finishStop!: (value: {
    attemptId: string;
    status: "ABANDONED";
    expiresAt: null;
  }) => void;
  mocks.stop.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishStop = resolve;
      }),
  );
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(mocks.stop).toHaveBeenCalledWith(intent);
  expect(confirm.matches(":disabled")).toBe(true);
  expect(
    within(confirmation)
      .getByRole("button", { name: en.uiPatterns.cancel })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.keyDown(confirmation, { key: "Escape" });
  expect(
    screen.getByRole("region", { name: en.historicalInvitation.stopRequest }),
  ).toBeTruthy();
  mocks.refetch.mockRejectedValueOnce(
    new Error("accepted stop refresh disconnected"),
  );
  await act(async () => {
    finishStop({
      attemptId: intent.operationId,
      status: "ABANDONED",
      expiresAt: null,
    });
  });
  expect(screen.getByText(en.tuteeHistory.invitation_ABANDONED)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.review })
      .matches(":disabled"),
  ).toBe(true);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.tuteeHistory.refreshInvitation }),
    );
  });
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.receipt).toHaveBeenCalledTimes(1);
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.review })
      .matches(":disabled"),
  ).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: en.historicalInvitation.review }),
  );
  await screen.findByText("Original Tutor");
  send();
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(
    (mocks.send.mock.calls[1]![0] as { operationId: string }).operationId,
  ).not.toBe(intent.operationId);
});

it("recovers a lost stop response by reading its original closed receipt without replaying the stop", async () => {
  render(view("en", sources, false, vi.fn(), true));
  await review();
  send();
  const intent = mocks.send.mock.calls[0]![0] as { operationId: string };
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  mocks.stop.mockRejectedValueOnce(new Error("stop response interrupted"));
  fireEvent.click(
    screen.getByRole("button", { name: en.historicalInvitation.stopRequest }),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.confirmStopRequest,
      }),
    );
  });
  expect(
    screen
      .getByRole("button", { name: en.accountProfile.close })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.review })
      .matches(":disabled"),
  ).toBe(true);
  mocks.receipt.mockResolvedValue({
    attemptId: intent.operationId,
    status: "ABANDONED",
    expiresAt: null,
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(screen.getByText(en.tuteeHistory.invitation_ABANDONED)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: en.accountProfile.close })
      .matches(":disabled"),
  ).toBe(false);
  expect(mocks.receipt).toHaveBeenLastCalledWith(
    { operationId: intent.operationId },
    { staleTime: 0 },
  );
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("shows the admitted receipt when delivery wins the stop race and keeps the existing cancellation boundary", async () => {
  render(view("en", sources, false, vi.fn(), true));
  await review();
  send();
  const intent = mocks.send.mock.calls[0]![0] as { operationId: string };
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  mocks.status = uncertainStatus(intent.operationId);
  mocks.stop.mockResolvedValueOnce({
    attemptId: intent.operationId,
    status: "UNCERTAIN",
    expiresAt: null,
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.historicalInvitation.stopRequest }),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.confirmStopRequest,
      }),
    );
  });
  expect(screen.getByText(en.tuteeHistory.invitation_UNCERTAIN)).toBeTruthy();
  expect(screen.queryByText(en.tuteeHistory.invitation_ABANDONED)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: en.tuteeHistory.cancelInvitation })
      .matches(":disabled"),
  ).toBe(false);
  expect(
    screen.queryByRole("button", { name: en.historicalInvitation.retryExact }),
  ).toBeNull();
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("preserves the draft on a transient read failure and conceals denied evidence", async () => {
  const mounted = render(view());
  await review();
  mocks.error = { message: "temporary network failure" };
  mounted.rerender(view());
  expect(screen.getByText("Original Tutor")).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>(en.tuteeHistory.email).value,
  ).toBe("alumni@example.test");
  mocks.error = { message: "forbidden", data: { code: "FORBIDDEN" } };
  mounted.rerender(view());
  expect(screen.queryByText("Original Tutor")).toBeNull();
  mocks.error = { message: "temporary network failure" };
  mounted.rerender(view());
  expect(screen.queryByText("Original Tutor")).toBeNull();
});

it("preserves denied authority when a refetch returns a serialized error", async () => {
  const mounted = render(view());
  await review();
  mocks.error = { message: "temporary network failure" };
  mounted.rerender(view());
  mocks.refetch.mockResolvedValueOnce({
    error: { message: "forbidden", data: { code: "FORBIDDEN" } },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.tuteeHistory.refreshInvitation }),
    );
  });
  expect(screen.queryByText("Original Tutor")).toBeNull();
  mocks.error = null;
  mounted.rerender(view());
  expect(screen.queryByText("Original Tutor")).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("keeps unresolved delivery receipts mounted and allows only receipt reads until publication is known", async () => {
  const close = vi.fn();
  render(view("en", sources, false, close));
  await review();
  send();
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string })
    .operationId;
  await act(async () => {
    await mocks.callbacks!.onSuccess({
      attemptId: operationId,
      status: "UNCERTAIN",
      expiresAt: null,
    });
    mocks.callbacks!.onSettled();
  });
  const closeButton = screen.getByRole<HTMLButtonElement>("button", {
    name: en.accountProfile.close,
  });
  expect(closeButton.disabled).toBe(true);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: false, cancelable: true }),
  );
  expect(close).not.toHaveBeenCalled();
  mocks.receipt.mockResolvedValue({
    attemptId: operationId,
    status: "UNCERTAIN",
    expiresAt: null,
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(
    screen.queryByRole("button", { name: en.historicalInvitation.retryExact }),
  ).toBeNull();
  expect(closeButton.disabled).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.review })
      .matches(":disabled"),
  ).toBe(true);
  mocks.receipt.mockResolvedValue({
    attemptId: operationId,
    status: "PUBLISHED",
    expiresAt: new Date(),
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(closeButton.disabled).toBe(false);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.receipt).toHaveBeenCalledTimes(2);
});

it("cancels a durable uncertain attempt using its fresh revision without replaying delivery", async () => {
  const close = vi.fn();
  const mounted = render(view("en", sources, false, close));
  await review();
  send();
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string })
    .operationId;
  mocks.status = uncertainStatus(operationId);
  mocks.sendPending = true;
  mounted.rerender(view("en", sources, false, close));
  const parent = screen.getByRole("dialog", { name: "Historical setup" });
  const closeButton = within(parent).getByRole("button", {
    name: en.accountProfile.close,
  });
  const cancelButton = within(parent).getByRole("button", {
    name: en.tuteeHistory.cancelInvitation,
  });

  // Even a fresh durable status must not bypass the request's active SMTP fence.
  await act(async () => {
    await mocks.callbacks!.onSuccess({
      attemptId: operationId,
      status: "UNCERTAIN",
      expiresAt: null,
    });
  });
  expect(closeButton.matches(":disabled")).toBe(true);
  expect(cancelButton.matches(":disabled")).toBe(true);
  act(() => {
    mocks.callbacks!.onSettled();
  });
  mocks.sendPending = false;
  mounted.rerender(view("en", sources, false, close));
  expect(closeButton.matches(":disabled")).toBe(false);
  expect(cancelButton.matches(":disabled")).toBe(false);
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.review })
      .matches(":disabled"),
  ).toBe(true);

  let finishCancellation!: (value: { cancelled: boolean }) => void;
  mocks.cancel.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishCancellation = resolve;
      }),
  );
  fireEvent.click(cancelButton);
  const confirmation = screen.getByRole("dialog", {
    name: en.tuteeHistory.cancelInvitation,
  });
  const confirm = within(confirmation).getByRole("button", {
    name: en.tuteeHistory.cancelInvitation,
  });
  expect(confirm.matches(":disabled")).toBe(false);
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(closeButton.matches(":disabled")).toBe(true);
  expect(confirm.matches(":disabled")).toBe(true);
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).toHaveBeenCalledWith({
    sources,
    revision: "b".repeat(64),
  });
  mocks.status = {
    ...mocks.status,
    revision: "c".repeat(64),
    attempt: { ...mocks.status.attempt!, status: "SUPERSEDED" },
  };
  await act(async () => {
    finishCancellation({ cancelled: true });
  });
  await within(confirmation).findByText(en.actionReview.applied);
  expect(closeButton.matches(":disabled")).toBe(false);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
});

it("recovers an accepted uncertain-attempt cancellation with reads after its refresh fails", async () => {
  const close = vi.fn();
  render(view("en", sources, false, close));
  await review();
  send();
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string })
    .operationId;
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  mocks.status = uncertainStatus(operationId);
  mocks.receipt.mockResolvedValue({
    attemptId: operationId,
    status: "UNCERTAIN",
    expiresAt: null,
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(mocks.receipt).toHaveBeenCalledWith({ operationId }, { staleTime: 0 });
  expect(mocks.refetch).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  const confirmation = screen.getByRole("dialog", {
    name: en.tuteeHistory.cancelInvitation,
  });
  mocks.refetch.mockRejectedValueOnce(new Error("refresh disconnected"));
  fireEvent.click(
    within(confirmation).getByRole("button", {
      name: en.tuteeHistory.cancelInvitation,
    }),
  );
  await within(confirmation).findByText(en.actionReview.refreshFailed);
  expect(
    screen
      .getByRole("button", { name: en.historicalInvitation.review })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    within(confirmation).queryByRole("button", {
      name: en.tuteeHistory.cancelInvitation,
    }),
  ).toBeNull();
  // Dismissing the confirmation keeps its accepted result and read recovery inline.
  fireEvent.click(
    within(confirmation).getByRole("button", { name: en.actionReview.close }),
  );
  expect(
    screen.queryByRole("dialog", { name: en.tuteeHistory.cancelInvitation }),
  ).toBeNull();
  mocks.status = {
    ...mocks.status,
    revision: "c".repeat(64),
    attempt: { ...mocks.status.attempt!, status: "SUPERSEDED" },
  };
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.retry }));
  await screen.findByText(en.actionReview.applied);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: en.historicalInvitation.review })
        .matches(":disabled"),
    ).toBe(false),
  );
  expect(mocks.refetch).toHaveBeenCalledTimes(3);
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).toHaveBeenCalledWith({
    sources,
    revision: "b".repeat(64),
  });
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("does not use cached scope evidence to cancel a missing or mismatched receipt", async () => {
  const close = vi.fn();
  const mounted = render(view("en", sources, false, close));
  await review();
  send();
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string })
    .operationId;
  mocks.status = uncertainStatus("another-attempt");
  act(() => {
    mocks.callbacks!.onError({ message: "network interrupted" });
    mocks.callbacks!.onSettled();
  });
  mounted.rerender(view("en", sources, false, close));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(
    screen
      .getByRole("button", { name: en.tuteeHistory.cancelInvitation })
      .matches(":disabled"),
  ).toBe(true);
  mocks.receipt.mockResolvedValue({
    attemptId: operationId,
    status: "UNCERTAIN",
    expiresAt: null,
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.historicalInvitation.checkReceipt,
      }),
    );
  });
  expect(mocks.refetch).toHaveBeenCalledTimes(2);
  expect(
    screen
      .getByRole("button", { name: en.tuteeHistory.cancelInvitation })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.accountProfile.close })
      .matches(":disabled"),
  ).toBe(true);
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
