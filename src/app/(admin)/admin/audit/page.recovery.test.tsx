/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClientProvider,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { createQueryClient } from "~/trpc/query-client";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import AuditPage from "./page";

const state = vi.hoisted(() => ({
  logFn: vi.fn<(input: unknown) => Promise<unknown>>(),
  optionsFn: vi.fn<() => Promise<unknown>>(),
  readOnly: false,
}));

let queryClient: QueryClient;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readOnly,
}));
vi.mock("~/app/_components/audit-event-details", () => ({
  AuditEventDetails: ({ id }: { id: string }) => <div>Details:{id}</div>,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      auditLog: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) =>
          useQuery({
            queryKey: [["admin", "auditLog"], { input, type: "query" }],
            queryFn: () => state.logFn(input),
            enabled: options?.enabled !== false,
          }),
      },
      auditFilterOptions: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          useQuery({
            queryKey: [["admin", "auditFilterOptions"], { type: "query" }],
            queryFn: () => state.optionsFn(),
            enabled: options?.enabled !== false,
          }),
      },
    },
  },
}));

const sampleOptions = {
  users: [{ id: "u-1", name: "Alex Admin" }],
  operations: ["admin.setPatrolOrder"],
  entities: ["Room"],
};

const sampleRow = {
  id: "audit-1",
  createdAt: new Date("2026-10-01T12:00:00Z"),
  kind: "ACTION" as const,
  action: "Updated patrol order",
  operation: "admin.setPatrolOrder",
  entity: "Room",
  entityId: "room-1",
  approvalId: null,
  undoneAt: null,
  undoable: false,
  user: { id: "u-1", name: "Alex Admin" },
};

function renderAudit(locale: "en" | "zh" = "en") {
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="Asia/Shanghai"
      >
        <SessionViewProvider identity="head" pathname="/admin/audit" verified>
          <AuditPage />
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: 30_000,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  vi.clearAllMocks();
  state.readOnly = false;
  state.logFn.mockResolvedValue([sampleRow]);
  state.optionsFn.mockResolvedValue(sampleOptions);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("retries admin.auditLog and admin.auditFilterOptions independently while preserving unfinished filter drafts (#647)", async () => {
  state.logFn.mockRejectedValueOnce(new Error("Audit list offline"));
  state.optionsFn.mockRejectedValueOnce(new Error("Filter options offline"));

  renderAudit("en");

  const retryLogName = en.managementRecovery.retry.replace(
    "{section}",
    en.admin.audit.title,
  );
  const retryOptionsName = en.managementRecovery.retry.replace(
    "{section}",
    en.auditFilters.filterOptions,
  );

  await waitFor(() => {
    expect(screen.getByRole("button", { name: retryLogName })).toBeTruthy();
    expect(screen.getByRole("button", { name: retryOptionsName })).toBeTruthy();
  });
  expect(screen.queryByText(en.admin.audit.empty)).toBeNull();

  // Type an unfinished draft in the search input before retrying filter options.
  const searchInput = screen.getByLabelText<HTMLInputElement>(
    en.auditFilters.search,
  );
  fireEvent.change(searchInput, { target: { value: "unsaved-query" } });

  // Retrying filter options ONLY refetches auditFilterOptions, not auditLog.
  const logCallsBefore = state.logFn.mock.calls.length;
  state.optionsFn.mockResolvedValueOnce(sampleOptions);
  fireEvent.click(screen.getByRole("button", { name: retryOptionsName }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: retryOptionsName })).toBeNull(),
  );
  expect(state.logFn).toHaveBeenCalledTimes(logCallsBefore);
  expect(
    screen.getByLabelText<HTMLInputElement>(en.auditFilters.search).value,
  ).toBe("unsaved-query");

  // Retrying audit log ONLY refetches auditLog, not auditFilterOptions.
  const optionsCallsBefore = state.optionsFn.mock.calls.length;
  state.logFn.mockResolvedValueOnce([sampleRow]);
  fireEvent.click(screen.getByRole("button", { name: retryLogName }));
  await waitFor(() =>
    expect(
      screen.getByText(en.approvals.review.operations.admin_setPatrolOrder),
    ).toBeTruthy(),
  );
  expect(state.optionsFn).toHaveBeenCalledTimes(optionsCallsBefore);
  expect(
    screen.getByLabelText<HTMLInputElement>(en.auditFilters.search).value,
  ).toBe("unsaved-query");
});

it("conceals cached rows and filter options on FORBIDDEN denial, evicts caches, and recovers under backward clock skew (#647)", async () => {
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);

  renderAudit("zh");
  await waitFor(() =>
    expect(
      screen.getByText(zh.approvals.review.operations.admin_setPatrolOrder),
    ).toBeTruthy(),
  );

  // Move wall clock backward and deny auditLog.
  now = Date.UTC(2026, 10, 9, 12, 0);
  state.logFn.mockRejectedValueOnce(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: [["admin", "auditLog"]] });
  });

  await waitFor(() =>
    expect(screen.getByText(zh.auditFilters.accessDenied)).toBeTruthy(),
  );
  expect(
    screen.queryByText(zh.approvals.review.operations.admin_setPatrolOrder),
  ).toBeNull();
  expect(screen.queryByLabelText(zh.auditFilters.search)).toBeNull();
  expect(
    queryClient.getQueryData([
      ["admin", "auditFilterOptions"],
      { type: "query" },
    ]),
  ).toBeUndefined();

  // Recover via Retry audit reads under further backward clock skew.
  now = Date.UTC(2026, 10, 9, 11, 50);
  state.logFn.mockResolvedValueOnce([sampleRow]);
  state.optionsFn.mockResolvedValueOnce(sampleOptions);
  fireEvent.click(
    screen.getByRole("button", { name: zh.auditFilters.retryReads }),
  );
  await waitFor(() =>
    expect(
      screen.getByText(zh.approvals.review.operations.admin_setPatrolOrder),
    ).toBeTruthy(),
  );
});

it("respects observer read-only projection without mounting staff AuditEventDetails (#647)", async () => {
  state.readOnly = true;
  renderAudit("en");
  await waitFor(() =>
    expect(
      screen.getByText(en.approvals.review.operations.admin_setPatrolOrder),
    ).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: /View details/i }));
  expect(screen.queryByText("Details:audit-1")).toBeNull();
});
