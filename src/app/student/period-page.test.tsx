/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StudentPage from "./page";
import { tuteeViews } from "./views";
const state = vi.hoisted(() => ({ quarters: true, departed: false }));
const mocks = vi.hoisted(() => ({
  restriction: vi.fn(),
  workspace: vi.fn((_props: unknown) => null),
  transaction: vi.fn(),
}));
vi.mock("~/server/auth", () => ({
  auth: async () => ({ user: { id: "student" } }),
}));
vi.mock("~/server/portal-access", () => ({
  accountPortalAccess: async () => ({ departed: state.departed }),
}));
vi.mock("~/server/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("~/server/student-intake-restriction", () => ({
  readStudentSignupRestriction: mocks.restriction,
}));
vi.mock("~/server/period", () => ({
  getActivePeriodOrNull: async () => ({
    termId: "current-term",
    schoolYear: "26-27",
    quarter: "Q3",
  }),
}));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ QUARTER_SYSTEM: state.quarters }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));
vi.mock("~/app/_components/school-departure", () => ({
  DepartureBanner: () => null,
}));
vi.mock("./navigation", () => ({
  TuteeNavigation: ({ flush }: { flush?: boolean }) => (
    <nav aria-label="Tutee navigation" data-flush={String(Boolean(flush))} />
  ),
}));
vi.mock("./tutee-overview", () => ({ TuteeOverview: () => null }));
vi.mock("./legacy-participation", () => ({ LegacyParticipation: () => null }));
vi.mock("./legacy-continuation", () => ({
  LegacyContinuation: () => <section data-testid="continuation" />,
}));
vi.mock("./student-workspace", () => ({ StudentWorkspace: mocks.workspace }));
vi.mock("./signup-restriction", () => ({
  StudentSignupRestrictionProvider: ({ children }: { children: ReactNode }) =>
    children,
  StudentSignupRestrictionFeedback: () => null,
  StudentSignupAction: ({
    initiallyBlocked,
    departed,
  }: {
    initiallyBlocked: boolean;
    departed: boolean;
  }) =>
    initiallyBlocked || departed ? null : <a href="/tutee">requestTutor</a>,
}));
vi.mock("~/app/_components/student-portal", () => ({
  StudentPortal: () => null,
}));
vi.mock("~/app/_components/message-inbox", () => ({
  MessageInbox: () => <section data-testid="inbox" />,
}));
vi.mock("~/app/_components/account-settings", () => ({
  AccountSettings: ({ embedded }: { embedded?: boolean }) => (
    <section data-testid="settings" data-embedded={embedded} />
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.quarters = true;
  state.departed = false;
  mocks.transaction.mockImplementation(
    async (work: (tx: object) => Promise<unknown>) => work({}),
  );
  mocks.restriction.mockResolvedValue({
    blocked: false,
    canOpenWorkspace: true,
  });
});
it.each([true, false])(
  "labels the tutee workspace using the applied period mode (%s)",
  async (quarters) => {
    state.quarters = quarters;
    const html = renderToStaticMarkup(
      await StudentPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain(
      quarters ? "quarter 2026–27 Q3" : "semester 2026–27 S2",
    );
    expect(html).toContain('href="/tutee"');
    const headingIdx = html.indexOf("<h1");
    const navIdx = html.indexOf('aria-label="Tutee navigation"');
    expect(headingIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeGreaterThan(headingIdx);
    expect(html).toContain('data-flush="true"');
  },
);
it.each([false, true])(
  "keeps exactly the eligible route-owned intake action (departed=%s)",
  async (departed) => {
    state.departed = departed;
    try {
      const html = renderToStaticMarkup(
        await StudentPage({
          searchParams: Promise.resolve({ view: "dashboard" }),
        }),
      );
      expect(html.match(/href="\/tutee"/g) ?? []).toHaveLength(
        departed ? 0 : 1,
      );
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html.includes('data-testid="continuation"')).toBe(!departed);
    } finally {
      state.departed = false;
    }
  },
);
it.each(["messages", "account"])(
  "renders the %s controls in the focused workspace",
  async (view) => {
    const html = renderToStaticMarkup(
      await StudentPage({ searchParams: Promise.resolve({ view }) }),
    );
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(
      view === "messages"
        ? 'data-testid="inbox"'
        : 'data-testid="settings" data-embedded="true"',
    );
    expect(html).not.toContain(
      view === "messages" ? 'data-testid="settings"' : 'data-testid="inbox"',
    );
    if (view === "account") expect(html).not.toContain('href="/tutee"');
    else expect(html).toContain('href="/tutee"');
  },
);

it.each(tuteeViews)(
  "hides the restricted signup entry on the %s view",
  async (view) => {
    mocks.restriction.mockResolvedValueOnce({
      blocked: true,
      canOpenWorkspace: true,
    });
    const html = renderToStaticMarkup(
      await StudentPage({ searchParams: Promise.resolve({ view }) }),
    );
    expect(html).not.toContain('href="/tutee"');
    expect(mocks.restriction).toHaveBeenCalledWith(
      expect.anything(),
      "current-term",
      "student",
    );
    if (view === "requests")
      expect(mocks.workspace.mock.calls[0]?.[0]).toMatchObject({
        quarterBlocked: true,
      });
  },
);

it("uses a fresh restriction after a sibling approval and shares the flag with the request workspace", async () => {
  const input = () => ({ searchParams: Promise.resolve({ view: "requests" }) });
  expect(renderToStaticMarkup(await StudentPage(input()))).toContain(
    'href="/tutee"',
  );
  mocks.restriction.mockResolvedValueOnce({
    blocked: true,
    canOpenWorkspace: true,
  });
  expect(renderToStaticMarkup(await StudentPage(input()))).not.toContain(
    'href="/tutee"',
  );
  expect(mocks.workspace.mock.calls.at(-1)?.[0]).toMatchObject({
    quarterBlocked: true,
  });
});

it("does not render an eligible entry when the restriction cannot be read", async () => {
  const error = new Error("Synthetic restriction read unavailable");
  mocks.restriction.mockRejectedValueOnce(error);
  await expect(StudentPage({ searchParams: Promise.resolve({}) })).rejects.toBe(
    error,
  );
});

it("binds the period and restriction in a consistent read snapshot without the writer barrier", async () => {
  await StudentPage({ searchParams: Promise.resolve({}) });
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
    timeout: 20000,
    isolationLevel: "RepeatableRead",
  });
});
