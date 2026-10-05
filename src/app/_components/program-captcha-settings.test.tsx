/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ProgramCaptchaSettings } from "./program-captcha-settings";

const mock = vi.hoisted(() => ({
  data: undefined as
    | undefined
    | { enabled: boolean; ready: boolean; canEdit: boolean; version: number },
  error: null as Error | null,
  fetching: false,
  pending: false,
  refetch: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      program: {
        captchaSettings: { invalidate: vi.fn() },
        captchaPublic: { invalidate: vi.fn() },
      },
    }),
    program: {
      captchaSettings: {
        useQuery: () => ({
          data: mock.data,
          error: mock.error,
          isFetching: mock.fetching,
          refetch: mock.refetch,
        }),
      },
      setCaptcha: {
        useMutation: () => ({ mutate: mock.mutate, isPending: mock.pending }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.data = undefined;
  mock.error = null;
  mock.fetching = false;
  mock.pending = false;
});
afterEach(cleanup);
function show(chinese = false) {
  return render(
    <NextIntlClientProvider
      locale={chinese ? "zh" : "en"}
      messages={chinese ? zh : en}
    >
      <ProgramCaptchaSettings />
    </NextIntlClientProvider>,
  );
}

it.each([false, true])(
  "announces initial failure without contradictory loading and offers retry (Chinese=%s)",
  (chinese) => {
    mock.error = new Error("CAPTCHA_UNAVAILABLE");
    const messages = chinese ? zh : en;
    show(chinese);
    expect(screen.queryByText(messages.captcha.loading)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      messages.uiPatterns.loadFailed,
    );
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: messages.captcha.retry }),
    );
    expect(mock.refetch).toHaveBeenCalledOnce();
  },
);

it("shows loading alone until the first response", () => {
  show();
  expect(screen.getByRole("status").textContent).toBe(en.captcha.loading);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("preserves cached state and version on refetch failure", () => {
  mock.data = { enabled: true, ready: true, canEdit: true, version: 7 };
  mock.error = new Error("CAPTCHA_UNAVAILABLE");
  show();
  const toggle = screen.getByRole<HTMLButtonElement>("switch", {
    name: en.captcha.title,
  });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(toggle.tagName).toBe("BUTTON");
  expect(toggle.type).toBe("button");
  expect(toggle.tabIndex).toBe(0);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.queryByText(en.captcha.loading)).toBeNull();
  fireEvent.click(toggle);
  expect(mock.mutate).toHaveBeenCalledWith({
    enabled: false,
    expectedVersion: 7,
  });
});

it("preserves readiness and edit permission gates", () => {
  mock.data = { enabled: false, ready: false, canEdit: true, version: 8 };
  const view = show();
  const toggle = screen.getByRole<HTMLButtonElement>("switch");
  expect(toggle.disabled).toBe(true);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle);
  view.unmount();
  mock.data.canEdit = false;
  show();
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByText(en.captcha.readOnly)).toBeTruthy();
  expect(mock.mutate).not.toHaveBeenCalled();
});

it("locks the native switch during a pending write without sending another change", () => {
  mock.data = { enabled: false, ready: true, canEdit: true, version: 9 };
  mock.pending = true;
  show();
  const toggle = screen.getByRole<HTMLButtonElement>("switch", {
    name: en.captcha.title,
  });
  expect(toggle.tagName).toBe("BUTTON");
  expect(toggle.disabled).toBe(true);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle);
  expect(mock.mutate).not.toHaveBeenCalled();
});

it.each([
  { enabled: false, ready: true, next: true },
  { enabled: true, ready: false, next: false },
])(
  "sends the exact current version when enabled=$enabled and ready=$ready",
  ({ enabled, ready, next }) => {
    mock.data = { enabled, ready, canEdit: true, version: 10 };
    show();
    const toggle = screen.getByRole<HTMLButtonElement>("switch", {
      name: en.captcha.title,
    });
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    expect(mock.mutate).toHaveBeenCalledWith({
      enabled: next,
      expectedVersion: 10,
    });
    // Saved state stays server-owned; clicking never announces optimistic success.
    expect(toggle.getAttribute("aria-checked")).toBe(String(enabled));
  },
);
