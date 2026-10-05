/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import { emptyUserFilters, type UserFilters } from "~/lib/user-filters";
import UsersPage from "./page";
vi.mock("~/app/_components/combine-accounts", () => ({
  CombineAccounts: () => <div>Head combine controls</div>,
}));

const fixture = vi.hoisted(() => ({
  viewerId: "synthetic-head",
  role: "HEAD",
  assign: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/trpc/react", () => {
  const mutation = {
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
  return {
    api: {
      useUtils: () => ({
        account: { me: { invalidate: vi.fn() } },
        admin: {
          accounts: { invalidate: vi.fn() },
          appeals: { invalidate: vi.fn() },
        },
      }),
      admin: {
        tutors: {
          useQuery: () => ({
            data: [{ id: "archived", englishName: "Past tutor", user: null }],
          }),
        },
        accounts: {
          useQuery: () => ({
            data: {
              caller: { id: fixture.viewerId, role: fixture.role },
              rows: [
                {
                  userId: null,
                  name: "Past tutor",
                  role: null,
                  tutorId: "archived",
                  tutorStatus: "ARCHIVED",
                  tuteeMember: false,
                  tutorAccessRevoked: false,
                  account: "none",
                  tutorHasEmail: false,
                  tutor: { englishName: "Past tutor", username: "pasttutor" },
                  academic: {},
                },
                {
                  userId: "synthetic-combined",
                  name: "Combined account",
                  role: "ADMIN",
                  tutorId: "synthetic-tutor",
                  tutorStatus: "ACTIVE",
                  tuteeMember: false,
                  tutorAccessRevoked: false,
                  account: "registered",
                  tutor: null,
                  academic: {
                    status: "REPORTED",
                    gradeLevel: 10,
                    schoolYear: "26-27",
                    expectedGraduationYear: 2029,
                    needsConfirmation: false,
                  },
                },
                {
                  userId: "synthetic-management",
                  name: "Management account",
                  role: "ADMIN",
                  tutorId: null,
                  tutorStatus: null,
                  tuteeMember: false,
                  tutorAccessRevoked: false,
                  account: "registered",
                  tutor: null,
                  academic: {
                    status: "REPORTED",
                    gradeLevel: 8,
                    schoolYear: "26-27",
                    expectedGraduationYear: 2031,
                    needsConfirmation: true,
                  },
                },
                {
                  userId: "synthetic-student",
                  name: "Verified student",
                  role: "STUDENT",
                  username: null,
                  emailVerifiedAt: new Date(),
                  tutorId: null,
                  tuteeMember: true,
                  account: "registered",
                  tutor: null,
                },
                {
                  userId: "synthetic-unverified",
                  name: "Unverified student",
                  role: "STUDENT",
                  username: null,
                  emailVerifiedAt: null,
                  tutorId: null,
                  tuteeMember: true,
                  account: "registered",
                  tutor: null,
                },
              ],
            },
          }),
        },
        appeals: { useQuery: () => ({ data: [] }) },
        backfillStudentUsernames: {
          useMutation: () => ({ mutate: fixture.assign, isPending: false }),
        },
        deleteUser: mutation,
        suspendUser: mutation,
        reinstateUser: mutation,
        decideAppeal: mutation,
        sendTutorSetup: mutation,
      },
    },
  };
});
vi.mock("~/app/_components/email-details", () => ({
  EmailDetails: ({ triggerClassName }: { triggerClassName?: string }) => (
    <button className={`table-action-link ${triggerClassName ?? ""}`}>
      User details
    </button>
  ),
}));
vi.mock("~/app/_components/account-profile-editor", () => ({
  AccountProfileEditor: () => null,
}));
vi.mock("~/app/_components/tutor-profile-editor", () => ({
  TutorProfileEditor: ({ row }: { row: { id: string } }) => (
    <div role="dialog">Editing tutor {row.id}</div>
  ),
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({
    dialog: null,
    promptText: vi.fn(),
    confirm: fixture.confirm,
  }),
}));

const storageKey = "shbs:user-filters:synthetic-head:v1";
const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <UsersPage />
    </NextIntlClientProvider>,
  );
const statusControl = () =>
  screen.queryByText(messages.admin.users.filters.status, {
    selector: "summary",
  });
const openRole = () =>
  fireEvent.click(
    screen.getByText(messages.admin.users.filters.role, {
      selector: "summary",
    }),
  );
beforeEach(() => {
  localStorage.clear();
  fixture.viewerId = "synthetic-head";
  fixture.role = "HEAD";
  fixture.assign.mockClear();
  fixture.confirm.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps full academic details out of the compact account table", () => {
  mount();
  expect(
    screen.queryByRole("columnheader", { name: messages.academics.title }),
  ).toBeNull();
  expect(screen.queryByText("Grade 10")).toBeNull();
  expect(screen.queryByText("Grade 8")).toBeNull();
  // Unverified accounts are hidden by default; the three visible accounts still
  // exercise the missing-username presentation.
  expect(screen.getAllByText(messages.academics.usernameMissing)).toHaveLength(
    3,
  );
  expect(screen.queryByText(messages.academics.needsConfirmation)).toBeNull();
});

it("reveals past tutors, preserves account filters, persists and clears back to the default", () => {
  const saved = emptyUserFilters();
  saved.account.include = ["none"];
  localStorage.setItem(storageKey, JSON.stringify(saved));
  mount();
  expect(screen.queryByText("@pasttutor")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tuteeHistory.showHistorical }),
  );
  expect(screen.getByText("@pasttutor")).toBeTruthy();
  const stored = JSON.parse(localStorage.getItem(storageKey)!) as UserFilters;
  expect(stored.account.include).toEqual(["none"]);
  expect(stored.showPastTutors).toBe(true);
  cleanup();
  mount();
  expect(
    screen
      .getByRole("button", { name: messages.tuteeHistory.hideHistorical })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  const row = screen.getByText("@pasttutor").closest("tr")!;
  expect(
    within(row).getByRole<HTMLButtonElement>("button", {
      name: messages.admin.tutors.account.sendSetup,
    }).disabled,
  ).toBe(true);
  fireEvent.click(within(row).getByRole("button", { name: "Edit profile" }));
  expect(screen.getByRole("dialog").textContent).toBe("Editing tutor archived");
  fireEvent.click(
    screen.getByRole("button", { name: messages.userMultiFilters.clear }),
  );
  expect(screen.queryByText("@pasttutor")).toBeNull();
  expect(
    screen.getByRole("button", { name: messages.tuteeHistory.showHistorical }),
  ).toBeTruthy();
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
  expect(
    (JSON.parse(localStorage.getItem(storageKey)!) as UserFilters).status,
  ).toEqual({ include: [], exclude: [] });
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Admin" }));
  fireEvent.click(statusControl()!);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Include Active" })
      .checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Active" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Exclude Tutor" }));
  expect(statusControl()).toBeNull();
  expect(
    (JSON.parse(localStorage.getItem(storageKey)!) as UserFilters).status,
  ).toEqual({ include: [], exclude: [] });
});

