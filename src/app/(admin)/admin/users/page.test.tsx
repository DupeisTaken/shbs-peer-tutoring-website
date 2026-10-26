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
import type { ComponentProps } from "react";
import messages from "../../../../../messages/en.json";
import { emptyUserFilters, type UserFilters } from "~/lib/user-filters";
import UsersPage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import {
  userDirectoryView,
  userDirectoryFilters,
  type UserDirectoryView,
} from "~/lib/management-view-state";
vi.mock("~/app/_components/combine-records", () => ({
  CombineRecords: ({
    canApply,
    onPendingChange,
  }: {
    canApply: boolean;
    onPendingChange: (pending: boolean) => void;
  }) => {
    fixture.combineRows({ canApply });
    return (
      <div>
        Head combine controls
        <button onClick={() => onPendingChange(true)}>Hold combine</button>
      </div>
    );
  },
}));

type DeleteCallbacks = {
  onSuccess: (
    result: unknown,
    input: { userId: string; fingerprint: string; confirmPassword: string },
  ) => Promise<void>;
  onError: (error: { message: string }) => void;
  onSettled: () => void;
};
const fixture = vi.hoisted(() => {
  const navigation: {
    accountsError: { message: string; data?: { code?: string } } | null;
    combinedUserId: string | null;
    combinedVerified: Date | null;
    sendSetupError: { message: string } | null;
  } = {
    accountsError: null,
    combinedUserId: "synthetic-combined",
    combinedVerified: new Date("2026-09-01"),
    sendSetupError: null,
  };
  return {
    ...navigation,
    viewerId: "synthetic-head",
    role: "HEAD",
    targetSelf: false,
    targetRole: "ADMIN",
    accountsLoading: false,
    combinedAccount: "registered",
    realDetails: false,
    realTutorDetails: false,
    tutorDetailRead: vi.fn(),
    profileWrite: vi.fn(),
    rejectProfileWrite: undefined as undefined | (() => void),
    extraTutorDestinations: [] as {
      tutorId: string;
      name: string;
      username: string | null;
      status: string;
      account: string | null;
      hasEmail: boolean;
      suspended: boolean;
      retainedOwnerName: string | null;
    }[],
    sendSetup: vi.fn(),
    accountsRefetch: vi.fn<() => Promise<void>>(),
    delete:
      vi.fn<
        (input: {
          userId: string;
          fingerprint: string;
          confirmPassword: string;
        }) => void
      >(),
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
    combineRows: vi.fn(),
  };
});
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["appeal-test"] }));
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  const { nameFieldPolicyQueries } =
    await import("~/test/name-field-policy-fixtures");
  const mutation = {
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
  return {
    api: {
      program: nameFieldPolicyQueries(),
      tutorDetails: {
        get: {
          useQuery: (input: { tutorId: string }) => {
            fixture.tutorDetailRead(input);
            return { data: undefined, error: null };
          },
        },
      },
      useUtils: () => ({
        account: { me: { invalidate: vi.fn() } },
        admin: {
          accounts: { invalidate: fixture.refresh },
          appeals: { invalidate: fixture.refresh },
        },
      }),
      admin: {
        updateAccountProfile: {
          // Exercise the production form and real mutation pending/error lifecycle;
          // only transport delivery is deferred to control history-navigation races.
          useMutation: (options: { onSettled?: () => void }) =>
            useMutation({
              mutationFn: (input: Record<string, unknown>) => {
                fixture.profileWrite(input);
                return new Promise<never>((_resolve, reject) => {
                  fixture.rejectProfileWrite = () =>
                    reject(new Error("Synthetic rejected name save"));
                });
              },
              onSettled: options.onSettled,
            }),
        },
        accountDetails: {
          useQuery: () => ({
            data: {
              membership: null,
              attached: [],
              retained: [],
              group: {
                id: "combined-person",
                resolutionState: "REVIEW_REQUIRED",
                tutors: [],
                tutees: [],
                users: [
                  {
                    id: "synthetic-combined",
                    name: "Combined account",
                    email: "primary@example.test",
                    role: "ADMIN",
                  },
                  {
                    id: "secondary-login",
                    name: "Secondary login",
                    firstName: "Secondary",
                    lastName: "login",
                    preferredName: null,
                    alternativeNames: null,
                    legacyName: null,
                    profileVersion: 7,
                    email: "secondary@example.test",
                    role: "STUDENT",
                  },
                ],
              },
            },
            error: null,
            isFetching: false,
            refetch: fixture.accountsRefetch,
          }),
        },
        previewDeleteUser: {
          useQuery: ({ userId }: { userId: string }) => ({
            data: {
              target: {
                id: userId,
                name: "Management account",
                email: "management@example.test",
                username: "management",
              },
              fingerprint: "delete-fingerprint",
              blockers: [],
              removed: { emails: 1 },
              retained: {},
            },
            isFetching: false,
            error: null,
            refetch: fixture.refetch,
          }),
        },
        tutors: {
          useQuery: () => ({
            data: [{ id: "archived", englishName: "Past tutor", user: null }],
          }),
        },
        accounts: {
          useQuery: () => ({
            error: fixture.accountsError,
            isSuccess: !fixture.accountsError && !fixture.accountsLoading,
            refetch: fixture.accountsRefetch,
            isFetching: fixture.accountsLoading,
            data: fixture.accountsLoading
              ? undefined
              : {
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
                      tutor: {
                        englishName: "Past tutor",
                        username: "pasttutor",
                      },
                      academic: {},
                    },
                    {
                      userId: fixture.combinedUserId,
                      name: "Combined account",
                      role: "ADMIN",
                      tutorId: "synthetic-tutor",
                      tutorStatus: "ACTIVE",
                      tuteeMember: false,
                      tutorAccessRevoked: false,
                      account: fixture.combinedAccount,
                      tutorHasEmail: true,
                      emailVerifiedAt: fixture.combinedVerified,
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
                  ].map((row) => ({
                    ...row,
                    tutorDestinations: [
                      ...(row.tutorId
                        ? [
                            {
                              tutorId: row.tutorId,
                              name: row.name,
                              username: row.tutor?.username ?? null,
                              status: row.tutorStatus,
                              account: row.account,
                              hasEmail: row.tutorHasEmail,
                              suspended: false,
                              retainedOwnerName: null,
                            },
                          ]
                        : []),
                      ...(row.tutorId === "synthetic-tutor"
                        ? fixture.extraTutorDestinations
                        : []),
                    ],
                  })),
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
        sendTutorSetup: {
          useMutation: () => ({
            mutate: fixture.sendSetup,
            isPending: false,
            error: fixture.sendSetupError,
          }),
        },
      },
    },
  };
});
vi.mock("./user-details", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./user-details")>();
  return {
    UserDetails: (props: ComponentProps<typeof actual.UserDetails>) =>
      fixture.realDetails ? (
        <actual.UserDetails {...props} />
      ) : (
        <button className="table-action-link">User details</button>
      ),
  };
});
vi.mock("~/app/_components/acceptance-records", () => ({
  AcceptanceRecords: () => null,
}));
vi.mock("~/app/_components/tutor-details", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/_components/tutor-details")>();
  return {
    TutorDetailsButton: (
      props: ComponentProps<typeof actual.TutorDetailsButton>,
    ) =>
      fixture.realTutorDetails ? (
        <actual.TutorDetailsButton {...props} />
      ) : (
        <button data-tutor-id={props.tutorId}>
          Tutor details: {props.name}
        </button>
      ),
  };
});
vi.mock("~/app/_components/account-profile-editor", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/app/_components/account-profile-editor")
    >();
  return {
    AccountProfileEditor: (
      props: ComponentProps<typeof actual.AccountProfileEditor>,
    ) =>
      fixture.realDetails ? <actual.AccountProfileEditor {...props} /> : null,
  };
});
// Independent profile sections are outside this name-draft/navigation contract.
vi.mock("~/app/_components/academic-profile", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/app/_components/academic-profile")
  >()),
  AcademicPanel: () => null,
}));
vi.mock("~/app/_components/school-departure", () => ({
  SchoolDeparturePanel: () => null,
}));
vi.mock("~/app/_components/membership-editor", () => ({
  MembershipEditor: () => null,
}));
vi.mock("~/app/_components/account-username-editor", () => ({
  AccountUsernameEditor: () => null,
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

const oldStorageKey = "shbs:user-filters:synthetic-head:v1";
const storageKey = viewStateKey(
  "synthetic-head:HEAD",
  "/admin/users",
  "user-directory-v1",
  "",
);
const seedFilters = (saved: UserFilters) =>
  writeViewState(sessionStorage, storageKey, {
    ...userDirectoryView(saved),
    statusInclude: saved.status.include,
    statusExclude: saved.status.exclude,
  });
const storedFilters = () =>
  userDirectoryFilters(
    JSON.parse(sessionStorage.getItem(storageKey)!) as UserDirectoryView,
  );
let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <NextIntlClientProvider locale="en" messages={messages}>
      <SessionViewProvider
        identity={`${fixture.viewerId}:${fixture.role}`}
        pathname="/admin/users"
        verified
      >
        {children}
      </SessionViewProvider>
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
  sessionStorage.clear();
  window.history.replaceState(null, "", "/admin/users");
  fixture.viewerId = "synthetic-head";
  fixture.role = "HEAD";
  fixture.accountsError = null;
  fixture.accountsLoading = false;
  fixture.combinedUserId = "synthetic-combined";
  fixture.combinedAccount = "registered";
  fixture.realDetails = false;
  fixture.realTutorDetails = false;
  fixture.tutorDetailRead.mockClear();
  fixture.profileWrite.mockClear();
  fixture.rejectProfileWrite = undefined;
  fixture.extraTutorDestinations = [];
  fixture.combinedVerified = new Date("2026-09-01");
  fixture.sendSetup.mockClear();
  fixture.sendSetupError = null;
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
  fixture.combineRows.mockClear();
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

const directoryArrival = (tutorId: string) => {
  window.history.replaceState(
    null,
    "",
    `/admin/users#tutor-${encodeURIComponent(tutorId)}`,
  );
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};
const visibleDirectoryRecords = () => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
};

it("reveals the exact linked tutor through conflicting saved filters and restores those choices on return", () => {
  const saved = emptyUserFilters();
  saved.role.include = ["STUDENT"];
  saved.account.include = ["registered"];
  writeViewState(
    sessionStorage,
    storageKey,
    userDirectoryView(saved, "Verified"),
  );
  visibleDirectoryRecords();
  directoryArrival("archived");
  mount();
  const row = document.getElementById("tutor-archived");
  expect(row).not.toBeNull();
  expect(document.activeElement).toBe(row);
  expect(screen.getByRole("table").textContent).toContain("Past tutor");
  expect(screen.getByRole("table").textContent).not.toContain(
    "Verified student",
  );
  expect(storedFilters()).toEqual(saved);
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(
    (JSON.parse(sessionStorage.getItem(storageKey)!) as UserDirectoryView)
      .search,
  ).toBe("Verified");
  expect(fixture.sendSetup).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", { name: messages.usersDirectory.showAll }),
  );
  expect(window.location.hash).toBe("");
  expect(screen.queryByText("@pasttutor")).toBeNull();
  expect(screen.getByRole("table").textContent).toContain("Verified student");
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe(
    "Verified",
  );
  expect(storedFilters()).toEqual(saved);
});

it("keeps a tutor destination stable when an invited roster gains an unverified login", () => {
  fixture.combinedUserId = null;
  fixture.combinedAccount = "invited";
  fixture.combinedVerified = null;
  visibleDirectoryRecords();
  directoryArrival("synthetic-tutor");
  const page = mount();
  const firstRow = document.getElementById("tutor-synthetic-tutor")!;
  expect(firstRow).toBe(document.activeElement);
  expect(
    within(firstRow).queryByRole("button", {
      name: messages.admin.tutors.account.sendSetup,
    }),
  ).toBeNull();

  fixture.combinedUserId = "new-login";
  fixture.combinedAccount = "setup";
  page.rerender(<UsersPage />);
  const linkedRow = document.getElementById("tutor-synthetic-tutor")!;
  expect(linkedRow).not.toBeNull();
  expect(
    within(linkedRow).getByRole("button", {
      name: messages.admin.tutors.account.sendSetup,
    }),
  ).toBeTruthy();
  expect(fixture.sendSetup).not.toHaveBeenCalled();
});

it("opens a second grouped source with its own details and setup instead of the registered representative", () => {
  fixture.extraTutorDestinations = [
    {
      tutorId: "second-source",
      name: "Original second source",
      username: "secondsource",
      status: "PENDING",
      account: "none",
      hasEmail: true,
      suspended: false,
      retainedOwnerName: null,
    },
  ];
  visibleDirectoryRecords();
  directoryArrival("second-source");
  mount();
  const row = document.getElementById("tutor-second-source")!;
  expect(document.activeElement).toBe(row);
  expect(row.textContent).toContain("Original second source");
  expect(row.textContent).toContain("@secondsource");
  expect(row.textContent).not.toContain("Combined account");
  expect(row.textContent).not.toContain(messages.admin.users.roles.ADMIN);
  expect(
    within(row)
      .getByRole("button", { name: "Tutor details: Original second source" })
      .getAttribute("data-tutor-id"),
  ).toBe("second-source");
  expect(screen.queryByRole("button", { name: "Hold combine" })).toBeNull();
  expect(screen.queryByRole("button", { name: "User details" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: messages.admin.users.delete }),
  ).toBeNull();
  fireEvent.click(
    within(row).getByRole("button", {
      name: messages.admin.tutors.account.sendSetup,
    }),
  );
  expect(fixture.sendSetup).toHaveBeenCalledExactlyOnceWith({
    tutorId: "second-source",
  });
});

it.each(["setup", "registered"])(
  "uses a retained source's actual direct-login %s state for exact-source recovery",
  (account) => {
    fixture.extraTutorDestinations = [
      {
        tutorId: "direct-retained-source",
        name: "Direct retained source",
        username: "directretained",
        status: "ARCHIVED",
        account,
        hasEmail: true,
        suspended: false,
        retainedOwnerName: "Direct retained source",
      },
    ];
    directoryArrival("direct-retained-source");
    mount();
    const row = document.getElementById("tutor-direct-retained-source")!;
    const recovery = within(row).queryByRole("button", {
      name: messages.admin.tutors.account.sendSetup,
    });
    if (account === "setup") {
      expect(recovery).not.toBeNull();
      fireEvent.click(recovery!);
      expect(fixture.sendSetup).toHaveBeenCalledExactlyOnceWith({
        tutorId: "direct-retained-source",
      });
    } else {
      expect(recovery).toBeNull();
      expect(fixture.sendSetup).not.toHaveBeenCalled();
    }
    expect(row.textContent).not.toContain("Retained historical owner:");
    expect(
      within(row).queryByRole("button", { name: "User details" }),
    ).toBeNull();
  },
);

it("reveals retained historical sources without offering accountless setup or representative actions", () => {
  fixture.extraTutorDestinations = [
    {
      tutorId: "retained-source",
      name: "Original retained source",
      username: "originalarchive",
      status: "ARCHIVED",
      account: null,
      hasEmail: true,
      suspended: false,
      retainedOwnerName: "Historical owner",
    },
  ];
  directoryArrival("retained-source");
  mount();
  const row = document.getElementById("tutor-retained-source")!;
  expect(row.textContent).toContain("Original retained source");
  expect(row.textContent).toContain(
    "Retained historical owner: Historical owner",
  );
  expect(
    within(row)
      .getByRole("button", { name: "Tutor details: Original retained source" })
      .getAttribute("data-tutor-id"),
  ).toBe("retained-source");
  expect(
    screen.queryByRole("button", {
      name: messages.admin.tutors.account.sendSetup,
    }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "User details" })).toBeNull();
  expect(fixture.sendSetup).not.toHaveBeenCalled();
});

