// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { StudentRequestBoard } from "./student-request-board";
import RequestsPage from "./page";

const mocks = vi.hoisted(() => ({
  survey: true,
  invalid: true,
  source: "SELF_SERVICE",
  assigned: false,
}));
vi.mock("~/app/_components/email-details", () => ({
  EmailDetails: () => null,
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/app/_components/qualified-tutor-select", () => ({
  QualifiedTutorSelect: ({ label }: { label: string }) => (
    <select aria-label={label}>
      <option>Choose</option>
    </select>
  ),
}));
vi.mock("~/app/_components/request-invalidity-controls", () => ({
  StudentRequestInvalidityControls: ({ canFlag }: { canFlag: boolean }) =>
    canFlag ? <button>Survey flag editor</button> : null,
  SignupInvalidityControls: () => <button>Legacy flag editor</button>,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    account: { me: { useQuery: () => ({ data: { role: "HEAD" } }) } },
    studentWorkflow: {
      adminRequests: {
        useQuery: () => ({
          data: mocks.survey
            ? [
                {
                  id: "survey-1",
                  name: "Public survey student",
                  email: "student@example.test",
                  contact: "Email",
                  state: "OPEN",
                  confirmedAt: new Date("2026-10-01"),
                  submittedAt: new Date("2026-10-01"),
                  editedAt: null,
                  verificationDueAt: null,
                  subjects: [{ id: "math", name: "Mathematics" }],
                  slots: [],
                  reviews: [],
                  pairings: mocks.assigned
                    ? [
                        {
                          subject: "Mathematics",
                          tutor: { englishName: "Existing Tutor" },
                        },
                      ]
                    : [],
                  isInvalid: mocks.invalid,
                  invalidReason: "Private staff reason",
                  invalidatedAt: new Date("2026-10-10"),
                  invalidityVersion: 1,
                },
              ]
            : [],
        }),
      },
      legacyReviews: { useQuery: () => ({ data: [] }) },
      resend: { useMutation: () => ({ mutate: vi.fn() }) },
      assign: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    admin: {
      tutors: { useQuery: () => ({ data: [] }) },
      currentPeriod: { useQuery: () => ({ data: { termId: "term-1" } }) },
      pairings: { useQuery: () => ({ data: [] }) },
      tutees: {
        useQuery: () => ({
          data: [
            {
              id: "legacy-1",
              status: "PENDING",
              intakeTermId: "term-1",
              englishName: "Legacy public student",
              signupSource: mocks.source,
              signupSubmittedAt: new Date("2026-10-01"),
              createdAt: new Date("2026-10-01"),
              updatedAt: new Date("2026-10-01"),
              isInvalid: mocks.invalid,
              invalidReason: "Private staff reason",
              invalidatedAt: new Date("2026-10-10"),
              invalidityVersion: 1,
              gradeLevel: null,
              email: null,
              phone: null,
              preferredContact: null,
              signedRulebook: false,
              signatureName: null,
              firstChoice: { id: "math", name: "Mathematics" },
              secondChoice: null,
              availabilities: [],
              bannedMatch: null,
            },
          ],
        }),
      },
      assignSignup: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteTutee: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
const show = (legacy = false, viewer = false) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <ReadOnlyProvider value={viewer}>
        {legacy ? <RequestsPage /> : <StudentRequestBoard />}
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  mocks.survey = true;
  mocks.invalid = true;
  mocks.source = "SELF_SERVICE";
  mocks.assigned = false;
});
afterEach(cleanup);

it("keeps a flagged public request visible in its original queue without assignment controls or inline private reason", () => {
  show();
  expect(screen.getByText("Public survey student")).toBeTruthy();
  expect(screen.getByText("Invalid entry")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Survey flag editor" }),
  ).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByText("Private staff reason")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Not flagged" }));
  expect(screen.queryByText("Public survey student")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  expect(screen.getByText("Public survey student")).toBeTruthy();
});

it("retains prior assignment evidence for an invalid request", () => {
  mocks.assigned = true;
  show();
  fireEvent.click(screen.getByRole("tab", { name: /Assigned.*1/ }));
  expect(screen.getByText("Existing Tutor")).toBeTruthy();
  expect(screen.getByText("Invalid entry")).toBeTruthy();
});

it("allows matching an unflagged request and excludes it from the invalid filter", () => {
  mocks.invalid = false;
  show();
  expect(screen.getByRole("combobox")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  expect(screen.queryByText("Public survey student")).toBeNull();
});

it("includes legacy public signups in the invalid filter and blocks further assignment", () => {
  mocks.survey = false;
  show(true);
  fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  expect(screen.getByText(/Legacy public student/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Legacy flag editor" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.admin.requests.decline }),
  ).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("does not offer invalid flags for staff-created intake rows", () => {
  mocks.survey = false;
  mocks.invalid = false;
  mocks.source = "STAFF";
  show(true);
  expect(
    screen.queryByRole("button", { name: "Legacy flag editor" }),
  ).toBeNull();
});

it("keeps the viewer's legacy summary free of private flag actions and reasons", () => {
  mocks.survey = false;
  show(true, true);
  expect(screen.getByText("Invalid entry")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Legacy flag editor" }),
  ).toBeNull();
  expect(screen.queryByText("Private staff reason")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});
