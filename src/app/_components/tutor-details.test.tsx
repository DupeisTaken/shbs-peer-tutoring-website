// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { TutorDetailsButton } from "./tutor-details";
import { ReadOnlyProvider } from "./read-only";

const mocks = vi.hoisted(() => ({ details: vi.fn(), history: vi.fn(), refetch: vi.fn() }));
vi.mock("~/trpc/react", () => ({ api: {
  tutorDetails: { get: { useQuery: mocks.details } },
  student: { acceptanceRecords: { useQuery: mocks.history } },
} }));

const detail = {
  id: "synthetic-tutor", name: "Synthetic Tutor", userId: "synthetic-user", email: null,
  alternativeNames: null, username: null, gradeLevel: 11, status: "ACTIVE", tutorAccessRevoked: false,
  badges: ["TUTOR"], groups: [{ id: "cs", name: "Computer Science", subjects: [
    { id: "intro", name: "Intro to Computer Science", active: true, level: "Standard", qualified: true, approval: null, inheritedFrom: [{ id: "ap", name: "AP Computer Science A" }], willing: false },
    { id: "ap", name: "AP Computer Science A", active: true, level: "AP", qualified: true, approval: "APPROVED", inheritedFrom: [], willing: null },
    { id: "honors", name: "Honors Computer Science", active: true, level: "Honors", qualified: false, approval: "PENDING", inheritedFrom: [], willing: true },
  ] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  mocks.details.mockReturnValue({ data: detail });
  mocks.history.mockReturnValue({ data: { current: [{ slug: "tutee-policy", documents: [], published: true, acceptedAt: null }], rows: [], more: false } });
});
afterEach(cleanup);

function show(readOnly = false, tutorId = "synthetic-tutor") {
  return render(<NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai"><ReadOnlyProvider value={readOnly}><TutorDetailsButton tutorId={tutorId} name="Synthetic Tutor" /></ReadOnlyProvider></NextIntlClientProvider>);
}
function open() { fireEvent.click(screen.getByRole("button", { name: "View user details for Synthetic Tutor" })); }

it("opens an accessible person-scoped dialog on demand, with separate qualification and willingness", () => {
  show();
  expect(mocks.details).not.toHaveBeenCalled();
  open();
  expect(screen.getByRole("dialog", { name: "User details · Synthetic Tutor" })).toBeTruthy();
  expect(mocks.details).toHaveBeenCalledWith({ tutorId: "synthetic-tutor" });
  const rows = screen.getAllByRole("listitem");
  expect(within(rows[0]!).getByText("Approved")).toBeTruthy();
  expect(within(rows[0]!).getByText("Not willing")).toBeTruthy();
  expect(within(rows[0]!).getByText("Recorded grant from AP Computer Science A")).toBeTruthy();
  expect(within(rows[1]!).getByText("Not recorded")).toBeTruthy();
  expect(within(rows[2]!).getByText("Pending approval")).toBeTruthy();
  expect(within(rows[2]!).getByText("Willing")).toBeTruthy();
  expect(screen.getByText("Current revision needs acceptance")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /edit|make head/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not expose the staff-only action or fetch history to a viewer", () => {
  show(true);
  expect(screen.queryByRole("button")).toBeNull();
  expect(mocks.details).not.toHaveBeenCalled();
  expect(mocks.history).not.toHaveBeenCalled();
});

it("shows an unlinked tutor without inventing membership or acceptance", () => {
  mocks.details.mockReturnValue({ data: { ...detail, userId: null, badges: [], groups: [] } });
  show(); open();
  expect(screen.getByText("No linked login")).toBeTruthy();
  expect(screen.getByText(en.accountProfile.noAccountHistory)).toBeTruthy();
  expect(screen.getByText("No subjects to display.")).toBeTruthy();
  expect(mocks.history).not.toHaveBeenCalled();
});

it("loads exact acceptance history by linked account even with no email", () => {
  mocks.history.mockReturnValue({ data: {
    current: [{ slug: "tutee-policy", documents: [], published: true, acceptedAt: new Date("2026-09-01") }],
    rows: [{ id: "past", slug: "tutee-policy", signature: "Synthetic Tutor", acceptedAt: new Date("2026-09-01"), documents: [{ locale: "en", title: "Original policy", version: "1", body: "Original consent words" }] }], more: false,
  } });
  show(); open();
  expect(mocks.history).toHaveBeenCalledWith({ userId: "synthetic-user", page: 0 });
  expect(screen.getByText("Original consent words")).toBeTruthy();
  expect(screen.getByText(en.policyHistory.currentAccepted)).toBeTruthy();
  expect(screen.getAllByText(en.admin.users.roles.TUTOR)).toHaveLength(1);
  expect(screen.queryByText(en.admin.users.roles.STUDENT)).toBeNull();
});

it("preserves historical details and clearly identifies revoked tutoring access", () => {
  mocks.details.mockReturnValue({ data: { ...detail, tutorAccessRevoked: true, badges: [] } });
  show(); open();
  expect(screen.getByText(en.tutorDetails.accessRevoked)).toBeTruthy();
  expect(mocks.history).toHaveBeenCalledWith({ userId: "synthetic-user", page: 0 });
});

it("announces loading and offers retry for a failed query", () => {
  mocks.details.mockReturnValue({ isLoading: true });
  const view = show(); open();
  expect(screen.getByRole("status").textContent).toBe(en.tutorDetails.loading);
  view.unmount();
  mocks.details.mockReturnValue({ error: new Error("Unavailable"), refetch: mocks.refetch });
  show(); open();
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(mocks.history).not.toHaveBeenCalled();
});
