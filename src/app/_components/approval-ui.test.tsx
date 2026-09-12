/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { ApprovalNotice } from "./approval-notice";
import { AuditFilters } from "./audit-filters";

vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      auditFilterOptions: {
        useQuery: () => ({
          data: {
            users: [
              { id: "user-alex-1", label: "Alex", username:"alexchen", former:false },
              { id: "user-alex-2", label: "Alex", username:"alexkim", former:false },
            ],
            operations: ["admin.updateRoom"],
            entities: ["Room"],
          },
        }),
      },
    },
  },
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
afterEach(cleanup);

it("announces a queued proposal with a working request link and dismiss control", () => {
  render(<ApprovalNotice />, { wrapper });
  act(() => {
    window.dispatchEvent(
      new CustomEvent("approval-queued", { detail: "request-1" }),
    );
  });
  expect(screen.getByRole("status").textContent).toContain(
    "live records stay unchanged",
  );
  expect(
    screen.getByRole("link", { name: "View Request" }).getAttribute("href"),
  ).toBe("/admin/approvals?request=request-1");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("status")).toBeNull();
});

it("combines filters by stable user ID and clears them without sending incomplete edits", () => {
  const onApply = vi.fn();
  render(<AuditFilters onApply={onApply} />, { wrapper });
  expect(screen.getByText("Date filters and event times use Asia/Shanghai.")).toBeTruthy();
  expect(screen.getByRole('option',{name:'Alex · @alexkim'})).toBeTruthy();
  expect(screen.queryByText(/alex-2/)).toBeNull();
  fireEvent.change(screen.getByLabelText("User"), {
    target: { value: "user-alex-2" },
  });
  fireEvent.change(screen.getByLabelText("Event Type"), {
    target: { value: "DECISION" },
  });
  fireEvent.change(screen.getByLabelText("From Date"), {
    target: { value: "2026-09-09" },
  });
  fireEvent.change(screen.getByLabelText("Through Date"), {
    target: { value: "2026-09-09" },
  });
  fireEvent.change(screen.getByLabelText("Search History"), {
    target: { value: "review" },
  });
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
  expect(onApply).toHaveBeenLastCalledWith(
    expect.objectContaining({
      userId: "user-alex-2",
      kind: "DECISION",
      search: "review",
      from: new Date("2026-09-08T16:00:00Z"),
      until: new Date("2026-09-09T16:00:00Z"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
  expect(onApply).toHaveBeenLastCalledWith({});
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "User" }).value,
  ).toBe("");
});
