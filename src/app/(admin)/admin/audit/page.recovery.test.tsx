/** @vitest-environment jsdom */
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "~/trpc/query-client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { SessionViewProvider } from "~/app/_components/session-view-state";

const fixture = vi.hoisted(() => ({
  failedRead: null as "auditLog" | "auditFilterOptions" | null,
  deniedRead: null as "auditLog" | "auditFilterOptions" | null,
  nullRead: null as "auditLog" | "auditFilterOptions" | null,
  heldRead: null as "auditLog" | "auditFilterOptions" | null,
  gate: undefined as Promise<void> | undefined,
  empty: false,
  approval: "",
  reads: vi.fn(),
  writes: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      fixture.approval ? { approval: fixture.approval } : undefined,
    ),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useQueryClient } = await import("@tanstack/react-query");
  const data = {
    auditLog: [
      {
        id: "synthetic-audit-event",
        createdAt: new Date("2026-10-09T01:02:03Z"),
        userName: "Synthetic recorded actor",
        action: "Synthetic recorded action",
        kind: "ACTION",
        undone: false,
        undoData: null,
        approvalId: null,
      },
    ],
    auditFilterOptions: { users: [], operations: [], entities: [] },
  };
  const read = (name: keyof typeof data) => ({
    _def: () => ({ path: ["admin", name] }),
    useQuery: (input?: unknown) =>
      useQuery({
        queryKey: [["admin", name], { type: "query", input }],
        queryFn: async () => {
          fixture.reads(name, input);
          if (fixture.heldRead === name) await fixture.gate;
          if (fixture.deniedRead === name)
            throw Object.assign(new Error(`Synthetic ${name} denied`), {
              data: { code: "FORBIDDEN" },
            });
          if (fixture.failedRead === name)
            throw new Error(`Synthetic ${name} read unavailable`);
          if (fixture.nullRead === name) return null;
          if (fixture.empty && name === "auditLog") return [];
          return data[name];
        },
        retry: false,
      }),
  });
  return {
    api: {
      useUtils: () => {
        const client = useQueryClient();
        const invalidator = (name: keyof typeof data) => ({
          invalidate: () =>
            client.invalidateQueries({ queryKey: [["admin", name]] }),
        });
        return {
          admin: {
            auditLog: invalidator("auditLog"),
            auditFilterOptions: invalidator("auditFilterOptions"),
          },
        };
      },
      admin: {
        auditLog: read("auditLog"),
        auditFilterOptions: read("auditFilterOptions"),
        undoAudit: {
          useMutation: () => ({ mutate: fixture.writes, isPending: false }),
        },
      },
    },
  };
});
import AuditPage from "./page";

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  fixture.failedRead = null;
  fixture.deniedRead = null;
  fixture.nullRead = null;
  fixture.heldRead = null;
  fixture.gate = undefined;
  fixture.empty = false;
  fixture.approval = "";
  client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
    mutations: { ...defaults.mutations, retry: false },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
const show = (readOnly = false, timeZone = "Asia/Shanghai") =>
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone={timeZone}>
        <SessionViewProvider
          identity="synthetic-audit-manager"
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

// Exercise explicit read-only recovery without changing the committed filters.
// The actual parent, AuditFilters and installed QueryClient remain composed.
it.each(["auditLog", "auditFilterOptions"] as const)(
  "offers a read-only in-page retry after an initial %s failure",
  async (name) => {
    fixture.failedRead = name;
    show();
    await screen.findAllByRole("alert");
    expect(
      screen.getAllByText(`Synthetic ${name} read unavailable`).length,
    ).toBeGreaterThan(0);
    const attemptsBefore = fixture.reads.mock.calls.filter(
      ([readName]) => readName === name,
    ).length;
    expect(attemptsBefore).toBeGreaterThan(0);
    const retry = screen.getByRole("button", { name: /retry|refresh|reload/i });
    fixture.failedRead = null;
    fireEvent.click(retry);
    await waitFor(() => {
      expect(
        fixture.reads.mock.calls.filter(([readName]) => readName === name)
          .length,
      ).toBeGreaterThan(attemptsBefore);
      expect(screen.queryAllByRole("alert")).toHaveLength(0);
    });
    expect(screen.getByText("Synthetic recorded actor")).toBeTruthy();
    expect(fixture.writes).not.toHaveBeenCalled();
  },
);

const refresh = async (name: "auditLog" | "auditFilterOptions") => {
  await act(async () => {
    await client.invalidateQueries({ queryKey: [["admin", name]] });
  });
};
const lastListInput = () =>
  fixture.reads.mock.calls
    .filter(([name]) => name === "auditLog")
    .at(-1)?.[1] as Record<string, unknown>;

it.each(["auditLog", "auditFilterOptions"] as const)(
  "retains permitted cached evidence, the committed query and unfinished filters during %s recovery",
  async (name) => {
    show();
    await screen.findByText("Synthetic recorded actor");
    const search = screen.getByLabelText<HTMLInputElement>(
      en.auditFilters.search,
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: en.auditFilters.apply,
        }).disabled,
      ).toBe(false),
    );
    fireEvent.change(search, {
      target: { value: "Committed synthetic search" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: en.auditFilters.apply }),
    );
    await waitFor(() =>
      expect(lastListInput().search).toBe("Committed synthetic search"),
    );
    fireEvent.change(search, { target: { value: "Unfinished filter draft" } });
    fixture.failedRead = name;
    await refresh(name);
    await screen.findByRole("alert");
    expect(screen.getByText("Synthetic recorded actor")).toBeTruthy();
    expect(search.value).toBe("Unfinished filter draft");
    expect(search.disabled).toBe(true);
    fireEvent.submit(search.closest("form")!);
    expect(lastListInput().search).toBe("Committed synthetic search");
    fixture.failedRead = null;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(search.value).toBe("Unfinished filter draft");
    expect(search.disabled).toBe(false);
    expect(lastListInput().search).toBe("Committed synthetic search");
    expect(fixture.writes).not.toHaveBeenCalled();
  },
);

