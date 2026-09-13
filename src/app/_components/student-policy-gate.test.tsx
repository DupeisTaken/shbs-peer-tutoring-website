// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StudentPolicyGate } from "./student-policy-gate";
const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  refetch: vi.fn(),
  accept: vi.fn(),
  prepare: vi.fn(),
  invalidate: vi.fn(),
  reset: vi.fn(),
  path: "/student",
  search: "",
  locale: "en",
  error: null as { message: string } | null,
  onSuccess: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("next-intl", () => ({
  useLocale: () => mocks.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: { policyStatus: { invalidate: mocks.invalidate } },
      student: { policy: { invalidate: mocks.invalidate } },
    }),
    studentWorkflow: {
      policyStatus: { useQuery: mocks.status },
      acceptPolicy: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => {
          mocks.onSuccess = options.onSuccess;
          return {
            mutate: mocks.accept,
            error: mocks.error,
            reset: mocks.reset,
            isPending: false,
          };
        },
      },
      prepareAction: {
        useMutation: () => ({
          mutate: mocks.prepare,
          data: { id: "ticket", readyAt: new Date("2030-01-01T00:00:10Z") },
        }),
      },
    },
  },
}));
const policy = (revision = "current") => ({
  slug: "tutee-policy",
  revision,
  documents: [
    { locale: "en", title: "English rules", body: "Exact rules" },
    { locale: "zh", title: "中文守则", body: "准确原文" },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  mocks.path = "/student";
  mocks.search = "";
  mocks.locale = "en";
  mocks.error = null;
  mocks.refetch.mockResolvedValue({ data: policy(), error: null });
  mocks.status.mockReturnValue({ data: policy(), refetch: mocks.refetch });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it.each(["/", "/student", "/messages", "/my-account", "/settings"])(
  "prompts immediately on %s and permits cancellation without accepting",
  async (path) => {
    mocks.path = path;
    render(<StudentPolicyGate />);
    await act(async () => undefined);
    expect(screen.getByRole("dialog", { name: "policyTitle" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(mocks.accept).not.toHaveBeenCalled();
  },
);
it("requires explicit agreement and the full wait, retries failures and refreshes successful consent", async () => {
  const view = render(<StudentPolicyGate />);
  await act(async () => undefined);
  await act(() => vi.advanceTimersByTime(10000));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "confirm" }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "confirm" }));
  expect(mocks.accept).toHaveBeenCalledWith({
    slug: "tutee-policy",
    revision: "current",
    agreed: true,
    ticket: "ticket",
  });
  mocks.error = { message: "Temporary failure" };
  view.rerender(<StudentPolicyGate />);
  expect(screen.getByRole("alert").textContent).toBe("Temporary failure");
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(mocks.reset).toHaveBeenCalled();
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  await act(async () => mocks.onSuccess?.());
  expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  mocks.status.mockReturnValue({ data: null, refetch: mocks.refetch });
  view.rerender(<StudentPolicyGate />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("refreshes publication on native window focus and route changes, resetting consent for a new revision", async () => {
  const view = render(<StudentPolicyGate />);
  await act(async () => undefined);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  await act(async () => {
    fireEvent(window, new Event("focus"));
  });
  expect(mocks.refetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("dialog")).toBeTruthy();
  mocks.status.mockReturnValue({
    data: policy("new-publication"),
    refetch: mocks.refetch,
  });
  mocks.path = "/messages";
  view.rerender(<StudentPolicyGate />);
  await act(async () => undefined);
  expect(mocks.refetch).toHaveBeenCalledTimes(3);
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  expect(mocks.prepare).toHaveBeenLastCalledWith({
    action: "POLICY",
    target: "new-publication",
  });
});
it("uses chosen policy locale, falls back to English and skips accepted/public pages", async () => {
  mocks.locale = "zh";
  const view = render(<StudentPolicyGate />);
  await act(async () => undefined);
  expect(screen.getByText("准确原文")).toBeTruthy();
  mocks.locale = "fr";
  view.rerender(<StudentPolicyGate />);
  expect(screen.getByText("Exact rules")).toBeTruthy();
  mocks.status.mockReturnValue({ data: null, refetch: mocks.refetch });
  view.rerender(<StudentPolicyGate />);
  expect(screen.queryByRole("dialog")).toBeNull();
  mocks.path = "/signup";
  mocks.status.mockReturnValue({ data: policy(), refetch: mocks.refetch });
  view.rerender(<StudentPolicyGate />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("policy-load errors leave personal screens accessible and offer a retry", async () => {
  mocks.status.mockReturnValue({
    error: { message: "Offline" },
    refetch: mocks.refetch,
  });
  render(<StudentPolicyGate />);
  await act(async () => undefined);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(mocks.refetch).toHaveBeenCalledTimes(2);
});
it("does not carry dismissal across different policies with identical revision text", async () => {
  const view = render(<StudentPolicyGate />);
  await act(async () => undefined);
  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  mocks.status.mockReturnValue({
    data: { ...policy(), slug: "tutor-policy" },
    refetch: mocks.refetch,
  });
  view.rerender(<StudentPolicyGate />);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(mocks.prepare).toHaveBeenLastCalledWith({
    action: "POLICY",
    target: "tutor-policy:current",
  });
});
it("refreshes query-only student tabs without interrupting personal navigation for a dismissed unchanged revision", async () => {
  const view = render(<StudentPolicyGate />);
  await act(async () => undefined);
  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  mocks.search = "view=messages";
  view.rerender(<StudentPolicyGate />);
  await act(async () => undefined);
  expect(mocks.refetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).toBeNull();
  mocks.status.mockReturnValue({
    data: policy("newer"),
    refetch: mocks.refetch,
  });
  view.rerender(<StudentPolicyGate />);
  expect(screen.getByRole("dialog")).toBeTruthy();
});
