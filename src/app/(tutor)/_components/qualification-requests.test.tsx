// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { QualificationRequests } from "./qualification-requests";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), retry: vi.fn(), error: false, loading: false }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ qualificationApplication: { mine: { invalidate: vi.fn() } } }),
  qualificationApplication: {
    submit: { useMutation: () => ({ mutate: mocks.submit }) },
    mine: { useQuery: () => ({ isLoading: mocks.loading, error: mocks.error ? { message: "Synthetic loading error" } : null, refetch: mocks.retry,
      data: mocks.loading || mocks.error ? undefined : {
        approved: [{ id: "science", name: "Science" }],
        options: [{ id: "history", name: "AP History", type: "ADDITIONAL_SUBJECT" }],
        requests: [{ id: "past", requestedSubject: { name: "History" }, type: "HIGHER_LEVEL", status: "REJECTED", qualificationReason: "Synthetic evidence", decisionComment: "More evidence needed", qualificationSnapshot: [], createdAt: new Date("2026-09-01T00:00:00Z") }],
      },
    }) },
  },
} }));
beforeEach(() => { vi.clearAllMocks(); mocks.error = false; mocks.loading = false; });
afterEach(cleanup);
const show = (active = true) => render(<NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={messages}><QualificationRequests active={active} /></NextIntlClientProvider>);

it("submits one chosen subject and evidence without any caller-supplied tutor identity", () => {
  show();
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "Request qualification" });
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Subject and level"), { target: { value: "history" } });
  fireEvent.change(screen.getByLabelText("Explain your qualifications"), { target: { value: "Completed the course" } });
  fireEvent.click(button);
  expect(mocks.submit).toHaveBeenCalledWith({ subjectId: "history", reason: "Completed the course" });
  expect(screen.getByText("Rejected")).toBeTruthy();
  expect(screen.getByText("Decision: More evidence needed")).toBeTruthy();
});
it("retains history and approved subjects while inactive without exposing submission controls", () => {
  show(false);
  expect(screen.getByText("Science")).toBeTruthy();
  expect(screen.getByText("Rejected")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Request qualification" })).toBeNull();
});
it("shows a loading state and a retry for a failed query", () => {
  mocks.loading = true; const view = show();
  expect(screen.getByRole("status").textContent).toBe("Loading qualifications…");
  view.unmount(); mocks.loading = false; mocks.error = true; show();
  expect(screen.getByRole("alert").textContent).toContain("Synthetic loading error");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});
