/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import ProgramPage from "./page";
const mutate = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => ({
  role: "HEAD",
  readOnly: false,
  privateChild: vi.fn(() => null),
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => access.readOnly,
}));
vi.mock("~/app/_components/program-captcha-settings", () => ({
  ProgramCaptchaSettings: access.privateChild,
}));
vi.mock("~/app/_components/program-profile-settings", () => ({
  ProgramProfileSettings: access.privateChild,
}));
vi.mock("~/app/_components/program-email-settings", () => ({
  ProgramEmailSettings: access.privateChild,
}));
vi.mock("~/app/_components/program-time-zone-settings", () => ({
  ProgramTimeZoneSettings: access.privateChild,
}));
vi.mock("~/app/_components/recruitment-settings", () => ({
  RecruitmentSettings: () => null,
}));
// This suite owns refresh confirmation. Relocated settings own separate query tests.
vi.mock("~/app/_components/program-calendar", () => ({
  ProgramCalendarSettings: access.privateChild,
}));
vi.mock("~/app/_components/school-calendar", () => ({
  SchoolCalendar: access.privateChild,
}));
vi.mock("~/app/_components/program-name-settings", () => ({
  ProgramNameSettings: access.privateChild,
}));
vi.mock("~/app/_components/message-admin", () => ({
  MessagePermissions: access.privateChild,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: { me: { useQuery: () => ({ data: { role: access.role } }) } },
    useUtils: () => ({ admin: { invalidate: vi.fn() } }),
    admin: {
      currentPeriod: {
        useQuery: () => ({
          data: {
            name: "Current",
            semester: 1,
            termId: "term-1",
            canEdit:
              ["HEAD", "ADMIN"].includes(access.role) && !access.readOnly,
            canApply: access.role === "HEAD" && !access.readOnly,
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
beforeEach(() => {
  access.role = "HEAD";
  access.readOnly = false;
  access.privateChild.mockClear();
});
afterEach(() => {
  cleanup();
  mutate.mockReset();
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
it.each(["VIEWER", "departed HEAD"])(
  "keeps public period values readable without mounting private settings for %s",
  (role) => {
    access.role = role === "departed HEAD" ? "HEAD" : role;
    access.readOnly = true;
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProgramPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Current")).toBeTruthy();
    expect(access.privateChild).not.toHaveBeenCalled();
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: en.approvals.requestHead,
    });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mutate).not.toHaveBeenCalled();
  },
);
