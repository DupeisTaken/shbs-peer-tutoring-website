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
              { id: "user-alex-1", label: "Alex" },
              { id: "user-alex-2", label: "Alex" },
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
  <NextIntlClientProvider locale="en" messages={messages}>
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
      from: new Date("2026-09-09"),
      until: new Date("2026-09-10"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
  expect(onApply).toHaveBeenLastCalledWith({});
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "User" }).value,
  ).toBe("");
});
