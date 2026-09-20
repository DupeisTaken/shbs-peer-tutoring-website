// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { QualificationReview } from "./qualification-review";

const mocks = vi.hoisted(() => ({ role: "ADMIN", tutorId: "reviewer", decide: vi.fn() }));
vi.mock("~/trpc/react", () => ({ api: {
  account: { me: { useQuery: () => ({ data: { role: mocks.role, tutorId: mocks.tutorId } }) } },
  qualificationApplication: { decide: { useMutation: () => ({ mutate: mocks.decide }) } },
  useUtils: () => ({ qualificationApplication: { mine: { invalidate: vi.fn() } }, subjectAvailability: { options: { invalidate: vi.fn() } } }),
} }));
const base = { id: "request", status: "PENDING", updatedAt: new Date("2026-09-01T00:00:00Z"), decisionComment: null, requestedTutorId: "applicant", qualificationReason: "Synthetic evidence" };
beforeEach(() => { vi.clearAllMocks(); mocks.role = "ADMIN"; mocks.tutorId = "reviewer"; });
afterEach(cleanup);
const show = (app = base) => render(<NextIntlClientProvider locale="en" messages={messages}><QualificationReview app={app} onChanged={vi.fn()} /></NextIntlClientProvider>);

it.each(["ADMIN", "HEAD"])("allows %s to decide after recording a note", role => {
  mocks.role = role; show();
  const approve = screen.getByRole<HTMLButtonElement>("button", { name: "Approve qualification" });
  expect(approve.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "Evidence reviewed" } });
  fireEvent.click(approve);
  expect(mocks.decide).toHaveBeenCalledWith({ id: "request", accept: true, comment: "Evidence reviewed", expectedUpdatedAt: base.updatedAt });
});
it.each(["COORDINATOR", "VIEWER", "TUTOR"])("hides decision controls for %s", role => {
  mocks.role = role; show();
  expect(screen.queryByRole("button", { name: "Approve qualification" })).toBeNull();
  expect(screen.getByText("Another Admin or Head must review this request.")).toBeTruthy();
});
it("hides self-review and final decision controls", () => {
  mocks.tutorId = "applicant"; const view = show();
  expect(screen.queryByLabelText("Decision note")).toBeNull();
  view.unmount(); mocks.tutorId = "reviewer"; show({ ...base, status: "ACCEPTED" });
  expect(screen.queryByLabelText("Decision note")).toBeNull();
});
