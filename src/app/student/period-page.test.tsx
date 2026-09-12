/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StudentPage from "./page";
const state = vi.hoisted(() => ({ quarters: true }));
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
    expect(html).toContain('href="/signup"');
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
    expect(html).toContain('href="/signup"');
  },
);
