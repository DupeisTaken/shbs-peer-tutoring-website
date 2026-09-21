/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import { emptyUserFilters, type UserFilters } from "~/lib/user-filters";
import UsersPage from "./page";

const fixture = vi.hoisted(() => ({ viewerId: "synthetic-head" }));
vi.mock("~/trpc/react", () => {
  const mutation = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  return { api: {
    useUtils: () => ({ admin: { accounts: { invalidate: vi.fn() }, appeals: { invalidate: vi.fn() } } }),
    admin: {
      accounts: { useQuery: () => ({ data: { caller: { id: fixture.viewerId, role: "HEAD" }, rows: [
        { userId: "synthetic-combined", name: "Combined account", role: "ADMIN", tutorId: "synthetic-tutor", tutorStatus: "ACTIVE", tuteeMember: false, tutorAccessRevoked: false, account: "registered", tutor: null },
        { userId: "synthetic-management", name: "Management account", role: "ADMIN", tutorId: null, tutorStatus: null, tuteeMember: false, tutorAccessRevoked: false, account: "registered", tutor: null },
      ] } }) },
      appeals: { useQuery: () => ({ data: [] }) },
      deleteUser: mutation, suspendUser: mutation, reinstateUser: mutation,
      decideAppeal: mutation, sendTutorSetup: mutation,
    },
  } };
});
vi.mock("~/app/_components/email-details", () => ({ EmailDetails: () => null }));
vi.mock("~/app/_components/account-profile-editor", () => ({ AccountProfileEditor: () => null }));
vi.mock("~/app/_components/confirm-dialog", () => ({ useDialog: () => ({ dialog: null, promptText: vi.fn() }) }));

const storageKey = "shbs:user-filters:synthetic-head:v1";
const mount = () => render(<NextIntlClientProvider locale="en" messages={messages}><UsersPage /></NextIntlClientProvider>);
const statusControl = () => screen.queryByText(messages.admin.users.filters.status, { selector: "summary" });
const openRole = () => fireEvent.click(screen.getByText(messages.admin.users.filters.role, { selector: "summary" }));
beforeEach(() => { localStorage.clear(); fixture.viewerId = "synthetic-head"; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
