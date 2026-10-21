// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import type { ApplicationAccountSetup } from "~/server/application-account-setup";
import { ApplicationAccountSetupButton } from "./application-account-setup";
import { ReadOnlyProvider } from "./read-only";

const fixture = vi.hoisted(() => {
  const response: {
    data: ApplicationAccountSetup | undefined;
    error: { message: string; data?: { code?: string } } | null;
  } = { data: undefined, error: null };
  return {
    ...response,
    fetching: false,
    query: vi.fn(),
    refetch: vi.fn<() => Promise<void>>(),
    copy: vi.fn<(code: string) => Promise<void>>(),
    export: vi.fn<(element: HTMLElement) => Promise<void>>(),
  };
});
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      applicationAccountSetup: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.query(input, options);
          return {
            data: fixture.data,
            error: fixture.error,
            isFetching: fixture.fetching,
            isSuccess: fixture.data !== undefined && !fixture.error,
            refetch: fixture.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("~/lib/download-card-image", () => ({
  downloadCardImage: (element: HTMLElement) => fixture.export(element),
}));

const active = (): ApplicationAccountSetup => ({
  state: "active",
  tutorId: "exact-tutor",
  account: null,
  invitation: {
    id: "exact-code",
    code: "ABCDE",
    expiresAt: new Date("2099-01-01"),
  },
});
const content = (readOnly = false, locale = "en", disabled = false) => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "zh" ? zh : en}
    timeZone="Asia/Shanghai"
  >
    <ReadOnlyProvider value={readOnly}>
      <ApplicationAccountSetupButton
        applicationId="exact-application"
        name="Exact Applicant"
        disabled={disabled}
      />
    </ReadOnlyProvider>
  </NextIntlClientProvider>
);
const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.applications.setupAccount }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  fixture.data = active();
  fixture.error = null;
  fixture.fetching = false;
  fixture.refetch.mockResolvedValue(undefined);
  fixture.copy.mockResolvedValue(undefined);
  fixture.export.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: fixture.copy },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("loads only on opening and reuses the existing code share card without a mutation", async () => {
  render(content());
  expect(fixture.query).not.toHaveBeenCalled();
  open();
  expect(fixture.query).toHaveBeenCalledWith(
    { applicationId: "exact-application" },
    { refetchOnMount: "always", staleTime: 0, gcTime: 0, retry: false },
  );
  expect(screen.getByText("ABCDE")).toBeTruthy();
  expect(
    screen.getByText(`Enter code at ${window.location.origin}/register`),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.applicationAccountSetup.openUser })
      .getAttribute("href"),
  ).toBe("/admin/users#tutor-exact-tutor");
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.registrationCodes.copy }),
  );
  await waitFor(() => expect(fixture.copy).toHaveBeenCalledWith("ABCDE"));
  expect(
    await screen.findByText(en.applicationAccountSetup.copied),
  ).toBeTruthy();
  expect(fixture.export).not.toHaveBeenCalled();
});

it("closes with Escape and restores the exact opener; reopening requests fresh status", async () => {
  render(content());
  const opener = screen.getByRole("button", {
    name: en.admin.applications.setupAccount,
  });
  opener.focus();
  open();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
  fixture.query.mockClear();
  fixture.data = {
    ...active(),
    state: "linked",
    invitation: null,
    account: { name: "Linked User", username: "linked-user" },
  };
  open();
  expect(fixture.query).toHaveBeenCalled();
  expect(screen.getByText(en.applicationAccountSetup.linked)).toBeTruthy();
  expect(screen.getByText("linked-user")).toBeTruthy();
  expect(screen.queryByText("ABCDE")).toBeNull();
});

it.each([
  "missing",
  "expired",
  "used",
  "conflict",
  "accountPending",
  "accountRestricted",
  "notEligible",
] as const)("explains %s without showing a shareable secret", (state) => {
  fixture.data = { state, tutorId: null, account: null, invitation: null };
  render(content());
  open();
  expect(screen.getByText(en.applicationAccountSetup[state])).toBeTruthy();
  expect(screen.queryByText("ABCDE")).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.admin.registrationCodes.copy }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.applicationAccountSetup.refresh }),
  );
  expect(fixture.refetch).toHaveBeenCalledTimes(1);
});

