/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import en from "../../../../../messages/en.json";
import ProgramPage from "./page";

type PeriodFixture = {
  termId: string;
  name: string;
  semester: number;
  canEdit: boolean;
  canApply: boolean;
  recruitment: { tutor: Record<string, never>; tutee: Record<string, never> };
  next: { name: string; semester: number };
};
type Activation = {
  identity: string;
  callback: (period: PeriodFixture) => void;
};
const fixture = vi.hoisted(() => ({
  accountId: "synthetic-account-a",
  accountError: null as Error | null,
  period: undefined as PeriodFixture | undefined,
  activations: [] as Activation[],
  replace: vi.fn(),
  refetchAccount: vi.fn(),
  refetchPeriod: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("panel=period"),
  useRouter: () => ({ replace: fixture.replace }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () => ({
          data: { id: fixture.accountId, role: "HEAD" },
          error: fixture.accountError,
          isSuccess: !fixture.accountError,
          status: fixture.accountError ? "error" : "success",
          isFetching: false,
          refetch: fixture.refetchAccount,
        }),
      },
    },
    admin: {
      currentPeriod: {
        useQuery: () => ({
          data: fixture.period,
          error: null,
          isSuccess: true,
          status: "success",
          isFetching: false,
          refetch: fixture.refetchPeriod,
        }),
      },
    },
  },
}));

// These inert child fixtures expose only activation ownership. They perform no
// write, read synchronization or DB access; real Refresh receipt/admission
// behavior is covered by page.account-recovery.test.tsx's transport fixture.
vi.mock("~/app/_components/program-refresh", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    ProgramRefresh: function ActivationCapture({
      onActivated,
    }: {
      onActivated: (period: PeriodFixture) => void;
    }) {
      const identity = fixture.accountId;
      useLayoutEffect(() => {
        fixture.activations.push({ identity, callback: onActivated });
      }, [identity, onActivated]);
      return null;
    },
  };
});
vi.mock("~/app/_components/recruitment-settings", () => ({
  RecruitmentSettings: ({
    audience,
    termId,
  }: {
    audience: "tutor" | "tutee";
    termId: string;
  }) => (
    <output aria-label={`Synthetic ${audience} recruitment term`}>
      {termId}
    </output>
  ),
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
vi.mock("~/app/_components/program-public-qr-links", () => ({
  ProgramPublicQrLinks: () => null,
}));
vi.mock("~/app/_components/next-recruitment-settings", () => ({
  NextRecruitmentSettings: () => null,
}));
vi.mock("~/app/_components/school-calendar", () => ({
  SchoolCalendar: () => null,
}));
vi.mock("~/app/_components/program-calendar", () => ({
  ProgramCalendarSettings: () => null,
}));
vi.mock("~/app/_components/program-name-settings", () => ({
  ProgramNameSettings: () => null,
}));
vi.mock("~/app/_components/message-admin", () => ({
  MessagePermissions: () => null,
}));
vi.mock("~/app/_components/program-feature-settings", () => ({
  FeatureToggles: () => null,
}));

function period(termId: string): PeriodFixture {
  return {
    termId,
    name: `Synthetic ${termId}`,
    semester: 1,
    canEdit: true,
    canApply: true,
    recruitment: { tutor: {}, tutee: {} },
    next: { name: "Synthetic next period", semester: 1 },
  };
}
function tree() {
  return (
    <SessionViewProvider
      identity={fixture.accountId}
      pathname="/admin/program"
      verified
    >
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <ProgramPage />
      </NextIntlClientProvider>
    </SessionViewProvider>
  );
}
function expectRecruitmentTerm(termId: string) {
  for (const audience of ["tutor", "tutee"]) {
    expect(
      screen.getByLabelText(`Synthetic ${audience} recruitment term`)
        .textContent,
    ).toBe(termId);
  }
}
function latestActivation(identity: string) {
  const activation = fixture.activations
    .filter((entry) => entry.identity === identity)
    .at(-1);
  expect(activation).toBeDefined();
  return activation!.callback;
}

beforeEach(() => {
  fixture.accountId = "synthetic-account-a";
  fixture.accountError = null;
  fixture.period = period("T1");
  fixture.activations = [];
  vi.clearAllMocks();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

it("retains an identity's accepted activation through ordinary account failure and permanently retires it on replacement", () => {
  const view = render(tree());
  expectRecruitmentTerm("T1");
  const retiredA = latestActivation("synthetic-account-a");
  act(() => retiredA(period("T2")));
  expectRecruitmentTerm("T2");

  fixture.accountError = new Error("Synthetic account 500");
  view.rerender(tree());
  expectRecruitmentTerm("T2");

  fixture.accountId = "synthetic-account-b";
  fixture.accountError = null;
  fixture.period = period("T3");
  view.rerender(tree());
  expectRecruitmentTerm("T3");
  const retiredB = latestActivation("synthetic-account-b");
  act(() => retiredA(period("late-A")));
  expectRecruitmentTerm("T3");

  fixture.accountId = "synthetic-account-a";
  view.rerender(tree());
  expectRecruitmentTerm("T3");
  act(() => retiredB(period("late-B")));
  expectRecruitmentTerm("T3");
  act(() => retiredA(period("T2")));
  expectRecruitmentTerm("T3");
});