it.each(["auditLog", "auditFilterOptions"] as const)(
  "treats a successful null %s response as unavailable rather than empty",
  async (name) => {
    fixture.nullRead = name;
    show();
    await screen.findByRole("alert");
    expect(screen.queryByText(en.auditFilters.empty)).toBeNull();
    if (name === "auditFilterOptions")
      expect(screen.queryByLabelText(en.auditFilters.user)).toBeNull();
    fixture.nullRead = null;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("Synthetic recorded actor")).toBeTruthy();
    expect(fixture.writes).not.toHaveBeenCalled();
  },
);

it.each(["auditLog", "auditFilterOptions"] as const)(
  "retains the cached filter draft after a null %s background response",
  async (name) => {
    show();
    await screen.findByText("Synthetic recorded actor");
    const search = screen.getByLabelText<HTMLInputElement>(
      en.auditFilters.search,
    );
    fireEvent.change(search, { target: { value: "Retained null-read draft" } });
    fixture.nullRead = name;
    await refresh(name);
    await screen.findByRole("alert");
    expect(screen.getByText("Synthetic recorded actor")).toBeTruthy();
    expect(search.value).toBe("Retained null-read draft");
    expect(screen.queryByText(en.auditFilters.empty)).toBeNull();
    expect(fixture.writes).not.toHaveBeenCalled();
  },
);

it.each(["auditLog", "auditFilterOptions"] as const)(
  "conceals cached audit evidence after %s denies access through null and later transport failures",
  async (name) => {
    show();
    await screen.findByText("Synthetic recorded actor");
    fixture.deniedRead = name;
    await refresh(name);
    await waitFor(() =>
      expect(screen.queryByText("Synthetic recorded actor")).toBeNull(),
    );
    expect(screen.queryByRole("table")).toBeNull();
    fixture.deniedRead = null;
    fixture.nullRead = name;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: /retry/i })
          .disabled,
      ).toBe(false),
    );
    expect(screen.queryByText("Synthetic recorded actor")).toBeNull();
    expect(screen.queryByLabelText(en.auditFilters.search)).toBeNull();
    fixture.nullRead = null;
    fixture.failedRead = name;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: /retry/i })
          .disabled,
      ).toBe(false),
    );
    expect(screen.queryByText("Synthetic recorded actor")).toBeNull();
    expect(screen.queryByLabelText(en.auditFilters.search)).toBeNull();
    fixture.failedRead = null;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Synthetic recorded actor");
    expect(fixture.writes).not.toHaveBeenCalled();
  },
);

it("holds one Retry until a failed list read and slower options read both settle", async () => {
  show();
  await screen.findByText("Synthetic recorded actor");
  fixture.failedRead = "auditLog";
  await refresh("auditLog");
  let finish!: () => void;
  fixture.gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  fixture.heldRead = "auditFilterOptions";
  const listAttempts = fixture.reads.mock.calls.filter(
    ([name]) => name === "auditLog",
  ).length;
  const retry = await screen.findByRole<HTMLButtonElement>("button", {
    name: /retry/i,
  });
  act(() => {
    fireEvent.click(retry);
    fireEvent.click(retry);
  });
  await waitFor(() =>
    expect(
      fixture.reads.mock.calls.filter(([name]) => name === "auditLog"),
    ).toHaveLength(listAttempts + 1),
  );
  expect(retry.disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.auditFilters.apply,
    }).disabled,
  ).toBe(true);
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(retry.disabled).toBe(false));
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("distinguishes successful empty options/history from a failed cached empty read", async () => {
  fixture.empty = true;
  show();
  await screen.findByText(en.auditFilters.empty);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.auditFilters.apply,
    }).disabled,
  ).toBe(false);
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  fixture.failedRead = "auditLog";
  await refresh("auditLog");
  await screen.findByRole("alert");
  expect(screen.queryByText(en.auditFilters.empty)).toBeNull();
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("retries the same approval and timezone-aware committed dates without applying an unfinished draft for observers", async () => {
  fixture.approval = "synthetic-approval";
  show(true, "America/New_York");
  await screen.findByText("Synthetic recorded actor");
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.auditFilters.apply,
      }).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText(en.auditFilters.from), {
    target: { value: "2026-03-07" },
  });
  fireEvent.change(screen.getByLabelText(en.auditFilters.until), {
    target: { value: "2026-03-09" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.auditFilters.apply }));
  const expected = {
    approvalId: "synthetic-approval",
    from: new Date("2026-03-07T05:00:00Z"),
    until: new Date("2026-03-10T04:00:00Z"),
  };
  await waitFor(() => expect(lastListInput()).toMatchObject(expected));
  fireEvent.change(screen.getByLabelText(en.auditFilters.until), {
    target: { value: "2026-03-11" },
  });
  fixture.failedRead = "auditFilterOptions";
  await refresh("auditFilterOptions");
  fixture.failedRead = null;
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(lastListInput()).toMatchObject(expected);
  expect(
    screen.getByLabelText<HTMLInputElement>(en.auditFilters.until).value,
  ).toBe("2026-03-11");
  expect(fixture.writes).not.toHaveBeenCalled();
});