it("hides cached secrets during refresh and on failed reads, with read-only recovery", () => {
  const view = render(content());
  open();
  fixture.fetching = true;
  view.rerender(content());
  expect(screen.queryByText("ABCDE")).toBeNull();
  expect(screen.getByText(en.applicationAccountSetup.loading)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: en.applicationAccountSetup.refresh })
      .hasAttribute("disabled"),
  ).toBe(true);
  fixture.fetching = false;
  fixture.error = { message: "Private transport details" };
  view.rerender(content());
  expect(screen.getByText(en.applicationAccountSetup.error)).toBeTruthy();
  expect(screen.queryByText("ABCDE")).toBeNull();
  expect(screen.queryByText("Private transport details")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.applicationAccountSetup.refresh }),
  );
  expect(fixture.refetch).toHaveBeenCalledTimes(1);
  fixture.error = null;
  view.rerender(content());
  expect(screen.getByText("ABCDE")).toBeTruthy();
});

it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "conceals cached credentials after %s until a successful authorized read",
  (code) => {
    const view = render(content());
    open();
    fixture.error = { message: "Access denied", data: { code } };
    view.rerender(content());
    expect(screen.getByText(en.applicationAccountSetup.denied)).toBeTruthy();
    expect(screen.queryByText("ABCDE")).toBeNull();
    fixture.error = { message: "Network error" };
    view.rerender(content());
    expect(screen.getByText(en.applicationAccountSetup.denied)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    fixture.error = null;
    view.rerender(content());
    expect(screen.getByText("ABCDE")).toBeTruthy();
  },
);

it("does not expose the action to read-only observers or fetch through a blocked trigger", () => {
  const view = render(content(true));
  expect(screen.queryByRole("button")).toBeNull();
  expect(fixture.query).not.toHaveBeenCalled();
  view.rerender(content(false, "en", true));
  open();
  expect(fixture.query).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("explains clipboard failure without changing or reissuing the code", async () => {
  fixture.copy.mockRejectedValueOnce(new Error("Clipboard blocked"));
  render(content());
  open();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.registrationCodes.copy }),
  );
  expect(
    await screen.findByText(en.applicationAccountSetup.copyFailed),
  ).toBeTruthy();
  expect(screen.getByText("ABCDE")).toBeTruthy();
  expect(fixture.refetch).not.toHaveBeenCalled();
});

it("removes the active code and sharing controls when it expires in an open popup", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const data = active();
  data.invitation!.expiresAt = new Date(Date.now() + 100);
  fixture.data = data;
  render(content());
  open();
  expect(screen.getByText("ABCDE")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(102);
  });
  expect(screen.queryByText("ABCDE")).toBeNull();
  expect(screen.getByText(en.applicationAccountSetup.expired)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.admin.registrationCodes.copy }),
  ).toBeNull();
});

it("refuses copying after expiry even before a throttled timer has run", () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const start = Date.now();
  const data = active();
  data.invitation!.expiresAt = new Date(start + 100);
  fixture.data = data;
  render(content());
  open();
  vi.setSystemTime(start + 200);
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.registrationCodes.copy }),
  );
  expect(fixture.copy).not.toHaveBeenCalled();
  expect(screen.queryByText("ABCDE")).toBeNull();
  expect(screen.getByText(en.applicationAccountSetup.expired)).toBeTruthy();
});

it("renders the shared registration card and recovery actions in Chinese", () => {
  render(content(false, "zh"));
  fireEvent.click(
    screen.getByRole("button", { name: zh.admin.applications.setupAccount }),
  );
  expect(screen.getByText(zh.applicationAccountSetup.active)).toBeTruthy();
  expect(screen.getByText("ABCDE")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: zh.applicationAccountSetup.refresh }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: zh.common.close })).toBeTruthy();
});
