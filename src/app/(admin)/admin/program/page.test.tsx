/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey } from "~/lib/session-view-state";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const access = vi.hoisted(() => ({
  role: "HEAD",
  readOnly: false,
  known: true,
  error: null as Error | null,
  refetch: vi.fn(),
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
vi.mock("~/app/_components/next-recruitment-settings", () => ({
  NextRecruitmentSettings: access.privateChild,
  NextRecruitmentError: ({ message }: { message: string }) => message,
}));
const target = { sourceTermId: "term-1", sourceSchoolYear: "26-27", sourceQuarter: "Q1", destinationSchoolYear: "26-27", destinationQuarter: "Q2", semesterMode: false, modeRevision: 0 };
const nextRecruitment = { canEdit: true, canApply: true, target, currentName: "Current", nextName: "Next", timeZone: "Asia/Shanghai", preparations: { tutor: null, tutee: null }, refreshEvidence: { target, timeZone: "Asia/Shanghai", preparations: { tutor: null, tutee: null }, destination: null } };
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
    account: {
      me: {
        useQuery: () => ({
          data: access.known ? { role: access.role } : undefined,
          error: navigation.denied
            ? { data: { code: "FORBIDDEN" } }
            : access.error,
          refetch: access.refetch,
        }),
      },
    },
    useUtils: () => ({ admin: { currentPeriod: { cancel: vi.fn().mockResolvedValue(undefined), fetch: vi.fn().mockResolvedValue({ termId: "term-2", schoolYear: "26-27", quarter: "Q2", recruitment: { tutor: {}, tutee: {} } }) } }, program: { nextRecruitment: { cancel: vi.fn().mockResolvedValue(undefined), fetch: vi.fn().mockResolvedValue({ ...nextRecruitment, target: { ...target, sourceTermId: "term-2" } }) } } }),
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
      refresh: { useMutation: () => ({ mutateAsync: mutate, isPending: false }) },
    },
    program: {
      nextRecruitment: { useQuery: () => ({ data: nextRecruitment, refetch: vi.fn() }) },
      featureSettings: { useQuery: () => ({ data: undefined }) },
      setFeaturePending: { useMutation: () => ({}) },
    },
  },
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  mutate.mockResolvedValue({ name: "Next", archivedTutees: 0, graduatedTutors: 0, agedTutors: 0, pendingTutors: 0 });
  access.known = true;
  access.error = null;
  access.refetch.mockClear();
  access.role = "HEAD";
  access.readOnly = false;
  access.privateChild.mockClear();
});
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
  async (locale) => {
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
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: messages.admin.program.refreshButton.replace("{name}", "Next") }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({
      confirm: "REFRESH",
      expectedTermId: "term-1",
      expectedPreparation: nextRecruitment.refreshEvidence,
    }));
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
    expect(screen.queryByRole<HTMLButtonElement>("button", {
      name: en.approvals.requestHead,
    })).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  },
);
it.each(["people", "communication", "access"] as const)(
  "explains denied %s settings without starting private reads",
  (panel) => {
    access.role = "VIEWER";
    access.readOnly = true;
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProgramPage />
      </NextIntlClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.program.panels[panel] }),
    );
    expect(
      screen.getByRole("heading", {
        name: en.managementRecovery.denied.replace(
          "{section}",
          en.admin.program.panels[panel],
        ),
      }),
    ).toBeTruthy();
    expect(access.privateChild).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  },
);
it("distinguishes unknown identity loading from denied settings and retains read recovery", () => {
  access.known = false;
  const tree = (
    <NextIntlClientProvider locale="en" messages={en}>
      <ProgramPage />
    </NextIntlClientProvider>
  );
  const view = render(tree);
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.people }),
  );
  expect(
    screen.getByRole("heading", {
      name: en.managementRecovery.loading.replace(
        "{section}",
        en.admin.program.panels.people,
      ),
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: /no longer have access/ }),
  ).toBeNull();
  access.error = new Error("Identity unavailable");
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProgramPage />
    </NextIntlClientProvider>,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    en.managementRecovery.loadFailed.replace(
      "{section}",
      en.admin.program.panels.people,
    ),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: en.managementRecovery.retry.replace(
        "{section}",
        en.admin.program.panels.people,
      ),
    }),
  );
  expect(access.refetch).toHaveBeenCalledTimes(1);
  expect(access.privateChild).not.toHaveBeenCalled();
});