it("repairs stale saved status before it can remove unrestricted results", () => {
  const saved = emptyUserFilters();
  saved.status.include = ["PENDING"];
  localStorage.setItem(storageKey, JSON.stringify(saved));
  mount();
  expect(statusControl()).toBeNull();
  expect(screen.queryByText("Combined account")).not.toBeNull();
  expect(screen.queryByText("Management account")).not.toBeNull();
  expect(
    (JSON.parse(localStorage.getItem(storageKey)!) as UserFilters).status,
  ).toEqual({ include: [], exclude: [] });
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
  fireEvent.click(
    screen.getByRole("button", { name: messages.userMultiFilters.clear }),
  );
  expect(statusControl()).toBeNull();
  expect(screen.queryByText("Management account")).not.toBeNull();
});

it("keeps filters usable when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  mount();
  openRole();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Tutor" }));
  expect(statusControl()).not.toBeNull();
});

it("lets Head review one verified student's missing username before assignment", async () => {
  mount();
  const buttons = screen.getAllByRole("button", {
    name: messages.identityUsername.assign,
  });
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]!);
  await waitFor(() =>
    expect(fixture.assign).toHaveBeenCalledWith({
      userIds: ["synthetic-student"],
    }),
  );
  expect(fixture.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Assign a Username to Verified student" }),
  );
});
it("hides student username backfill from other staff", () => {
  fixture.role = "ADMIN";
  mount();
  expect(
    screen.queryByRole("button", { name: messages.identityUsername.assign }),
  ).toBeNull();
});

it("shares compact text styling across details, edit, username assignment and deletion", () => {
  mount();
  const row = screen.getByText("Verified student").closest("tr")!;
  const group = row.querySelector(".table-action-list")!;
  const actions = group.querySelectorAll("button");
  expect(actions).toHaveLength(4);
  for (const action of actions)
    expect(action.classList.contains("table-action-link")).toBe(true);
  expect(actions[2]!.textContent).toBe(messages.identityUsername.assign);
  expect(actions[3]!.classList.contains("text-red-600")).toBe(true);
});

it("reveals unverified accounts explicitly and resets the saved choice", () => {
  mount();
  expect(screen.queryByText("Unverified student")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tuteeHistory.showUnverified }),
  );
  expect(screen.getByText("Unverified student")).toBeTruthy();
  expect(
    (JSON.parse(localStorage.getItem(storageKey)!) as UserFilters)
      .showUnverified,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: messages.userMultiFilters.clear }),
  );
  expect(screen.queryByText("Unverified student")).toBeNull();
});
