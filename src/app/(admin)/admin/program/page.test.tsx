/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey } from "~/lib/session-view-state";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import ProgramPage from "./page";
const mutate = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({
  query: "",
  replace: vi.fn(),
  denied: false,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace }),
}));
vi.mock("~/app/_components/program-captcha-settings", () => ({
  ProgramCaptchaSettings: () => null,
}));
vi.mock("~/app/_components/program-profile-settings", () => ({
  ProgramProfileSettings: () => null,
}));
vi.mock("~/app/_components/program-email-settings", () => ({
  ProgramEmailSettings: () => null,
}));
vi.mock("~/app/_components/program-time-zone-settings", () => ({
  ProgramTimeZoneSettings: () => null,
}));
vi.mock("~/app/_components/recruitment-settings", () => ({
  RecruitmentSettings: () => null,
}));
// This suite owns refresh confirmation. Relocated settings own separate query tests.
vi.mock("~/app/_components/program-calendar", () => ({
  ProgramCalendarSettings: () => null,
}));
vi.mock("~/app/_components/school-calendar", () => ({
  SchoolCalendar: () => null,
}));
vi.mock("~/app/_components/program-name-settings", () => ({
  ProgramNameSettings: () => null,
}));
vi.mock("~/app/_components/message-admin", () => ({
  MessagePermissions: () => null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () => ({
          data: { role: "HEAD" },
          error: navigation.denied ? { data: { code: "FORBIDDEN" } } : null,
        }),
      },
    },
    useUtils: () => ({ admin: { invalidate: vi.fn() } }),
    admin: {
      currentPeriod: {
        useQuery: () => ({
          data: {
            name: "Current",
            semester: 1,
            termId: "term-1",
            canEdit: true,
            canApply: true,
            recruitment: { tutee: {}, tutor: {} },
            next: { name: "Next", semester: 1 },
          },
        }),
      },
      refresh: { useMutation: () => ({ mutate, isPending: false }) },
    },
    program: {
      featureSettings: { useQuery: () => ({ data: undefined }) },
      setFeaturePending: { useMutation: () => ({}) },
    },
  },
}));
afterEach(() => {
  cleanup();
  mutate.mockReset();
  navigation.query = "";
  navigation.denied = false;
  navigation.replace.mockReset();
  sessionStorage.clear();
});
it.each(["en", "zh"] as const)(
  "associates the visible confirmation label in %s without changing typed confirmation",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ProgramPage />
      </NextIntlClientProvider>,
    );
    const input = screen.getByLabelText<HTMLInputElement>(
      messages.admin.program.confirmLabel,
    );
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: messages.admin.program.refreshButton.replace("{name}", "Next"),
    });
    expect(input.labels?.length).toBe(1);
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "REFRESH" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(mutate).toHaveBeenCalledWith({
      confirm: "REFRESH",
      expectedTermId: "term-1",
    });
  },
);

it("retains typed refresh confirmation across settings panels", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProgramPage />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText(en.admin.program.confirmLabel), {
    target: { value: "REFRESH" },
  });
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.communication }),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.period }),
  );
  expect(
    screen.getByLabelText<HTMLInputElement>(en.admin.program.confirmLabel)
      .value,
  ).toBe("REFRESH");
  expect(mutate).not.toHaveBeenCalled();
});

it("restores a panel on return, gives a validated URL precedence, and excludes confirmation drafts", () => {
  const key = viewStateKey(
    "head-account",
    "/admin/program",
    "program-panel-v1",
    "",
  );
  sessionStorage.setItem(key, JSON.stringify("access"));
  const page = () => (
    <SessionViewProvider
      identity="head-account"
      pathname="/admin/program"
      verified
    >
      <NextIntlClientProvider locale="en" messages={en}>
        <ProgramPage />
      </NextIntlClientProvider>
    </SessionViewProvider>
  );
  const first = render(page());
  expect(
    screen
      .getByRole("tab", { name: en.admin.program.panels.access })
      .getAttribute("aria-selected"),
  ).toBe("true");
  first.unmount();
  navigation.query = "panel=people";
  const second = render(page());
  expect(
    screen
      .getByRole("tab", { name: en.admin.program.panels.people })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.period }),
  );
  fireEvent.change(screen.getByLabelText(en.admin.program.confirmLabel), {
    target: { value: "REFRESH" },
  });
  expect(sessionStorage.getItem(key)).toBe(JSON.stringify("period"));
  second.unmount();
  navigation.query = "";
  render(page());
  expect(
    screen.getByLabelText<HTMLInputElement>(en.admin.program.confirmLabel)
      .value,
  ).toBe("");
});
it("clears remembered panel and hides cached settings on authoritative denial", () => {
  const key = viewStateKey(
    "head-account",
    "/admin/program",
    "program-panel-v1",
    "",
  );
  sessionStorage.setItem(key, JSON.stringify("people"));
  navigation.denied = true;
  render(
    <SessionViewProvider
      identity="head-account"
      pathname="/admin/program"
      verified
    >
      <NextIntlClientProvider locale="en" messages={en}>
        <ProgramPage />
      </NextIntlClientProvider>
    </SessionViewProvider>,
  );
  expect(screen.queryByRole("tab")).toBeNull();
  expect(sessionStorage.getItem(key)).toBeNull();
});
