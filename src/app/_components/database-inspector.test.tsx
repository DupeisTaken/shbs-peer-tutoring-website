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
import messages from "../../../messages/en.json";
import type {
  InspectedRecords,
  RecordTable,
} from "~/server/recovery/record-inspector";
import { DatabaseInspector } from "./database-inspector";

const mocks = vi.hoisted(() => ({
  tables: vi.fn(),
  records: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    recordInspector: {
      tables: { useQuery: mocks.tables },
      records: { useQuery: mocks.records },
    },
  },
}));
const table: RecordTable = {
  name: "User",
  available: true,
  keyFields: ["id"],
  fields: [
    { name: "id", type: "String", readable: true },
    {
      name: "passwordHash",
      type: "String",
      readable: false,
      reason: "restricted",
    },
  ],
};
const unsupported: RecordTable = {
  name: "DirectMessage",
  available: false,
  keyFields: ["id"],
  fields: [
    { name: "id", type: "String", readable: false, reason: "unsupported" },
  ],
};
const data: InspectedRecords = {
  table,
  rows: [
    {
      key: { id: "persisted-user" },
      reference: { table: "User", key: { id: "persisted-user" } },
      fields: { id: "persisted-user", name: "Stored name" },
      omitted: [{ field: "passwordHash", reason: "restricted" }],
    },
  ],
  nextCursor: "next-page",
};
function query(value: unknown) {
  return {
    data: value,
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: mocks.refetch,
  };
}
function mount() {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <DatabaseInspector />
    </NextIntlClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables.mockReturnValue(query([table, unsupported]));
  mocks.records.mockReturnValue(query(data));
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
afterEach(cleanup);

it("provides an explicit schema-only entrance without querying unsupported private rows", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Database table"), {
    target: { value: "DirectMessage" },
  });
  expect(screen.getByRole("status").textContent).toContain(
    "row existence and values are not queried",
  );
  expect(mocks.records).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Field access policy"));
  expect(
    screen.getByText("No approved row policy; not retrieved."),
  ).toBeTruthy();
});
it("keeps rows brief, exposes permitted raw fields and explicit omissions in a long reader", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Database table"), {
    target: { value: "User" },
  });
  expect(screen.queryByText("Stored name", { exact: false })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Inspect record: User/ }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/Stored name/)).toBeTruthy();
  expect(
    within(dialog).getByText("Restricted by the field policy; not retrieved."),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(
      "npm run recovery -- records inspect --table MODEL --key '<JSON>'",
    ),
  ).toBeTruthy();
});
it("removes stale identities and their open reader after a denied record refresh", () => {
  const view = mount();
  fireEvent.change(screen.getByLabelText("Database table"), {
    target: { value: "User" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Inspect record: User/ }));
  mocks.records.mockReturnValue({
    ...query(data),
    isError: true,
    error: { data: { code: "FORBIDDEN" } },
  });
  view.rerender(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <DatabaseInspector />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByLabelText("Exact primary key (JSON)")).toBeNull();
  expect(screen.queryByText(/persisted-user/)).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});
it("removes stale catalog and rows after a catalog denial", () => {
  const view = mount();
  fireEvent.change(screen.getByLabelText("Database table"), {
    target: { value: "User" },
  });
  mocks.tables.mockReturnValue({ ...query([table]), isError: true });
  view.rerender(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <DatabaseInspector />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByLabelText("Database table")).toBeNull();
  expect(screen.queryByText(/persisted-user/)).toBeNull();
});
it("validates full primary keys before applying filters and resets pagination", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Database table"), {
    target: { value: "User" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(mocks.records).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: "next-page" }),
    expect.anything(),
  );
  const input = screen.getByLabelText("Exact primary key (JSON)");
  fireEvent.change(input, { target: { value: '{"role":"HEAD"}' } });
  fireEvent.click(screen.getByRole("button", { name: "Apply key filter" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "exactly the primary key fields",
  );
  fireEvent.change(input, { target: { value: '{"id":"literal-identifier"}' } });
  fireEvent.click(screen.getByRole("button", { name: "Apply key filter" }));
  expect(mocks.records).toHaveBeenLastCalledWith(
    expect.objectContaining({
      key: { id: "literal-identifier" },
      cursor: undefined,
    }),
    expect.anything(),
  );
});
it("shows initial loading and a retryable failure without an empty-result claim", () => {
  mocks.tables.mockReturnValue({ ...query(undefined), isLoading: true });
  const view = mount();
  expect(screen.getByRole("status").textContent).toContain(
    "Loading database records",
  );
  expect(screen.queryByText("No matching records.")).toBeNull();
  mocks.tables.mockReturnValue({ ...query(undefined), isError: true });
  view.rerender(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <DatabaseInspector />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mocks.refetch).toHaveBeenCalledTimes(1);
});
