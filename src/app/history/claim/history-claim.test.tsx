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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { HistoryClaim } from "./history-claim";

const remote = vi.hoisted(() => ({
  inspect: vi.fn(),
  claim: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useMutation } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => ({
        tuteeHistory: { myRecords: { invalidate: remote.invalidate } },
      }),
      tuteeHistory: {
        inspectClaim: {
          useQuery: (
            input: unknown,
            options: { enabled: boolean; retry: boolean },
          ) =>
            useQuery({
              queryKey: ["inspectClaim", input],
              queryFn: () => remote.inspect(),
              ...options,
            }),
        },
        claim: {
          useMutation: (options: Record<string, unknown>) =>
            useMutation({ mutationFn: remote.claim, ...options }),
        },
      },
    },
  };
});
const token = "a".repeat(64);
const evidence = {
  name: "Synthetic historical identity",
  sessions: 3,
  expiresAt: new Date("2099-01-01"),
};
let client: QueryClient;
function claimView(
  locale: "en" | "zh" = "en",
  value = token,
  invitationId?: string,
) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <HistoryClaim token={value} invitationId={invitationId} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function mount(
  locale: "en" | "zh" = "en",
  value = token,
  invitationId?: string,
) {
  return render(claimView(locale, value, invitationId));
}
async function refresh() {
  await act(async () => {
    await client.refetchQueries({ queryKey: ["inspectClaim"] });
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  remote.inspect.mockResolvedValue(evidence);
  remote.claim.mockResolvedValue({ ok: true });
  remote.invalidate.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
});

it.each(["en", "zh"] as const)(
  "offers read-only recovery from an initial %s transport failure",
  async (locale) => {
    const messages = locale === "en" ? en : zh;
    remote.inspect.mockRejectedValueOnce(new Error("Offline"));
    mount(locale);
    fireEvent.click(
      await screen.findByRole("button", { name: messages.uiPatterns.retry }),
    );
    await screen.findByText(evidence.name);
    expect(remote.inspect).toHaveBeenCalledTimes(2);
    expect(remote.claim).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  },
);

it("keeps safe confirmation across a cached transport failure and blocks writes until retry settles", async () => {
  mount();
  const confirmation = await screen.findByRole<HTMLInputElement>("checkbox");
  fireEvent.click(confirmation);
  remote.inspect.mockRejectedValueOnce(new Error("Offline"));
  await refresh();
  const retry = await screen.findByRole("button", {
    name: en.uiPatterns.retry,
  });
  expect(screen.getByText(evidence.name)).toBeTruthy();
  expect(confirmation.checked).toBe(true);
  expect(confirmation.disabled).toBe(true);
  const claim = screen.getByRole<HTMLButtonElement>("button", {
    name: en.tuteeHistory.claim,
  });
  expect(claim.disabled).toBe(true);
  fireEvent.click(claim);
  const recovery = deferred<typeof evidence>();
  remote.inspect.mockImplementationOnce(() => recovery.promise);
  fireEvent.click(retry);
  expect(claim.disabled).toBe(true);
  expect(remote.claim).not.toHaveBeenCalled();
  await act(async () => recovery.resolve(evidence));
  await waitFor(() => expect(claim.disabled).toBe(false));
  expect(confirmation.checked).toBe(true);
  expect(remote.claim).not.toHaveBeenCalled();
});

it.each([
  ["FORBIDDEN", "HISTORY_EMAIL_MISMATCH"],
  ["UNAUTHORIZED", "UNAUTHORIZED"],
  ["NOT_FOUND", "HISTORY_INVITATION_INVALID"],
  ["CONFLICT", "HISTORY_STALE"],
])(
  "conceals denied cached evidence through later transport failure (%s)",
  async (code, message) => {
    mount();
    fireEvent.click(await screen.findByRole("checkbox"));
    remote.inspect.mockRejectedValueOnce(
      Object.assign(new Error(message), { data: { code } }),
    );
    await refresh();
    await waitFor(() => expect(screen.queryByText(evidence.name)).toBeNull());
    expect(screen.queryByRole("checkbox")).toBeNull();
    remote.inspect.mockRejectedValueOnce(new Error("Offline"));
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await screen.findByText(en.uiPatterns.loadFailed);
    expect(screen.queryByText(evidence.name)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await screen.findByText(evidence.name);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(remote.claim).not.toHaveBeenCalled();
  },
);

it("freezes a pending claim, rejects duplicate admission, and preserves confirmation after a failed write", async () => {
  const write = deferred<unknown>();
  remote.claim.mockImplementationOnce(() => write.promise);
  mount();
  const confirmation = await screen.findByRole<HTMLInputElement>("checkbox");
  fireEvent.click(confirmation);
  const claim = screen.getByRole<HTMLButtonElement>("button", {
    name: en.tuteeHistory.claim,
  });
  fireEvent.click(claim);
  fireEvent.click(claim);
  await waitFor(() => expect(remote.claim).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(confirmation.disabled).toBe(true));
  await act(async () => write.reject(new Error("Offline")));
  await waitFor(() => expect(claim.disabled).toBe(false));
  expect(confirmation.checked).toBe(true);
  fireEvent.click(claim);
  await screen.findByText(en.tuteeHistory.claimed);
  expect(remote.claim).toHaveBeenCalledTimes(2);
  expect(remote.claim.mock.calls[0]?.[0]).toEqual({ token });
  expect(remote.claim.mock.calls[1]?.[0]).toEqual({ token });
});

it("does not inspect or claim a malformed capability", () => {
  mount("en", "malformed");
  expect(
    screen.getByText(en.tuteeHistory.HISTORY_INVITATION_INVALID),
  ).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(remote.inspect).not.toHaveBeenCalled();
  expect(remote.claim).not.toHaveBeenCalled();
});

it.each([
  {
    name: "token",
    nextToken: "b".repeat(64),
    firstInvitation: undefined,
    nextInvitation: undefined,
  },
  {
    name: "invitation with a retained token",
    nextToken: token,
    firstInvitation: "first-invitation",
    nextInvitation: "second-invitation",
  },
])(
  "requires fresh confirmation when the $name capability changes and when returning",
  async ({ nextToken, firstInvitation, nextInvitation }) => {
    const nextEvidence = { ...evidence, name: "Another historical identity" };
    remote.inspect
      .mockResolvedValueOnce(evidence)
      .mockResolvedValue(nextEvidence);
    const view = mount("en", token, firstInvitation);
    fireEvent.click(await screen.findByRole("checkbox"));
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(true);
    view.rerender(claimView("en", nextToken, nextInvitation));
    await screen.findByText(nextEvidence.name);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    const claim = screen.getByRole<HTMLButtonElement>("button", {
      name: en.tuteeHistory.claim,
    });
    expect(claim.disabled).toBe(true);
    fireEvent.click(claim);
    expect(remote.claim).not.toHaveBeenCalled();
    // Returning can use a still-fresh inspection cache; it must not revive old consent.
    view.rerender(claimView("en", token, firstInvitation));
    await screen.findByText(evidence.name);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.tuteeHistory.claim,
      }).disabled,
    ).toBe(true);
    expect(remote.claim).not.toHaveBeenCalled();
  },
);

it("recovers an authoritative claim rejection through inspection only, without reviving stale identity", async () => {
  remote.claim.mockRejectedValueOnce(
    Object.assign(new Error("HISTORY_STALE"), { data: { code: "CONFLICT" } }),
  );
  mount();
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.claim }));
  await screen.findByText(en.tuteeHistory.HISTORY_STALE);
  expect(screen.queryByText(evidence.name)).toBeNull();
  const inspection = deferred<typeof evidence>();
  remote.inspect.mockImplementationOnce(() => inspection.promise);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(screen.queryByText(evidence.name)).toBeNull();
  await act(async () => inspection.reject(new Error("Offline")));
  await screen.findByText(en.uiPatterns.loadFailed);
  expect(screen.queryByText(evidence.name)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await screen.findByText(evidence.name);
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  expect(remote.claim).toHaveBeenCalledTimes(1);
  expect(remote.inspect).toHaveBeenCalledTimes(3);
});
