/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StudentPage from "./page";
const state = vi.hoisted(() => ({ quarters: true, departed: false }));
vi.mock("~/server/auth", () => ({
  auth: async () => ({ user: { id: "student" } }),
}));
vi.mock("~/server/portal-access", () => ({
  accountPortalAccess: async () => ({ departed: state.departed }),
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/period", () => ({
  getActivePeriodOrNull: async () => ({ schoolYear: "26-27", quarter: "Q3" }),
}));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ QUARTER_SYSTEM: state.quarters }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { period: string }) =>
    values ? key + " " + values.period : key,
}));
vi.mock("./tutee-overview", () => ({ TuteeOverview: () => null }));
vi.mock("./legacy-participation", () => ({ LegacyParticipation: () => null }));
vi.mock("./legacy-continuation", () => ({
  LegacyContinuation: () => <section data-testid="continuation" />,
}));
vi.mock("./student-workspace", () => ({ StudentWorkspace: () => null }));
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
    expect(html).toContain('href="/tutee"');
  },
);
