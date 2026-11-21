/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import de from "../../../../../messages/de.json";
import el from "../../../../../messages/el.json";
import en from "../../../../../messages/en.json";
import es from "../../../../../messages/es.json";
import fr from "../../../../../messages/fr.json";
import ja from "../../../../../messages/ja.json";
import ko from "../../../../../messages/ko.json";
import zh from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import AuditPage from "./page";
import type * as AuditFiltersModule from "~/app/_components/audit-filters";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  undo: vi.fn(),
  entry: {
    createdAt: new Date("2026-10-09T01:02:03Z"),
    userName: "Recorded actor",
    kind: "ACTION",
    action: "Management action",
    operation: null as string | null,
    entity: null as string | null,
    approvalId: null as string | null,
    undoData: null as object | null,
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/app/_components/audit-filters", async (importOriginal) => ({
  // The integrated page uses the editor's pure defaults/parsers; skip only its
  // UI so the actual immutable reader and its authorization checks stay real.
  ...(await importOriginal<typeof AuditFiltersModule>()),
  AuditFilters: () => null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { auditLog: { invalidate: vi.fn() } } }),
    admin: {
      auditFilterOptions: {
        useQuery: () => ({
          data: { users: [], operations: [], entities: [] },
          isSuccess: true,
          isFetching: false,
        }),
      },
      auditLog: {
        useQuery: () => ({
          isSuccess: true,
          isFetching: false,
          data: [
            {
              id: "event-1",
              ...mocks.entry,
              undone: false,
            },
          ],
        }),
      },
      auditLogDetail: {
        useQuery: mocks.detail,
        _def: () => ({ path: ["admin", "auditLogDetail"] }),
      },
      undoAudit: {
        useMutation: () => ({ mutate: mocks.undo, isPending: false }),
      },
    },
  },
}));

// Use the actual feature reader and shared dialog: a stub would miss both the
// long JSON disclosure and accidentally eager private queries for observers.
const evidence = {
  entity: "TutorMeeting",
  write: "updateMany",
  affectedCount: 1,
  changes: [
    {
      before: { status: "PRESENT", note: "Original recorded note" },
      after: {
        status: "EXCUSED_ABSENT",
        note: "Recorded evidence line\n".repeat(150),
      },
    },
  ],
};
let client: QueryClient;
beforeEach(() => {
  sessionStorage.clear();
  Object.assign(mocks.entry, {
    createdAt: new Date("2026-10-09T01:02:03Z"),
    userName: "Recorded actor",
    kind: "ACTION",
    action: "Management action",
    operation: null,
    entity: null,
    approvalId: null,
    undoData: null,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.detail.mockReturnValue({
    data: {
      id: "event-1",
      userId: "actor-1",
      userName: "Recorded actor",
      kind: "ACTION",
      action: "Management action",
      operation: "meetings.attendance",
      entity: "TutorMeeting",
      entityId: "meeting-1",
      createdAt: new Date("2026-10-09T01:02:03Z"),
      approvalId: null,
      details: evidence,
      undone: false,
      undoneAt: null,
      undoData: { private: "executable undo instructions" },
    },
    isFetching: false,
    refetch: vi.fn(),
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

const catalogs = { de, el, en, es, fr, ja, ko, zh };

function mount(locale: keyof typeof catalogs, readOnly = false) {
  const messages = catalogs[locale];
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <SessionViewProvider
          identity={readOnly ? "synthetic-viewer" : "synthetic-head"}
          pathname="/admin/audit"
          verified
        >
          <ReadOnlyProvider value={readOnly}>
            <AuditPage />
          </ReadOnlyProvider>
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return messages;
}

it.each(Object.keys(catalogs) as (keyof typeof catalogs)[])(
  "distinguishes recorded operations from row controls in the %s audit table",
  (locale) => {
    const messages = mount(locale);
    const headers = within(screen.getByRole("table")).getAllByRole(
      "columnheader",
    );
    expect(headers).toHaveLength(5);
    expect(headers[3]!.textContent).toBe(messages.admin.audit.columns.action);
    expect(headers[4]!.textContent).toBe(messages.admin.audit.columns.actions);
    expect(headers[3]!.textContent).not.toBe(headers[4]!.textContent);
    expect(mocks.detail).not.toHaveBeenCalled();
  },
);

it.each(["en", "zh"] as const)(
  "keeps intact %s date/time parts and the same program-zone instant for narrow and desktop rows",
  (locale) => {
    // A UTC year boundary catches accidental browser-zone or calendar-date use.
    const instant = new Date("2026-12-31T17:02:03Z");
    mocks.entry.createdAt = instant;
    mount(locale);
    const table = screen.getByRole("table");
    const time = table.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe(instant.toISOString());
    const options = { timeZone: "Asia/Shanghai" };
    const date = new Intl.DateTimeFormat(locale, {
      ...options,
      dateStyle: "medium",
    }).format(instant);
    const clock = new Intl.DateTimeFormat(locale, {
      ...options,
      timeStyle: "short",
    }).format(instant);
    const full = new Intl.DateTimeFormat(locale, {
      ...options,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(instant);
    // The responsive CSS chooses one representation; JSDOM establishes content
    // and semantic time only. Real-browser checks own line counts and geometry.
    expect(time.children[0]!.textContent).toBe(full);
    expect(
      Array.from(time.children[1]!.children, (part) => part.textContent),
    ).toEqual([date, clock]);
    const region = screen.getByRole("region", {
      name: catalogs[locale].admin.audit.title,
    });
    expect(region.tabIndex).toBe(0);
    expect(region.contains(table)).toBe(true);
  },
);

it.each(["en", "zh"] as const)(
  "retains the full %s long actor and localized operation behind the row detail control",
  (locale) => {
    const actor = "Synthetic recorded actor with a long historical name "
      .repeat(4)
      .trim();
    Object.assign(mocks.entry, {
      userName: actor,
      operation: "program.setProfilePolicy",
    });
    const messages = mount(locale, true);
    const title = messages.approvals.review.operations.program_setProfilePolicy;
    const row = screen.getByText(actor).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[1]!).getByText(actor).getAttribute("title")).toBe(actor);
    expect(within(cells[3]!).getByText(title).getAttribute("title")).toBe(title);
    const trigger = within(cells[4]!).getByRole("button", {
      name: `${messages.tablePatterns.details}: ${title} · ${actor}`,
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(actor, { selector: "p" })).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: messages.tablePatterns.close,
      }),
    );
    expect(document.activeElement).toBe(trigger);
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.undo).not.toHaveBeenCalled();
  },
);

it.each(["en", "zh"] as const)(
  "keeps full %s evidence and lazy JSON behind a sticky Close, with Close/Escape restoring its row opener",
  (locale) => {
    const original = structuredClone(evidence);
    const messages = mount(locale);
    expect(mocks.detail).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: ${messages.eventTitles.ACTION} · Recorded actor`,
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(mocks.detail).toHaveBeenCalledWith(
      { id: "event-1" },
      { refetchOnMount: "always", enabled: true },
    );
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", {
      name: messages.accountProfile.close,
    });
    // JSDOM verifies the existing sticky-header composition; final viewport
    // reachability remains a separate real-browser measurement in all quadrants.
    expect(close.parentElement?.className).toContain("sticky top-0");
    expect(document.activeElement).toBe(close);
    expect(within(dialog).getByText("Original recorded note")).toBeTruthy();
    expect(within(dialog).getByText("EXCUSED_ABSENT")).toBeTruthy();
    expect(within(dialog).getByText("affectedCount")).toBeTruthy();
    const disclosure = within(dialog)
      .getByText(messages.auditEventDetails.rawEvidence)
      .closest("details")!;
    expect(disclosure.querySelector("pre")).toBeNull();
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
    expect(disclosure.querySelector("pre")?.textContent).toBe(
      JSON.stringify(evidence, null, 2),
    );
    expect(dialog.textContent).not.toContain("executable undo instructions");
    expect(evidence).toEqual(original);
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    mocks.detail.mockClear();
    fireEvent.click(trigger);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    const reopened = screen.getByRole("dialog");
    expect(reopened.querySelector("pre")).toBeNull();
    fireEvent(reopened, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(mocks.undo).not.toHaveBeenCalled();
  },
);

it.each(["en", "zh"] as const)(
  "keeps the %s observer reader compact and never mounts private evidence",
  (locale) => {
    const messages = mount(locale, true);
    const trigger = screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: ${messages.eventTitles.ACTION} · Recorded actor`,
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", {
      name: messages.tablePatterns.close,
    });
    expect(close.parentElement?.className).not.toContain("sticky top-0");
    expect(within(dialog).getByText("Recorded actor")).toBeTruthy();
    expect(
      within(dialog).getByText(messages.eventTitles.ACTION, { selector: "p" }),
    ).toBeTruthy();
    expect(dialog.querySelector("details")).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: messages.admin.audit.undo }),
    ).toBeNull();
    fireEvent.click(close);
    expect(document.activeElement).toBe(trigger);
    expect(mocks.undo).not.toHaveBeenCalled();
  },
);

