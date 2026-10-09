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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "~/trpc/react";
import en from "../../../messages/en.json";
import { AuditEventDetails } from "./audit-event-details";
import { TableDetails } from "./ui/summary-table";

type Detail = RouterOutputs["admin"]["auditLogDetail"];
const remote = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      admin: {
        auditLogDetail: {
          _def: () => ({ path: ["admin", "auditLogDetail"] }),
          useQuery(
            input: { id: string },
            options: { enabled?: boolean; refetchOnMount?: "always" | boolean },
          ) {
            return useQuery<Detail>({
              queryKey: [["admin", "auditLogDetail"], { input, type: "query" }],
              queryFn: () => remote.load() as Promise<Detail>,
              ...options,
            });
          },
        },
      },
    },
  };
});
const event: Detail = {
  id: "event-1",
  userId: "actor-1",
  userName: "Private recorded actor",
  createdAt: new Date("2026-10-09T01:23:45.678Z"),
  kind: "ACTION",
  operation: "program.setProfilePolicy",
  entity: "ProgramSettings",
  entityId: "settings-1",
  action: "Saved action",
  approvalId: null,
  details: { note: "Private recorded evidence" },
  undone: false,
  undoneAt: null,
};
let client: QueryClient;
const key = () =>
  getQueryKey(api.admin.auditLogDetail, { id: event.id }, "query");
const denied = () =>
  Object.assign(new Error("Access denied"), { data: { code: "FORBIDDEN" } });
function mount() {
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="Asia/Shanghai"
        messages={en}
      >
        <TableDetails title="Audit event">
          <AuditEventDetails id={event.id} />
        </TableDetails>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "View details: Audit event" }),
  );
const retry = () =>
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  remote.load.mockReset();
  remote.load.mockResolvedValue(event);
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
});

it("evicts revoked evidence and keeps denial through a failed Retry until a fresh successful read", async () => {
  const unrelatedKey = getQueryKey(
    api.admin.auditLogDetail,
    { id: "another-event" },
    "query",
  );
  client.setQueryData(unrelatedKey, { ...event, id: "another-event" });
  mount();
  open();
  await screen.findByText("Private recorded evidence");
  remote.load.mockRejectedValueOnce(denied());
  await act(async () => {
    await client.refetchQueries({ queryKey: key(), exact: true });
  });
  await screen.findByText("Event details access denied");
  expect(screen.queryByText("Private recorded evidence")).toBeNull();
  expect(client.getQueryData(key())).toBeUndefined();
  expect(client.getQueryData(unrelatedKey)).toBeTruthy();
  expect(remote.load).toHaveBeenCalledTimes(2);

  remote.load.mockRejectedValueOnce(new Error("Network unavailable"));
  retry();
  await waitFor(() => expect(remote.load).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }).disabled,
    ).toBe(false),
  );
  expect(screen.getByText("Event details access denied")).toBeTruthy();
  expect(screen.queryByText("Private recorded actor")).toBeNull();
  expect(screen.queryByText("Private recorded evidence")).toBeNull();
  expect(client.getQueryData(key())).toBeUndefined();

  remote.load.mockResolvedValueOnce({
    ...event,
    details: { note: "Fresh authorized evidence" },
  });
  retry();
  await screen.findByText("Fresh authorized evidence");
  expect(screen.queryByText("Event details access denied")).toBeNull();
  expect(remote.load).toHaveBeenCalledTimes(4);
});

it("does not resurrect denied cache after Close and reopen followed by a server failure", async () => {
  mount();
  open();
  await screen.findByText("Private recorded evidence");
  remote.load.mockRejectedValueOnce(denied());
  await act(async () => {
    await client.refetchQueries({ queryKey: key(), exact: true });
  });
  await screen.findByText("Event details access denied");
  expect(client.getQueryData(key())).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  remote.load.mockRejectedValueOnce(new Error("Temporary server failure"));
  open();
  expect(screen.queryByText("Private recorded evidence")).toBeNull();
  await screen.findByText("Event details could not be loaded");
  expect(screen.queryByText("Private recorded actor")).toBeNull();
  expect(screen.queryByText("Private recorded evidence")).toBeNull();
  expect(client.getQueryData(key())).toBeUndefined();
  expect(remote.load).toHaveBeenCalledTimes(3);
});
