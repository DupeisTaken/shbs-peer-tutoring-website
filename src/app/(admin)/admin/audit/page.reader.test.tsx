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
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import AuditPage from "./page";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), undo: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/app/_components/audit-filters", async (importOriginal) => ({
  // The integrated page uses the editor's pure defaults/parsers; skip only its
  // UI so the actual immutable reader and its authorization checks stay real.
  ...(await importOriginal<typeof import("~/app/_components/audit-filters")>()),
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
              createdAt: new Date("2026-10-09T01:02:03Z"),
              userName: "Recorded actor",
              action: "Management action",
              kind: "ACTION",
              undone: false,
              undoData: null,
              approvalId: null,
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

function mount(locale: "en" | "zh", readOnly = false) {
  const messages = locale === "en" ? en : zh;
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

it.each(["en", "zh"] as const)(
  "keeps full %s evidence and lazy JSON behind a sticky Close, with Close/Escape restoring its row opener",
  (locale) => {
    const original = structuredClone(evidence);
    const messages = mount(locale);
    expect(mocks.detail).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: Management action · Recorded actor`,
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
      name: `${messages.tablePatterns.details}: Management action · Recorded actor`,
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", {
      name: messages.tablePatterns.close,
    });
    expect(close.parentElement?.className).not.toContain("sticky top-0");
    expect(within(dialog).getByText("Recorded actor")).toBeTruthy();
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