const observerKinds = [
  ["ACTION", "ACTION", "Management action"],
  ["DECISION", "DECISION", "Management decision"],
  ["SUBMISSION", "SUBMISSION", "Management submission"],
  ["CANCELLATION", "CANCELLATION", "Management cancellation"],
  ["ATTEMPT", "ATTEMPT", "Management action"],
  ["REVERSAL", "REVERSAL", "Management action"],
  ["LEGACY_IMPORTED_EVENT", "ACTION", "Management action"],
  ["", "ACTION", "Management action"],
] as const;

it.each(
  (["en", "zh"] as const).flatMap((locale) =>
    observerKinds.map(([kind, titleKind, action]) => ({
      locale,
      kind,
      titleKind,
      action,
    })),
  ),
)(
  "localizes the $locale observer summary for $kind without mounting staff evidence or recovery",
  ({ locale, kind, titleKind, action }) => {
    Object.assign(mocks.entry, {
      kind,
      action,
      // Existing row titles may use safe metadata, but the compact summary must
      // remain category-only and must not depend on any recorded action text.
      operation: "program.setProfilePolicy",
      entity: "ProgramSettings",
      approvalId: "private-approval",
      undoData: { private: "executable undo instructions" },
    });
    const original = structuredClone(mocks.entry);
    const messages = mount(locale, true);
    expect(mocks.detail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Recorded actor/ }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(messages.eventTitles[titleKind], {
        selector: "p",
      }),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain(action);
    expect(dialog.querySelector("details, pre")).toBeNull();
    expect(dialog.textContent).not.toContain("executable undo instructions");
    expect(
      screen.queryByRole("link", { name: messages.approvals.viewRequest }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: messages.recovery.title }),
    ).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.undo).not.toHaveBeenCalled();
    expect(mocks.entry).toEqual(original);
  },
);
