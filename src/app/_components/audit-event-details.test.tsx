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
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AuditEventDetails } from "./audit-event-details";
import { TableDetails } from "./ui/summary-table";

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      auditLogDetail: {
        useQuery: mocks.query,
        _def: () => ({ path: ["admin", "auditLogDetail"] }),
      },
    },
  },
}));
let client: QueryClient;
const event = {
  id: "event-1",
  userId: "actor-1",
  userName: "Recorded Alex",
  kind: "ACTION",
  operation: "program.setProfilePolicy",
  entity: "ProgramSettings",
  entityId: "settings-1",
  action: "Update name display",
  approvalId: "approval-1",
  details: null as unknown,
  createdAt: new Date("2026-10-09T01:23:45.678Z"),
  undone: false,
  undoneAt: null as Date | null,
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      {children}
    </NextIntlClientProvider>
  </QueryClientProvider>
);
function result(
  data: unknown = event,
  error: unknown = null,
  isFetching = false,
) {
  return { data, error, isFetching, refetch: mocks.refetch };
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.query.mockReturnValue(result());
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

it("loads only when details open, refreshes on reopening and returns keyboard focus", () => {
  render(
    <TableDetails title="Recorded change">
      <AuditEventDetails id="event-1" />
    </TableDetails>,
    { wrapper },
  );
  expect(mocks.query).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", {
    name: "View details: Recorded change",
  });
  trigger.focus();
  fireEvent.click(trigger);
  expect(mocks.query).toHaveBeenCalledWith(
    { id: "event-1" },
    { refetchOnMount: "always", enabled: true },
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Recorded Alex")).toBeTruthy();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  mocks.query.mockClear();
  fireEvent.click(trigger);
  expect(mocks.query).toHaveBeenCalledTimes(1);
});

it("shows exact stored identifiers, milliseconds, undo time and a linked approval", () => {
  mocks.query.mockReturnValue(
    result({
      ...event,
      undone: true,
      undoneAt: new Date("2026-10-09T02:34:56.789Z"),
      undoData: { password: "never-display" },
    }),
  );
  render(<AuditEventDetails id="event-1" />, { wrapper });
  for (const text of [
    "actor-1",
    "event-1",
    "program.setProfilePolicy",
    "ProgramSettings",
    "settings-1",
    "2026-10-09T01:23:45.678Z",
    "2026-10-09T02:34:56.789Z",
    "Undone",
  ])
    expect(screen.getByText(text)).toBeTruthy();
  const time = screen.getByText(
    "2026-10-09T01:23:45.678Z",
  ).previousElementSibling;
  expect(time?.getAttribute("datetime")).toBe("2026-10-09T01:23:45.678Z");
  expect(time?.textContent).toContain(":45");
  expect(
    screen
      .getByRole("link", { name: "Open approval · approval-1" })
      .getAttribute("href"),
  ).toBe("/admin/approvals?request=approval-1");
  expect(screen.queryByText(/never-display/)).toBeNull();
});

it("renders legacy missing evidence explicitly without inventing a before value", () => {
  mocks.query.mockReturnValue(
    result({
      ...event,
      userName: null,
      userId: null,
      operation: null,
      entity: null,
      entityId: null,
      approvalId: null,
    }),
  );
  render(<AuditEventDetails id="event-1" />, { wrapper });
  expect(
    screen.getByText("No detailed evidence was recorded for this event."),
  ).toBeTruthy();
  expect(screen.getAllByText("Not recorded")).toHaveLength(7);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("region", { name: "Before" })).toBeNull();
});

it("distinguishes missing, null, false, zero and empty evidence in saved comparisons", () => {
  mocks.query.mockReturnValue(
    result({
      ...event,
      details: {
        after: {
          enabled: false,
          count: 0,
          reason: "",
          value: null,
          participants: [],
          extra: {},
        },
      },
    }),
  );
  render(<AuditEventDetails id="event-1" />, { wrapper });
  expect(
    within(screen.getByRole("region", { name: "Before" })).getByText(
      "Not recorded",
    ),
  ).toBeTruthy();
  const after = within(screen.getByRole("region", { name: "After" }));
  for (const value of [
    "False",
    "0",
    "Empty text",
    "Null (explicitly recorded)",
    "Empty list []",
    "Empty object",
  ])
    expect(after.getByText(value)).toBeTruthy();
});

