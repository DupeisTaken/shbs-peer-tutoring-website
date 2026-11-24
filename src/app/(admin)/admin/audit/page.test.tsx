/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import chineseMessages from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import type { UndoData } from "~/server/audit/record";
import AuditPage from "./page";

const state = vi.hoisted(() => ({
  undone: false,
  undoData: null as UndoData | null,
  approvalId: null as string | null,
  operation: null as string | null,
  entity: "TutorApplication",
  action: "Management action",
  undo: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/app/_components/audit-filters", () => ({
  AuditFilters: () => null,
  emptyAuditView: {
    userId: "",
    kind: "",
    operation: "",
    entity: "",
    search: "",
    from: "",
    until: "",
  },
  hasAuditFilterOptions: (value: unknown) =>
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { users?: unknown }).users) &&
    Array.isArray((value as { operations?: unknown }).operations) &&
    Array.isArray((value as { entities?: unknown }).entities),
}));
vi.mock("~/app/_components/audit-event-details", () => ({
  AuditEventDetails: ({ id }: { id: string }) => (
    <div>Private evidence for {id}</div>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { auditLog: { invalidate: vi.fn() } } }),
    admin: {
      auditFilterOptions: {
        useQuery: () => ({ data: { users: [], operations: [], entities: [] } }),
      },
      undoAudit: {
        useMutation: () => ({ mutate: state.undo, isPending: false }),
      },
      auditLog: {
        useQuery: () => ({
          data: [
            {
              id: "event-1",
              createdAt: new Date("2026-10-09T01:02:03Z"),
              userName: "Recorded actor",
              action: state.action,
              entity: state.entity,
              operation: state.operation,
              kind: "ACTION",
              undone: state.undone,
              details: null,
              undoData: state.undoData,
              approvalId: state.approvalId,
            },
          ],
        }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  state.undone = false;
  state.undoData = null;
  state.approvalId = null;
  state.operation = null;
  state.entity = "TutorApplication";
  state.action = "Management action";
  vi.clearAllMocks();
});

function mount(readOnly = false, locale: "en" | "zh" = "en") {
  const catalog = locale === "en" ? messages : chineseMessages;
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={catalog}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <AuditPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
  return catalog;
}

// These valid legacy payloads describe undo instructions, not RecoveryAction IDs.
const legacyEvents = [
  {
    label: "announcement deletion with no recorded operation or approval",
    action: 'Deleted announcement "Synthetic inactive announcement"',
    entity: "Announcement",
    operation: null,
    undoData: {
      kind: "announcement.restore",
      payload: {
        id: "announcement-1",
        title: "Synthetic inactive announcement",
        body: "Synthetic announcement body",
        pinned: false,
        active: false,
        createdById: "actor-1",
        createdAt: "2026-10-09T01:02:03.000Z",
        audienceRestricted: false,
        recipientTutorIds: [],
        acks: [],
      },
    },
  },
  {
    label: "subject deletion",
    action: 'Deleted subject "Synthetic subject"',
    entity: "Subject",
    operation: "admin.deleteSubject",
    undoData: {
      kind: "subject.restore",
      payload: {
        id: "subject-1",
        name: "Synthetic subject",
        levelId: null,
        active: true,
      },
    },
  },
  {
    label: "application status change",
    action: "Changed application status",
    entity: "TutorApplication",
    operation: "tutor.decide",
    undoData: {
      kind: "application.status",
      payload: { id: "application-1", status: "INTERVIEW" },
    },
  },
] satisfies Array<{
  label: string;
  action: string;
  entity: string;
  operation: string | null;
  undoData: UndoData;
}>;

for (const locale of ["en", "zh"] as const) {
  it.each(legacyEvents)(
    `keeps the ${locale} $label readable without suggesting unsupported recovery`,
    (event) => {
      state.entity = event.entity;
      state.action = event.action;
      state.operation = event.operation;
      state.undoData = event.undoData;
      const catalog = mount(false, locale);
      const row = screen.getByText("Recorded actor").closest("tr")!;
      expect(within(row).queryByRole("link")).toBeNull();
      expect(
        screen.queryByRole("button", { name: catalog.admin.audit.undo }),
      ).toBeNull();
      fireEvent.click(within(row).getByRole("button"));
      expect(screen.getByText("Private evidence for event-1")).toBeTruthy();
      expect(state.undo).not.toHaveBeenCalled();
    },
  );

  it(`preserves the ${locale} related request link for a legacy announcement event`, () => {
    state.entity = "Announcement";
    state.action = legacyEvents[0]!.action;
    state.undoData = legacyEvents[0]!.undoData;
    state.approvalId = "approval-1";
    const catalog = mount(false, locale);
    const row = screen.getByText("Recorded actor").closest("tr")!;
    const links = within(row).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe(catalog.approvals.viewRequest);
    expect(links[0]?.getAttribute("href")).toBe(
      "/admin/approvals?request=approval-1",
    );
    expect(state.undo).not.toHaveBeenCalled();
  });
}

it("mounts staff evidence only while the selected event dialog is open", () => {
  mount();
  expect(screen.queryByText("Private evidence for event-1")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /View details:/ }));
  expect(screen.getByText("Private evidence for event-1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByText("Private evidence for event-1")).toBeNull();
});

it("keeps undone records and their detail reader available without an inherited opacity", () => {
  state.undone = true;
  state.undoData = legacyEvents[0]!.undoData;
  mount();
  const row = screen.getByText("Recorded actor").closest("tr")!;
  expect(row.className).toContain("bg-slate-50");
  expect(row.className).not.toMatch(/opacity-/);
  expect(within(row).queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /View details:/ }));
  expect(screen.getByText("Private evidence for event-1")).toBeTruthy();
});

it("keeps observer dialogs on the projected summary without mounting staff evidence", () => {
  state.undoData = legacyEvents[0]!.undoData;
  state.approvalId = "approval-1";
  mount(true);
  expect(screen.queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /View details:/ }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByText("Private evidence for event-1")).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});
