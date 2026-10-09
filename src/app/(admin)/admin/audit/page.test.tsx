/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import AuditPage from "./page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/app/_components/audit-filters", () => ({
  AuditFilters: () => null,
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
      undoAudit: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      auditLog: {
        useQuery: () => ({
          data: [
            {
              id: "event-1",
              createdAt: new Date("2026-10-09T01:02:03Z"),
              userName: "Recorded actor",
              action: "Management action",
              kind: "ACTION",
              undone: false,
              details: null,
              undoData: null,
              approvalId: null,
            },
          ],
        }),
      },
    },
  },
}));

afterEach(cleanup);

function mount(readOnly = false) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <AuditPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
}

it("mounts staff evidence only while the selected event dialog is open", () => {
  mount();
  expect(screen.queryByText("Private evidence for event-1")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /View details:/ }));
  expect(screen.getByText("Private evidence for event-1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByText("Private evidence for event-1")).toBeNull();
});

it("keeps observer dialogs on the projected summary without mounting staff evidence", () => {
  mount(true);
  fireEvent.click(screen.getByRole("button", { name: /View details:/ }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByText("Private evidence for event-1")).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

