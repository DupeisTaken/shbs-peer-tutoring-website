/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { HistoryClaim } from "./history-claim";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(), claimed: false, fetching: false,
  error: null as null | { message: string; data?: { code: string } },
  callbacks: null as null | { onSuccess: () => Promise<void>; onError: (error: unknown) => void; onSettled: () => void },
}));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ tuteeHistory: { myRecords: { invalidate: mocks.invalidate }, myTutorRecords: { invalidate: mocks.invalidate } } }),
  tuteeHistory: {
    inspectClaim: { useQuery: () => ({ data: { name: "Historical Person", sessions: 3, claimed: mocks.claimed, sources: [{ kind: "TUTOR", id: "exact-tutor", name: "Original Tutor" }, { kind: "TUTEE", id: "exact-tutee", name: "Original Tutee" }] }, error: mocks.error, isSuccess: !mocks.error, isFetching: mocks.fetching, refetch: mocks.refetch }) },
    claim: { useMutation: (callbacks: typeof mocks.callbacks) => { mocks.callbacks = callbacks; return { mutate: mocks.claim, isPending: false, error: null }; } },
  },
} }));
vi.mock("~/app/_components/tutee-history", () => ({ HistoryError: ({ message }: { message: string }) => <p role="alert">{message}</p> }));
const token = "a".repeat(64);
function view(locale: "en" | "zh" = "en") {
  return <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC"><HistoryClaim token={token} /></NextIntlClientProvider>;
}
beforeEach(() => { vi.clearAllMocks(); mocks.error = null; mocks.claimed = false; mocks.fetching = false; mocks.refetch.mockReset().mockResolvedValue({ data: { claimed: false } }); mocks.invalidate.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

it.each(["en", "zh"] as const)("shows the exact frozen sources and requires explicit claim in %s", (locale) => {
  render(view(locale));
  const copy = locale === "en" ? en : zh;
  expect(screen.getByText("Original Tutor")).toBeTruthy();
  expect(screen.getByText("Original Tutee")).toBeTruthy();
  expect(mocks.claim).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(copy.tuteeHistory.claimConfirm));
  fireEvent.click(screen.getByRole("button", { name: copy.tuteeHistory.claim }));
  fireEvent.click(screen.getByRole("button", { name: copy.tuteeHistory.claim }));
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(mocks.claim).toHaveBeenCalledWith({ token });
});

it("recovers accepted history synchronization through reads only", async () => {
  render(view());
  fireEvent.click(screen.getByLabelText(en.tuteeHistory.claimConfirm));
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.claim }));
  mocks.invalidate.mockRejectedValue(new Error("refresh unavailable"));
  await act(async () => { await mocks.callbacks!.onSuccess(); mocks.callbacks!.onSettled(); });
  expect(screen.getByText(en.tuteeHistory.claimed)).toBeTruthy();
  expect(screen.queryByRole("button", { name: en.tuteeHistory.claim })).toBeNull();
  mocks.invalidate.mockResolvedValue(undefined);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry })); });
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: en.uiPatterns.retry })).toBeNull();
});

it("reads an uncertain claim receipt and synchronizes both history views without repeating the claim", async () => {
  render(view());
  fireEvent.click(screen.getByLabelText(en.tuteeHistory.claimConfirm));
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.claim }));
  act(() => { mocks.callbacks!.onError({ message: "connection lost" }); mocks.callbacks!.onSettled(); });
  mocks.refetch.mockResolvedValue({ data: { claimed: true } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry })); });
  expect(mocks.refetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText(en.tuteeHistory.claimed)).toBeTruthy();
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(mocks.invalidate).toHaveBeenCalledTimes(2);
});

it("freezes claim consent and submission while the exact source read refreshes", () => {
  const mounted = render(view());
  fireEvent.click(screen.getByLabelText(en.tuteeHistory.claimConfirm));
  mocks.fetching = true;
  mounted.rerender(view());
  expect((screen.getByLabelText(en.tuteeHistory.claimConfirm) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.claim }));
  expect(mocks.claim).not.toHaveBeenCalled();
});

it("conceals previously loaded source details after denial and later transport failures", () => {
  const mounted = render(view());
  mocks.error = { message: "denied", data: { code: "FORBIDDEN" } };
  mounted.rerender(view());
  expect(screen.queryByText("Original Tutor")).toBeNull();
  mocks.error = { message: "network interrupted" };
  mounted.rerender(view());
  expect(screen.queryByText("Original Tutor")).toBeNull();
  expect(mocks.claim).not.toHaveBeenCalled();
});
