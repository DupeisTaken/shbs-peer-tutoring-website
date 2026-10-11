/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../messages/en.json";
import { emptyUserFilters, type UserFilters } from "~/lib/user-filters";
import UsersPage from "./page";
vi.mock("~/app/_components/combine-accounts", () => ({
  CombineAccounts: () => <div>Head combine controls</div>,
}));

type DeleteCallbacks = {
  onSuccess: () => void;
  onError: (error: { message: string }) => void;
  onSettled: () => void;
};
const fixture = vi.hoisted(() => ({
  viewerId: "synthetic-head",
  role: "HEAD",
  targetSelf: false,
  targetRole: "ADMIN",
  accountsError: null as { message: string } | null,
  accountsRefetch: vi.fn<() => Promise<void>>(),
  delete: vi.fn<(input: { userId: string; confirmPassword: string }) => void>(),
  deleteCallbacks: undefined as DeleteCallbacks | undefined,
  assign: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
  appeals: [] as {
    id: string;
    name: string;
    message: string;
    affiliation: string | null;
    createdAt: Date;
    userId: string;
  }[],
  appealError: null as null | { message: string; data?: { code?: string } },
  decisionError: null as null | { message: string },
  decisionPending: false,
  decision: vi.fn(),
  refresh: vi.fn<() => Promise<void>>(),
  refetch: vi.fn(),
  completion: undefined as undefined | (() => Promise<void>),
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["appeal-test"] }));
vi.mock("~/trpc/react", () => {
  const mutation = {
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
  return {
    api: {
      useUtils: () => ({
        account: { me: { invalidate: vi.fn() } },
        admin: {
          accounts: { invalidate: fixture.refresh },
          appeals: { invalidate: fixture.refresh },
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
            error: fixture.accountsError,
            refetch: fixture.accountsRefetch,
            isFetching: false,
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
                  isSelf: fixture.targetSelf,
                  role: fixture.targetRole,
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
        appeals: {
          useQuery: () => ({
            data: fixture.appeals,
            error: fixture.appealError,
            isSuccess: !fixture.appealError,
            isFetching: false,
            refetch: fixture.refetch,
          }),
        },
        backfillStudentUsernames: {
          useMutation: () => ({ mutate: fixture.assign, isPending: false }),
        },
        deleteUser: {
          useMutation: (options: DeleteCallbacks) => {
            fixture.deleteCallbacks = options;
            return { mutate: fixture.delete, isPending: false };
          },
        },
        suspendUser: mutation,
        reinstateUser: mutation,
        decideAppeal: {
          useMutation: (options: {
            onSuccess: (
              result: unknown,
              input: { appealId: string; action: string },
            ) => Promise<void>;
            onSettled: () => void;
          }) => ({
            mutate: (input: { appealId: string; action: string }) => {
              fixture.decision(input);
              fixture.completion = async () => {
                await options.onSuccess({}, input);
                options.onSettled();
              };
            },
            isPending: fixture.decisionPending,
            error: fixture.decisionError,
            reset: vi.fn(),
          }),
        },
        sendTutorSetup: mutation,
      },
    },
  };
});
vi.mock("./user-details", () => ({
  UserDetails: () => (
    <button className="table-action-link">User details</button>
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
let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  </QueryClientProvider>
);
const mount = () => render(<UsersPage />, { wrapper });
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
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  localStorage.clear();
  fixture.viewerId = "synthetic-head";
  fixture.role = "HEAD";
  fixture.accountsError = null;
  fixture.accountsRefetch.mockReset().mockResolvedValue(undefined);
  fixture.targetSelf = false;
  fixture.targetRole = "ADMIN";
  fixture.delete.mockClear();
  fixture.deleteCallbacks = undefined;
  fixture.assign.mockClear();
  fixture.confirm.mockClear();
  fixture.appeals = [];
  fixture.appealError = null;
  fixture.decisionError = null;
  fixture.decisionPending = false;
  fixture.decision.mockClear();
  fixture.refresh.mockReset().mockResolvedValue(undefined);
  fixture.refetch.mockReset();
  fixture.completion = undefined;
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fullAppeal =
  "Original appeal first paragraph.\n\n" +
  "Supporting explanation with the complete original circumstances. ".repeat(
    12,
  );
const seedAppeal = () => {
  fixture.appeals = [
    {
      id: "appeal",
      name: "Appealing student",
      message: fullAppeal,
      affiliation: "Grade 10",
      createdAt: new Date(),
      userId: "student",
    },
  ];
};

it("reads the complete appeal before offering decisions and restores its opener on Escape", () => {
  seedAppeal();
  mount();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  const opener = screen.getByRole("button", { name: "Review appeal" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", {
    name: "Review appeal · Appealing student",
  });
  expect(
    within(dialog).getByText(/Original appeal first paragraph/).textContent,
  ).toBe(fullAppeal);
  expect(fixture.decision).not.toHaveBeenCalled();
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("blocks dismissal and repeated decisions while the appeal write is pending", () => {
  seedAppeal();
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Review appeal" }));
  const approve = screen.getByRole("button", { name: "Approve" });
  fireEvent.click(approve);
  fireEvent.click(approve);
  expect(fixture.decision).toHaveBeenCalledExactlyOnceWith({
    appealId: "appeal",
    action: "APPROVE",
  });
  fixture.decisionPending = true;
  view.rerender(<UsersPage />);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled,
  ).toBe(true);
  expect(approve.matches(":disabled")).toBe(true);
  const dialog = screen.getByRole("dialog");
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
});

it("retains a failed decision and recovers an accepted decision with reads only", async () => {
  seedAppeal();
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Review appeal" }));
  fixture.decisionError = { message: "Synthetic decision failure" };
  view.rerender(<UsersPage />);
  expect(screen.getByText("Synthetic decision failure")).toBeTruthy();
  expect(screen.getByText(/Original appeal first paragraph/).textContent).toBe(
    fullAppeal,
  );
  fixture.decisionError = null;
  fixture.refresh.mockRejectedValue(new Error("Synthetic refresh failure"));
  view.rerender(<UsersPage />);
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await act(async () => {
    await fixture.completion?.();
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Approve" }).disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("decision was saved");
  fixture.refresh.mockResolvedValue(undefined);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Retry.*appeals/i }));
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fixture.decision).toHaveBeenCalledOnce();
});

it("evicts denied appeals and does not reveal stale evidence after a network failure", () => {
  seedAppeal();
  queryClient.setQueryData(["appeal-test"], fixture.appeals);
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Review appeal" }));
  fixture.appealError = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(<UsersPage />);
  expect(screen.queryByText(/Original appeal first paragraph/)).toBeNull();
  expect(queryClient.getQueryData(["appeal-test"])).toBeUndefined();
  fixture.appealError = { message: "Network failure" };
  view.rerender(<UsersPage />);
  expect(screen.queryByRole("button", { name: "Review appeal" })).toBeNull();
  fixture.appealError = null;
  view.rerender(<UsersPage />);
  expect(screen.getByRole("button", { name: "Review appeal" })).toBeTruthy();
});

it("keeps full academic details out of the compact account table", () => {
  mount();
  expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  expect(
    screen.queryByRole("columnheader", {
      name: messages.admin.users.columns.linkedTutor,
    }),
  ).toBeNull();
  expect(
    screen.getByRole("columnheader", { name: /Login setup/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("columnheader", { name: /Roles & participation/ }),
  ).toBeTruthy();
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

it("keeps account profiles and ranks out of Coordinator edit actions", () => {
  fixture.role = "COORDINATOR";
  mount();
  const management = screen.getByText("Management account").closest("tr")!;
  expect(
    within(management).queryByRole("button", {
      name: messages.accountProfile.editProfile,
    }),
  ).toBeNull();
});

it("composes saved identity search with existing roster scope and restores it on clear", () => {
  mount();
  const search = screen.getByRole("searchbox", {
    name: messages.rosterSearch.label,
  });
  fireEvent.change(search, { target: { value: "pasttutor" } });
  expect(screen.getByText(messages.rosterSearch.noMatches)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tuteeHistory.showHistorical }),
  );
  expect(screen.getByRole("table").textContent).toContain("Past tutor");
  expect(screen.getByRole("table").textContent).not.toContain(
    "Combined account",
  );
  fireEvent.change(search, { target: { value: "missing synthetic identity" } });
  expect(screen.getByText(messages.rosterSearch.noMatches)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.rosterSearch.clear }),
  );
  expect(screen.getByRole("table").textContent).toContain("Combined account");
});

const openDeletion = () => {
  const row = screen.getByText("Management account").closest("tr")!;
  const opener = within(row).getByRole<HTMLButtonElement>("button", {
    name: messages.admin.users.delete,
  });
  opener.focus();
  fireEvent.click(opener);
  return opener;
};
it("names the deletion dialog and binds a fresh password; idle Escape restores its opener", async () => {
  mount();
  const opener = openDeletion();
  const dialog = screen.getByRole("dialog", {
    name: messages.admin.users.confirm.deleteTitle,
  });
  expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
  expect(dialog.textContent).toContain("Management account");
  const password = screen.getByLabelText<HTMLInputElement>(
    messages.admin.users.confirm.passwordLabel,
  );
  expect(password.value).toBe("");
  expect(document.activeElement).toBe(password);
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: messages.admin.users.delete,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(password.closest("form")!);
  expect(fixture.delete).not.toHaveBeenCalled();
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
  openDeletion();
  expect(
    screen.getByLabelText<HTMLInputElement>(
      messages.admin.users.confirm.passwordLabel,
    ).value,
  ).toBe("");
});
it("admits a native deletion submission once and preserves rejection correction", () => {
  mount();
  openDeletion();
  const password = screen.getByLabelText<HTMLInputElement>(
    messages.admin.users.confirm.passwordLabel,
  );
  fireEvent.change(password, { target: { value: "synthetic password" } });
  const form = password.closest("form")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(fixture.delete).toHaveBeenCalledExactlyOnceWith({
    userId: "synthetic-management",
    confirmPassword: "synthetic password",
  });
  expect(password.matches(":disabled")).toBe(true);
  const dialog = screen.getByRole("dialog");
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  act(() => {
    fixture.deleteCallbacks!.onError({ message: "Password rejected" });
    fixture.deleteCallbacks!.onSettled();
  });
  expect(password.matches(":disabled")).toBe(false);
  expect(password.value).toBe("synthetic password");
  expect(screen.getByRole("alert").textContent).toBe("Password rejected");
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: messages.admin.users.confirm.cancel,
    }),
  );
  openDeletion();
  expect(
    screen.getByLabelText<HTMLInputElement>(
      messages.admin.users.confirm.passwordLabel,
    ).value,
  ).toBe("");
});
it("closes accepted deletion and refreshes once without replaying the write", () => {
  mount();
  openDeletion();
  const password = screen.getByLabelText<HTMLInputElement>(
    messages.admin.users.confirm.passwordLabel,
  );
  fireEvent.change(password, { target: { value: "synthetic password" } });
  fireEvent.submit(password.closest("form")!);
  act(() => {
    fixture.deleteCallbacks!.onSuccess();
    fixture.deleteCallbacks!.onSettled();
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fixture.refresh).toHaveBeenCalledTimes(1);
  expect(fixture.delete).toHaveBeenCalledTimes(1);
});
it.each(["ADMIN", "COORDINATOR", "VIEWER"])(
  "offers no account deletion to %s",
  (role) => {
    fixture.role = role;
    mount();
    expect(
      screen.queryByRole("button", { name: messages.admin.users.delete }),
    ).toBeNull();
  },
);
it.each(["self", "head"])(
  "withholds account deletion for a %s target",
  (kind) => {
    fixture.targetSelf = kind === "self";
    fixture.targetRole = kind === "head" ? "HEAD" : "ADMIN";
    mount();
    expect(
      within(screen.getByText("Management account").closest("tr")!).queryByRole(
        "button",
        { name: messages.admin.users.delete },
      ),
    ).toBeNull();
  },
);

it("recovers only account reads after accepted deletion followed by refresh failure", () => {
  const view = mount();
  openDeletion();
  const password = screen.getByLabelText<HTMLInputElement>(
    messages.admin.users.confirm.passwordLabel,
  );
  fireEvent.change(password, { target: { value: "synthetic password" } });
  // Query invalidation resolves normally while its retained query reports a failed refetch.
  fixture.refresh.mockImplementation(async () => {
    fixture.accountsError = { message: "Synthetic account refresh failure" };
  });
  fireEvent.submit(password.closest("form")!);
  act(() => {
    fixture.deleteCallbacks!.onSuccess();
    fixture.deleteCallbacks!.onSettled();
  });
  view.rerender(<UsersPage />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(messages.uiPatterns.loadFailed)).toBeTruthy();
  expect(fixture.delete).toHaveBeenCalledTimes(1);
  expect(fixture.refresh).toHaveBeenCalledTimes(1);
  fixture.accountsRefetch.mockImplementation(async () => {
    fixture.accountsError = null;
  });
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  view.rerender(<UsersPage />);
  expect(fixture.accountsRefetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(messages.uiPatterns.loadFailed)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fixture.delete).toHaveBeenCalledTimes(1);
  expect(fixture.refresh).toHaveBeenCalledTimes(1);
});