it.each(["second-source", null])(
  "keeps the real read-only source reader on refetch, then dismisses it when history selects %s",
  async (destination) => {
    fixture.realTutorDetails = true;
    fixture.extraTutorDestinations = [
      {
        tutorId: "second-source",
        name: "Other source",
        username: null,
        status: "ACTIVE",
        account: "registered",
        hasEmail: true,
        suspended: false,
        retainedOwnerName: null,
      },
    ];
    visibleDirectoryRecords();
    directoryArrival("synthetic-tutor");
    const page = mount();
    const opener = screen.getByRole("button", {
      name: "View user details for Combined account",
    });
    opener.focus();
    fireEvent.click(opener);
    const reader = screen.getByRole("dialog", {
      name: "User Details · Combined account",
    });
    const close = within(reader).getByRole("button", {
      name: messages.accountProfile.close,
    });
    close.focus();
    page.rerender(<UsersPage />);
    expect(screen.getByRole("dialog")).toBe(reader);
    expect(document.activeElement).toBe(close);
    expect(fixture.tutorDetailRead).toHaveBeenLastCalledWith({
      tutorId: "synthetic-tutor",
    });
    const oldFocus = vi.spyOn(opener, "focus");
    act(() => {
      window.history.replaceState(
        null,
        "",
        `/admin/users${destination ? `#tutor-${destination}` : ""}`,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener.isConnected).toBe(false);
    expect(oldFocus).not.toHaveBeenCalled();
    expect(fixture.tutorDetailRead).not.toHaveBeenCalledWith({
      tutorId: "second-source",
    });
    if (destination) {
      expect(document.activeElement).toBe(
        document.getElementById("tutor-second-source"),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "View user details for Other source",
        }),
      );
      expect(
        screen.getByRole("dialog", { name: "User Details · Other source" }),
      ).not.toBe(reader);
      expect(fixture.tutorDetailRead).toHaveBeenLastCalledWith({
        tutorId: "second-source",
      });
    }
    expect(fixture.sendSetup).not.toHaveBeenCalled();
    expect(fixture.profileWrite).not.toHaveBeenCalled();
  },
);

it("waits for the authorized directory before declaring a destination unavailable", () => {
  fixture.accountsLoading = true;
  directoryArrival("Combined account");
  const page = mount();
  expect(
    screen.queryByText(messages.usersDirectory.targetUnavailable),
  ).toBeNull();
  fixture.accountsLoading = false;
  page.rerender(<UsersPage />);
  // The same display name is present, but an incoming ID must never match by name.
  expect(
    screen.getByText(messages.usersDirectory.targetUnavailable),
  ).toBeTruthy();
  expect(screen.getByRole("table").textContent).not.toContain(
    "Combined account",
  );
  expect(document.querySelector("tr[id^='tutor-']")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  expect(fixture.accountsRefetch).toHaveBeenCalledOnce();
  expect(fixture.sendSetup).not.toHaveBeenCalled();
});

it("focuses a delayed target, preserves user focus on refresh, and handles the same destination again", () => {
  fixture.accountsLoading = true;
  visibleDirectoryRecords();
  directoryArrival("synthetic-tutor");
  const page = mount();
  expect(document.getElementById("tutor-synthetic-tutor")).toBeNull();
  fixture.accountsLoading = false;
  page.rerender(<UsersPage />);
  const row = document.getElementById("tutor-synthetic-tutor")!;
  expect(document.activeElement).toBe(row);
  const details = within(row).getByRole("button", {
    name: "Tutor details: Combined account",
  });
  details.focus();
  page.rerender(<UsersPage />);
  expect(document.activeElement).toBe(details);
  act(() => directoryArrival("synthetic-tutor"));
  expect(document.activeElement).toBe(row);
});

it("retains the explicit destination across a failed read without exposing denied cached rows", () => {
  directoryArrival("synthetic-tutor");
  fixture.accountsError = { message: "Denied", data: { code: "FORBIDDEN" } };
  const page = mount();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText("Combined account")).toBeNull();
  fixture.accountsError = { message: "Network failure" };
  page.rerender(<UsersPage />);
  expect(screen.queryByRole("table")).toBeNull();
  fixture.accountsError = null;
  page.rerender(<UsersPage />);
  expect(document.getElementById("tutor-synthetic-tutor")).not.toBeNull();
  expect(fixture.sendSetup).not.toHaveBeenCalled();
});

it("keeps a cached source readable but blocks setup until directory recovery succeeds", () => {
  fixture.combinedAccount = "setup";
  directoryArrival("synthetic-tutor");
  const page = mount();
  fixture.accountsError = { message: "Network failure" };
  page.rerender(<UsersPage />);
  const setup = screen.getByRole<HTMLButtonElement>("button", {
    name: messages.admin.tutors.account.sendSetup,
  });
  expect(document.getElementById("tutor-synthetic-tutor")).not.toBeNull();
  expect(setup.disabled).toBe(true);
  fireEvent.click(setup);
  expect(fixture.sendSetup).not.toHaveBeenCalled();
  fixture.accountsError = null;
  page.rerender(<UsersPage />);
  expect(setup.disabled).toBe(false);
});

it.each([false, true])(
  "retains a real grouped secondary-login editor across hash history with pending=%s",
  async (pending) => {
    fixture.realDetails = true;
    visibleDirectoryRecords();
    const page = mount();
    fireEvent.click(
      screen.getByRole("button", { name: "User details: Combined account" }),
    );
    const secondary = screen.getByText("Secondary login").closest("tr")!;
    fireEvent.click(
      within(secondary).getByRole("button", {
        name: messages.accountProfile.editProfile,
      }),
    );
    const editor = screen.getByRole("dialog", {
      name: messages.accountProfile.editProfile,
    });
    const draft = within(editor).getByRole<HTMLInputElement>("textbox", {
      name: /First Name/,
    });
    fireEvent.change(draft, {
      target: { value: "Unsaved secondary identity" },
    });
    draft.focus();
    if (pending) {
      fireEvent.click(
        within(editor).getByRole("button", {
          name: messages.accountProfile.save,
        }),
      );
      await waitFor(() =>
        expect(fixture.profileWrite).toHaveBeenCalledTimes(1),
      );
      await waitFor(() => expect(draft.matches(":disabled")).toBe(true));
    }
    const travel = (hash: string) =>
      act(() => {
        window.history.replaceState(null, "", `/admin/users${hash}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    travel("#tutor-synthetic-tutor");
    expect(document.getElementById("tutor-synthetic-tutor")).not.toBeNull();
    expect(
      screen.getByRole("dialog", { name: messages.accountProfile.editProfile }),
    ).toBe(editor);
    expect(within(editor).getByRole("textbox", { name: /First Name/ })).toBe(
      draft,
    );
    expect(draft.value).toBe("Unsaved secondary identity");
    if (!pending) expect(document.activeElement).toBe(draft);
    travel("");
    travel("#tutor-synthetic-tutor");
    expect(
      screen.getByRole("dialog", { name: messages.accountProfile.editProfile }),
    ).toBe(editor);
    expect(draft.value).toBe("Unsaved secondary identity");
    if (pending) {
      expect(
        within(editor).getByRole<HTMLButtonElement>("button", {
          name: messages.accountProfile.close,
        }).disabled,
      ).toBe(true);
      act(() => fixture.rejectProfileWrite?.());
      await waitFor(() =>
        expect(within(editor).getByRole("alert").textContent).toBe(
          "Synthetic rejected name save",
        ),
      );
      expect(draft.value).toBe("Unsaved secondary identity");
      expect(fixture.profileWrite).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          userId: "secondary-login",
          firstName: "Unsaved secondary identity",
          expectedProfileVersion: 7,
        }),
      );
    } else expect(fixture.profileWrite).not.toHaveBeenCalled();
    // Retention is presentation-only: live denial still unmounts private readers.
    fixture.accountsError = { message: "Denied", data: { code: "FORBIDDEN" } };
    page.rerender(<UsersPage />);
    expect(
      screen.queryByRole("dialog", {
        name: messages.accountProfile.editProfile,
      }),
    ).toBeNull();
  },
);

function openGroupedDirectoryReader() {
  fixture.realDetails = true;
  visibleDirectoryRecords();
  const page = mount();
  const opener = screen.getByRole("button", {
    name: "User details: Combined account",
  });
  opener.focus();
  fireEvent.click(opener);
  return { page, opener, reader: screen.getByRole("dialog") };
}

it("returns from nested editing to the selected Tutor without restarting a cancelled reveal", async () => {
  const { reader } = openGroupedDirectoryReader();
  const secondary = within(reader).getByText("Secondary login").closest("tr")!;
  const edit = within(secondary).getByRole("button", {
    name: messages.accountProfile.editProfile,
  });
  edit.focus();
  fireEvent.click(edit);
  const editor = screen.getByRole("dialog", {
    name: messages.accountProfile.editProfile,
  });
  const draft = within(editor).getByRole("textbox", {
    name: /First Name/,
  });
  draft.focus();
  act(() => directoryArrival("synthetic-tutor"));
  // A real editing gesture cancels the deferred arrival. Closing must repair
  // focus independently, while preserving both native dialog ownership levels.
  fireEvent.keyDown(draft, { key: "a" });
  const target = document.getElementById("tutor-synthetic-tutor")!;
  const focus = vi.spyOn(target, "focus");
  const scroll = vi.spyOn(target, "scrollIntoView");
  fireEvent(editor, new Event("cancel", { bubbles: false, cancelable: true }));
  expect(document.activeElement).toBe(edit);
  expect(focus).not.toHaveBeenCalled();
  fireEvent(reader, new Event("cancel", { bubbles: false, cancelable: true }));
  await waitFor(() => expect(document.activeElement).toBe(target));
  expect(target.tabIndex).toBe(-1);
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["missing source", "no hash", "denied", "another dialog"])(
  "does not invent a source focus return with %s",
  async (state) => {
    const { page, opener, reader } = openGroupedDirectoryReader();
    if (state !== "no hash")
      act(() =>
        directoryArrival(
          state === "missing source" ? "missing" : "synthetic-tutor",
        ),
      );
    fireEvent.keyDown(reader, { key: "ArrowDown" });
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    let otherDialog: HTMLDialogElement | undefined;
    if (state === "another dialog") {
      otherDialog = document.createElement("dialog");
      otherDialog.open = true;
      document.body.append(otherDialog);
    }
    try {
      if (state === "denied") {
        fixture.accountsError = {
          message: "Denied",
          data: { code: "FORBIDDEN" },
        };
        page.rerender(<UsersPage />);
      } else
        fireEvent(
          reader,
          new Event("cancel", { bubbles: false, cancelable: true }),
        );
      await act(async () => {
        await Promise.resolve();
      });
      expect(focus).not.toHaveBeenCalledWith({ preventScroll: true });
      if (state === "no hash") expect(document.activeElement).toBe(opener);
      if (state === "denied") expect(screen.queryByRole("table")).toBeNull();
    } finally {
      otherDialog?.remove();
    }
  },
);

it("preserves a usable focus target chosen as the directory reader closes", async () => {
  const { reader } = openGroupedDirectoryReader();
  act(() => directoryArrival("synthetic-tutor"));
  fireEvent.keyDown(reader, { key: "ArrowDown" });
  const target = document.getElementById("tutor-synthetic-tutor")!;
  const focus = vi.spyOn(target, "focus");
  const returnToDirectory = screen.getByRole("button", {
    name: messages.usersDirectory.showAll,
  });
  fireEvent(reader, new Event("cancel", { bubbles: false, cancelable: true }));
  returnToDirectory.focus();
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.activeElement).toBe(returnToDirectory);
  expect(focus).not.toHaveBeenCalled();
});

it.each(["ADMIN", "COORDINATOR"])(
  "explains Head-only accountless provisioning to %s while preserving existing setup resends",
  (role) => {
    fixture.role = role;
    fixture.combinedUserId = null;
    fixture.combinedAccount = "none";
    directoryArrival("synthetic-tutor");
    const page = mount();
    // Hash navigation preserves hidden browsing rows and their editor owners.
    // Check the accessible source table so its message cannot be satisfied by
    // the same text retained in the hidden directory.
    const sourceTable = within(
      screen.getByRole("table", { name: messages.admin.users.title }),
    );
    expect(
      sourceTable.getByText(messages.usersDirectory.setupHeadRequired),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: messages.admin.tutors.account.sendSetup,
      }),
    ).toBeNull();
    fixture.combinedUserId = "existing-login";
    fixture.combinedAccount = "setup";
    page.rerender(<UsersPage />);
    expect(
      sourceTable.queryByText(messages.usersDirectory.setupHeadRequired),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.admin.tutors.account.sendSetup,
      }),
    );
    expect(fixture.sendSetup).toHaveBeenCalledExactlyOnceWith({
      tutorId: "synthetic-tutor",
    });
  },
);

it("lets Head deliberately start accountless setup and retains the target beside a visible failure", () => {
  fixture.combinedUserId = null;
  fixture.combinedAccount = "none";
  directoryArrival("synthetic-tutor");
  const page = mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.tutors.account.sendSetup,
    }),
  );
  expect(fixture.sendSetup).toHaveBeenCalledExactlyOnceWith({
    tutorId: "synthetic-tutor",
  });
  fixture.sendSetupError = { message: "Synthetic setup delivery failed." };
  page.rerender(<UsersPage />);
  expect(screen.getByRole("alert").textContent).toContain(
    fixture.sendSetupError.message,
  );
  expect(document.getElementById("tutor-synthetic-tutor")).not.toBeNull();
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
  seedFilters(saved);
  mount();
  expect(screen.queryByText("@pasttutor")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tuteeHistory.showHistorical }),
  );
  expect(screen.getByText("@pasttutor")).toBeTruthy();
  const stored = storedFilters();
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
  expect(storedFilters().status).toEqual({ include: [], exclude: [] });
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Admin" }));
  fireEvent.click(statusControl()!);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Include Active" })
      .checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Active" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Exclude Tutor" }));
  expect(statusControl()).toBeNull();
  expect(storedFilters().status).toEqual({ include: [], exclude: [] });
});

it("repairs stale saved status before it can remove unrestricted results", () => {
  const saved = emptyUserFilters();
  saved.status.include = ["PENDING"];
  seedFilters(saved);
  mount();
  expect(statusControl()).toBeNull();
  expect(screen.queryByText("Combined account")).not.toBeNull();
  expect(screen.queryByText("Management account")).not.toBeNull();
  expect(storedFilters().status).toEqual({ include: [], exclude: [] });
});

it("restores applicable status and resets visibility when all filters are cleared", () => {
  const saved = emptyUserFilters();
  saved.role.include = ["TUTOR"];
  saved.status.include = ["ACTIVE"];
  seedFilters(saved);
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
it("hides student username backfill from Coordinators", () => {
  fixture.role = "COORDINATOR";
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
  expect(actions[3]!.classList.contains("table-action-danger")).toBe(true);
});

it("reveals unverified accounts explicitly and resets the saved choice", () => {
  mount();
  expect(screen.queryByText("Unverified student")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tuteeHistory.showUnverified }),
  );
  expect(screen.getByText("Unverified student")).toBeTruthy();
  expect(storedFilters().showUnverified).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: messages.userMultiFilters.clear }),
  );
  expect(screen.queryByText("Unverified student")).toBeNull();
});

it("keeps unified combine search independent of directory visibility filters", () => {
  mount();
  expect(fixture.combineRows).toHaveBeenLastCalledWith({ canApply: true });
  fireEvent.click(
    screen.getByRole("button", { name: messages.tuteeHistory.showUnverified }),
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Unverified student" },
  });
  expect(fixture.combineRows).toHaveBeenLastCalledWith({ canApply: true });
  fireEvent.click(
    screen.getByRole("button", { name: messages.tuteeHistory.hideUnverified }),
  );
  expect(fixture.combineRows).toHaveBeenLastCalledWith({ canApply: true });
});

it("offers the unified historical workflow with Admin direct authority", () => {
  fixture.role = "ADMIN";
  mount();
  expect(fixture.combineRows).toHaveBeenLastCalledWith({ canApply: true });
});

it("restores session directory criteria without restricting the unified record picker", () => {
  const filters = { ...emptyUserFilters(), showUnverified: true };
  writeViewState(sessionStorage, storageKey, {
    ...userDirectoryView(filters),
    search: "Unverified student",
  });
  mount();
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe(
    "Unverified student",
  );
  expect(fixture.combineRows).toHaveBeenLastCalledWith({ canApply: true });
  expect(screen.getByRole("table").textContent).not.toContain(
    "Management account",
  );
});

it("releases the filter restriction when a role change removes pending combine controls", () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Hold combine" }));
  expect(screen.getByRole("searchbox").matches(":disabled")).toBe(true);
  fixture.role = "COORDINATOR";
  view.rerender(<UsersPage />);
  expect(screen.queryByText("Head combine controls")).toBeNull();
  expect(screen.getByRole("searchbox").matches(":disabled")).toBe(false);
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
    fingerprint: "delete-fingerprint",
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
it("closes accepted deletion and refreshes once without replaying the write", async () => {
  mount();
  openDeletion();
  const password = screen.getByLabelText<HTMLInputElement>(
    messages.admin.users.confirm.passwordLabel,
  );
  fireEvent.change(password, { target: { value: "synthetic password" } });
  fireEvent.submit(password.closest("form")!);
  await act(async () => {
    await fixture.deleteCallbacks!.onSuccess(
      {},
      fixture.delete.mock.calls.at(-1)![0],
    );
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

it("recovers only account reads after accepted deletion followed by refresh failure", async () => {
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
  await act(async () => {
    await fixture.deleteCallbacks!.onSuccess(
      {},
      fixture.delete.mock.calls.at(-1)![0],
    );
    fixture.deleteCallbacks!.onSettled();
  });
  view.rerender(<UsersPage />);
  expect(screen.queryByRole("dialog")).toBeNull();
  // A failed refresh must not reintroduce the accepted deletion into the directory.
  expect(screen.queryByText("Management account")).toBeNull();
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

it("ignores former cross-session preferences and never migrates them", () => {
  const old = {
    ...emptyUserFilters(),
    showPastTutors: true,
    showUnverified: true,
  };
  localStorage.setItem(oldStorageKey, JSON.stringify(old));
  mount();
  expect(screen.queryByText("@pasttutor")).toBeNull();
  expect(screen.queryByText("Unverified student")).toBeNull();
  expect(localStorage.getItem(oldStorageKey)).toBe(JSON.stringify(old));
});
it("restores current search and sort without retaining deletion passwords or open dialogs", () => {
  const view = mount();
  fireEvent.click(
    screen.getByRole("button", { name: messages.admin.users.columns.user }),
  );
  openDeletion();
  fireEvent.change(
    screen.getByLabelText(messages.admin.users.confirm.passwordLabel),
    { target: { value: "unsaved-secret" } },
  );
  view.unmount();
  mount();
  expect(screen.queryByRole("dialog")).toBeNull();
  const sortKey = viewStateKey(
    "synthetic-head:HEAD",
    "/admin/users",
    "users-sort-v1",
    "",
  );
  expect(JSON.parse(sessionStorage.getItem(sortKey)!)).toEqual({
    key: "name",
    dir: "asc",
  });
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Combined" },
  });
  cleanup();
  mount();
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe(
    "Combined",
  );
  expect(screen.getByRole("table").textContent).toContain("Combined account");
  expect(screen.getByRole("table").textContent).not.toContain(
    "Management account",
  );
  expect(JSON.stringify(sessionStorage)).not.toContain("unsaved-secret");
  expect(fixture.delete).not.toHaveBeenCalled();
});
it("keeps the original unbounded directory input through other filters and drops stale persisted criteria", () => {
  const view = mount();
  const input = screen.getByRole<HTMLInputElement>("searchbox");
  expect(input.hasAttribute("maxlength")).toBe(false);
  fireEvent.change(input, { target: { value: "Combined" } });
  const long = "synthetic directory query ".repeat(200);
  fireEvent.change(input, { target: { value: long } });
  fireEvent.click(
    screen.getByRole("button", { name: messages.tuteeHistory.showHistorical }),
  );
  expect(input.value).toBe(long);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  expect(Object.keys(sessionStorage).some((key) => key.includes(long))).toBe(
    false,
  );
  view.unmount();
  mount();
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
  expect(fixture.delete).not.toHaveBeenCalled();
});
it("clears remembered directory criteria on denial and waits for a successful read", () => {
  const view = mount();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Combined" },
  });
  fixture.accountsError = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(<UsersPage />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText("Head combine controls")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  expect(fixture.accountsRefetch).toHaveBeenCalledOnce();
  fixture.accountsError = { message: "Network failure" };
  view.rerender(<UsersPage />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText("Head combine controls")).toBeNull();
  fixture.accountsError = null;
  view.rerender(<UsersPage />);
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
  expect(fixture.delete).not.toHaveBeenCalled();
  expect(fixture.decision).not.toHaveBeenCalled();
});
