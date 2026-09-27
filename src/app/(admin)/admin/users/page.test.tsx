/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import { emptyUserFilters, type UserFilters } from "~/lib/user-filters";
import UsersPage from "./page";

const fixture = vi.hoisted(() => ({ viewerId: "synthetic-head", role: "HEAD", assign: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }));
vi.mock("~/trpc/react", () => {
  const mutation = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  return { api: {
    useUtils: () => ({ account: { me: { invalidate: vi.fn() } }, admin: { accounts: { invalidate: vi.fn() }, appeals: { invalidate: vi.fn() } } }),
    admin: {
      accounts: { useQuery: () => ({ data: { caller: { id: fixture.viewerId, role: fixture.role }, rows: [
        { userId: "synthetic-combined", name: "Combined account", role: "ADMIN", tutorId: "synthetic-tutor", tutorStatus: "ACTIVE", tuteeMember: false, tutorAccessRevoked: false, account: "registered", tutor: null, academic: { status: "REPORTED", gradeLevel: 10, schoolYear: "26-27", expectedGraduationYear: 2029, needsConfirmation: false } },
        { userId: "synthetic-management", name: "Management account", role: "ADMIN", tutorId: null, tutorStatus: null, tuteeMember: false, tutorAccessRevoked: false, account: "registered", tutor: null, academic: { status: "REPORTED", gradeLevel: 8, schoolYear: "26-27", expectedGraduationYear: 2031, needsConfirmation: true } },
        { userId: "synthetic-student", name: "Verified student", role: "STUDENT", username: null, emailVerifiedAt: new Date(), tutorId: null, tuteeMember: true, account: "registered", tutor: null },
        { userId: "synthetic-unverified", name: "Unverified student", role: "STUDENT", username: null, emailVerifiedAt: null, tutorId: null, tuteeMember: true, account: "registered", tutor: null },
      ] } }) },
      appeals: { useQuery: () => ({ data: [] }) },
      backfillStudentUsernames: { useMutation: () => ({ mutate: fixture.assign, isPending: false }) },
      deleteUser: mutation, suspendUser: mutation, reinstateUser: mutation,
      decideAppeal: mutation, sendTutorSetup: mutation,
    },
  } };
});
vi.mock("~/app/_components/email-details", () => ({ USER_ROW_ACTION: "shared-user-row-action", EmailDetails: () => null }));
vi.mock("~/app/_components/account-profile-editor", () => ({ AccountProfileEditor: () => null }));
vi.mock("~/app/_components/confirm-dialog", () => ({ useDialog: () => ({ dialog: null, promptText: vi.fn(), confirm: fixture.confirm }) }));

const storageKey = "shbs:user-filters:synthetic-head:v1";
const mount = () => render(<NextIntlClientProvider locale="en" messages={messages}><UsersPage /></NextIntlClientProvider>);
const statusControl = () => screen.queryByText(messages.admin.users.filters.status, { selector: "summary" });
const openRole = () => fireEvent.click(screen.getByText(messages.admin.users.filters.role, { selector: "summary" }));
beforeEach(() => { localStorage.clear(); fixture.viewerId = "synthetic-head"; fixture.role = "HEAD"; fixture.assign.mockClear(); fixture.confirm.mockClear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps full academic details out of the compact account table", () => {
  mount();
  expect(screen.queryByRole("columnheader", { name: messages.academics.title })).toBeNull();
  expect(screen.queryByText("Grade 10")).toBeNull();
  expect(screen.queryByText("Grade 8")).toBeNull();
  // The combined fixture also keeps the identity-branch student rows, so all four
  // account identities intentionally exercise the missing-username presentation.
  expect(screen.getAllByText(messages.academics.usernameMissing)).toHaveLength(4);
  expect(screen.queryByText(messages.academics.needsConfirmation)).toBeNull();
});

it("shows status for Tutor-only, then clears it on mixed selection and Tutor exclusion", () => {
  mount();
  expect(statusControl()).toBeNull();
  openRole();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Tutor" }));
  expect(statusControl()).not.toBeNull();
  expect(screen.queryByText("Combined account")).not.toBeNull();
  expect(screen.queryByText("Management account")).toBeNull();
  fireEvent.click(statusControl()!);
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Active" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Admin" }));
  expect(statusControl()).toBeNull();
  expect(screen.queryByText("Management account")).not.toBeNull();
  expect((JSON.parse(localStorage.getItem(storageKey)!) as UserFilters).status).toEqual({ include: [], exclude: [] });
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Admin" }));
  fireEvent.click(statusControl()!);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Include Active" }).checked).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Active" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Exclude Tutor" }));
  expect(statusControl()).toBeNull();
  expect((JSON.parse(localStorage.getItem(storageKey)!) as UserFilters).status).toEqual({ include: [], exclude: [] });
});

it("repairs stale saved status before it can remove unrestricted results", () => {
  const saved = emptyUserFilters();
  saved.status.include = ["PENDING"];
  localStorage.setItem(storageKey, JSON.stringify(saved));
  mount();
  expect(statusControl()).toBeNull();
  expect(screen.queryByText("Combined account")).not.toBeNull();
  expect(screen.queryByText("Management account")).not.toBeNull();
  expect((JSON.parse(localStorage.getItem(storageKey)!) as UserFilters).status).toEqual({ include: [], exclude: [] });
});

it("restores applicable status and resets visibility when all filters are cleared", () => {
  const saved = emptyUserFilters();
  saved.role.include = ["TUTOR"];
  saved.status.include = ["ACTIVE"];
  localStorage.setItem(storageKey, JSON.stringify(saved));
  mount();
  expect(statusControl()).not.toBeNull();
  expect(screen.queryByText("Combined account")).not.toBeNull();
  expect(screen.queryByText("Management account")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: messages.userMultiFilters.clear }));
  expect(statusControl()).toBeNull();
  expect(screen.queryByText("Management account")).not.toBeNull();
});

it("keeps filters usable when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
  mount();
  openRole();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Tutor" }));
  expect(statusControl()).not.toBeNull();
});

it("lets Head review one verified student's missing username before assignment", async () => {
  mount();
  const buttons = screen.getAllByRole("button", { name: messages.identityUsername.assign });
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]!);
  await waitFor(() => expect(fixture.assign).toHaveBeenCalledWith({ userIds: ["synthetic-student"] }));
  expect(fixture.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Assign a Username to Verified student" }));
});
it("hides student username backfill from other staff", () => {
  fixture.role = "ADMIN";
  mount();
  expect(screen.queryByRole("button", { name: messages.identityUsername.assign })).toBeNull();
});