it("preserves unknown nested evidence, multiline long text, lists and deep fallback", () => {
  const long = "Long recorded description ".repeat(100);
  mocks.query.mockReturnValue(
    result({
      ...event,
      details: {
        before: { note: "Original" },
        after: {
          note: long,
          multiline: "First\nSecond",
          nested: [{ active: true }],
        },
        context: {
          a: {
            b: {
              c: {
                d: { value: "deep recorded value", undoData: "private-undo" },
              },
            },
          },
        },
      },
    }),
  );
  render(<AuditEventDetails id="event-1" />, { wrapper });
  expect(screen.getByText(long.trim())).toBeTruthy();
  expect(screen.getByText("First Second").textContent).toBe("First\nSecond");
  expect(screen.getByText("True")).toBeTruthy();
  expect(screen.getByText(/deep recorded value/).tagName).toBe("PRE");
  expect(screen.queryByText(/private-undo/)).toBeNull();
  expect(screen.getByText("Original")).toBeTruthy();
});

it("shows loading, recovers initial read failure and preserves cached evidence on refresh failure", () => {
  mocks.query.mockReturnValue({ ...result(), data: undefined });
  const view = render(<AuditEventDetails id="event-1" />, { wrapper });
  expect(screen.getByRole("status").textContent).toContain(
    "Loading event details",
  );
  mocks.query.mockReturnValue({
    ...result(undefined, { message: "Request failed" }),
    data: undefined,
  });
  view.rerender(<AuditEventDetails id="event-1" />);
  expect(screen.getByRole("alert").textContent).toContain("Request failed");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mocks.refetch).toHaveBeenCalledTimes(1);
  mocks.query.mockReturnValue(
    result(event, { message: "Refresh failed" }, true),
  );
  view.rerender(<AuditEventDetails id="event-1" />);
  expect(screen.getByText("Recorded Alex")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain(
    "last loaded evidence remains visible",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }).disabled,
  ).toBe(true);
  mocks.query.mockReturnValue(result());
  view.rerender(<AuditEventDetails id="event-1" />);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("localizes labels and value states while retaining recorded field names and text", () => {
  mocks.query.mockReturnValue(
    result({
      ...event,
      details: {
        before: { enabled: false },
        after: { enabled: true, note: "Stored English note" },
      },
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="zh"
        timeZone="Asia/Shanghai"
        messages={zh}
      >
        <AuditEventDetails id="event-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  for (const text of [
    "已记录事件",
    "变更前",
    "变更后",
    "假",
    "真",
    "Stored English note",
    "2026-10-09T01:23:45.678Z",
  ])
    expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getAllByText("enabled")).toHaveLength(2);
});

it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "hides previously loaded private evidence after %s instead of retaining it",
  (code) => {
    mocks.query.mockReturnValue(
      result({
        ...event,
        details: { privateNote: "Private historical evidence" },
      }),
    );
    const view = render(<AuditEventDetails id="event-1" />, { wrapper });
    expect(screen.getByText("Private historical evidence")).toBeTruthy();
    mocks.query.mockReturnValue(
      result(
        { ...event, details: { privateNote: "Private historical evidence" } },
        { message: "Access denied", data: { code } },
      ),
    );
    view.rerender(<AuditEventDetails id="event-1" />);
    expect(screen.getByRole("status").textContent).toContain(
      "Event details access denied",
    );
    expect(screen.queryByText("Private historical evidence")).toBeNull();
    expect(screen.queryByText("Recorded Alex")).toBeNull();
    expect(screen.queryByText("event-1")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("View stored JSON")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  },
);

it("lazily exposes faithful JSON types and escaped text while excluding internal undo instructions", () => {
  const details = {
    number: 0,
    numericText: "0",
    boolean: false,
    booleanText: "False",
    null: null,
    nullText: "null",
    emptyText: "",
    escapedText: 'Quoted "text"\nnext line',
    emptyList: [],
    undoData: { private: "undo-only" },
  };
  mocks.query.mockReturnValue(result({ ...event, details }));
  const view = render(<AuditEventDetails id="event-1" />, { wrapper });
  const summary = screen.getByText("View stored JSON");
  expect(summary.tagName).toBe("SUMMARY");
  expect(view.container.querySelector("pre")).toBeNull();
  const disclosure = summary.closest("details")!;
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  const json = disclosure.querySelector("pre")!;
  const expected = { ...details };
  Reflect.deleteProperty(expected, "undoData");
  expect(json.textContent).toBe(JSON.stringify(expected, null, 2));
  expect(JSON.parse(json.textContent)).toEqual(expected);
  expect(screen.queryByText(/undo-only/)).toBeNull();
  disclosure.open = false;
  fireEvent(disclosure, new Event("toggle"));
  expect(disclosure.querySelector("pre")).toBeNull();
});
