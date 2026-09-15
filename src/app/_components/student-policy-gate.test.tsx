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
// jsdom has no layout. Model the policy viewport explicitly; observer callbacks
// let tests exercise real layout changes without timers or a browser process.
let viewportHeight = 400;
let documentHeight = 200;
let resizeCallbacks: (() => void)[] = [];
const disconnect = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  mocks.path = "/student";
  mocks.search = "";
  mocks.locale = "en";
  mocks.error = null;
  viewportHeight = 400;
  documentHeight = 200;
  resizeCallbacks = [];
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => viewportHeight,
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    () => documentHeight,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["tutor-policy", "tutee-policy"])(
  "%s requires reaching the policy bottom and explicit agreement before acceptance",
  async (slug) => {
    documentHeight = 1200;
    mocks.status.mockReturnValue({
      data: { ...policy(), slug },
      refetch: mocks.refetch,
    });
    render(<StudentPolicyGate />);
    const region = screen.getByRole("region", { name: "English rules" });
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox");
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(false);
    expect(screen.getByText("policyAgree").className).toContain(
      "text-slate-400",
    );
    expect(checkbox.getAttribute("aria-describedby")).toBe(
      screen.getByText("policyScrollHint").id,
    );
    expect(region.tabIndex).toBe(0);
    fireEvent.click(screen.getByText("policyAgree"));
    fireEvent.click(checkbox);
    fireEvent.keyDown(checkbox, { key: " " });
    expect(checkbox.checked).toBe(false);
    // Neither scrolling the surrounding dialog nor waiting out the timer unlocks consent.
    fireEvent.scroll(screen.getByRole("dialog"), {
      target: { scrollTop: 1200 },
    });
    await act(() => vi.advanceTimersByTime(10000));
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    expect(mocks.accept).not.toHaveBeenCalled();
    fireEvent.scroll(region, { target: { scrollTop: 790 } });
    expect(checkbox.disabled).toBe(true);
    // Fractional measurements just above the end must not strand the reader.
    fireEvent.scroll(region, { target: { scrollTop: 797.5 } });
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(false);
    expect(screen.queryByText("policyScrollHint")).toBeNull();
    expect(screen.getByText("policyAgree").className).toContain(
      "text-slate-900",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "confirm" })
        .disabled,
    ).toBe(true);
    fireEvent.scroll(region, { target: { scrollTop: 0 } });
    expect(checkbox.disabled).toBe(false);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith({
      slug,
      revision: "current",
      agreed: true,
      ticket: "ticket",
    });
  },
);

it("unlocks visible short policies and observes viewport/content resizing, with cleanup", () => {
  viewportHeight = 0;
  const view = render(<StudentPolicyGate />);
  expect(screen.getByRole<HTMLInputElement>("checkbox").disabled).toBe(true);
  viewportHeight = 100;
  act(() => resizeCallbacks.forEach((callback) => callback()));
  expect(screen.getByRole<HTMLInputElement>("checkbox").disabled).toBe(true);
  viewportHeight = 400;
  act(() => resizeCallbacks.forEach((callback) => callback()));
  expect(screen.getByRole<HTMLInputElement>("checkbox").disabled).toBe(false);
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it.each(["slug", "revision", "locale", "body"])(
  "resets read and agreement state when %s changes",
  (change) => {
    documentHeight = 1200;
    const view = render(<StudentPolicyGate />);
    fireEvent.scroll(screen.getByRole("region"), {
      target: { scrollTop: 800 },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    const replacement = policy();
    if (change === "slug") replacement.slug = "tutor-policy";
    if (change === "revision") replacement.revision = "newer";
    if (change === "locale") mocks.locale = "zh";
    if (change === "body")
      replacement.documents[0]!.body = "Replaced policy content";
    mocks.status.mockReturnValue({ data: replacement, refetch: mocks.refetch });
    view.rerender(<StudentPolicyGate />);
    expect(screen.getByRole<HTMLInputElement>("checkbox").disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(mocks.accept).not.toHaveBeenCalled();
  },
);

it("preserves a review on unchanged refetch, but resets it on retry and dismissal", async () => {
  documentHeight = 1200;
  const view = render(<StudentPolicyGate />);
  fireEvent.scroll(screen.getByRole("region"), { target: { scrollTop: 800 } });
  fireEvent.click(screen.getByRole("checkbox"));
  mocks.status.mockReturnValue({ data: policy(), refetch: mocks.refetch });
  view.rerender(<StudentPolicyGate />);
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(screen.getByRole<HTMLInputElement>("checkbox").disabled).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  fireEvent.scroll(screen.getByRole("region"), { target: { scrollTop: 800 } });
  expect(screen.getByRole<HTMLInputElement>("checkbox").disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "policyTitle" }));
  expect(screen.getByRole<HTMLInputElement>("checkbox").disabled).toBe(true);
  await act(() => vi.advanceTimersByTime(10000));
  fireEvent.click(screen.getByRole("button", { name: "confirm" }));
  expect(mocks.accept).not.toHaveBeenCalled();
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
