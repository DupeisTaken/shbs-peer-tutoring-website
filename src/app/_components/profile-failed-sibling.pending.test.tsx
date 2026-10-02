/** @vitest-environment jsdom */
// Actual child compositions use real mutation and invalidation lifecycles.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type InvalidateQueryFilters,
  type InvalidateOptions,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { useState, type ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AccountProfileEditor } from "./account-profile-editor";
import { TutorProfileEditor } from "./tutor-profile-editor";
import { TuteeEditor } from "./tutee-editor";
import { MembershipEditor } from "./membership-editor";
import { SchoolDeparturePanel } from "./school-departure";
import { ProfileDialog } from "./profile-dialog";
import type { AccountMembership } from "~/lib/account-membership";

type Operation =
  | "accountProfile"
  | "username"
  | "tutorProfile"
  | "tuteeProfile"
  | "academic"
  | "ownAcademic"
  | "membership"
  | "transfer"
  | "departure"
  | "link"
  | "invite"
  | "requestMembership"
  | "requestDeparture";
type Failure = Error & { data?: { code?: string; approvalId?: string } };
type MutationOptions = {
  onSuccess?: () => unknown;
  onError?: (error: Failure) => unknown;
  onSettled?: () => unknown;
};
type Write = (input: unknown) => Promise<unknown>;
const mock = vi.hoisted(() => ({
  writes: {} as Record<Operation, Mock<Write>>,
  invalidate: vi.fn(),
  preview: vi.fn(),
  refetch: vi.fn(),
  refresh: vi.fn(),
  version: 7,
  departureRevision: 2,
  role: "HEAD",
  updatedAt: new Date("2024-10-01T00:00:00Z"),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("./management-actions", () => ({ ManagementActions: () => null }));
// Only RPC transport/query fixtures are replaced. React Query owns the complete
// mutation lifecycle, including callback awaits and terminal error/success states.
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQueryClient } = await import("@tanstack/react-query");
  const mutation = (operation: Operation) => ({
    useMutation: (options: MutationOptions = {}) =>
      useMutation({
        mutationKey: [operation],
        mutationFn: (input: unknown): Promise<unknown> =>
          mock.writes[operation](input),
        retry: false,
        ...options,
      }),
  });
  const academicQuery = {
    useQuery: () => ({
      data: {
        academic: {
          status: "REPORTED",
          gradeLevel: 10,
          rawGrade: null,
          schoolYear: "26-27",
          confirmedAt: null,
          needsConfirmation: false,
          expectedGraduationYear: 2029,
        },
        profileVersion: mock.version,
        history: [],
        role: mock.role,
      },
      refetch: mock.refetch,
    }),
  };
  return {
    api: {
      useUtils: () => {
        const queryClient = useQueryClient();
        const invalidate = async (
          path: string,
          filters?: InvalidateQueryFilters,
          options?: InvalidateOptions,
        ) => {
          await mock.invalidate(path);
          await queryClient.invalidateQueries(
            { ...filters, queryKey: path === "*" ? undefined : [path] },
            options,
          );
        };
        const target = (path: string) => ({
          invalidate: (
            _input?: unknown,
            filters?: InvalidateQueryFilters,
            options?: InvalidateOptions,
          ) => invalidate(path, filters, options),
        });
        return {
          invalidate: () => invalidate("*"),
          admin: {
            accounts: { ...target("admin.accounts"), fetch: mock.refetch },
            tutors: target("admin.tutors"),
            tutees: target("admin.tutees"),
            tuteeStats: target("admin.tuteeStats"),
            pairings: target("admin.pairings"),
            accountAcademics: target("admin.accountAcademics"),
          },
          account: {
            me: target("account.me"),
            academicHistory: target("account.academicHistory"),
          },
          tutor: {
            me: target("tutor.me"),
            myProfile: target("tutor.myProfile"),
          },
          tutorDetails: target("tutorDetails"),
          student: target("student"),
          tuteeHistory: {
            ...target("tuteeHistory"),
            preview: { fetch: mock.preview },
          },
        };
      },
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: {
              requireLatinNames: false,
              offeredGrades: [10, 11],
              currentSchoolYear: "26-27",
            },
            refetch: mock.refetch,
          }),
        },
      },
      admin: {
        updateAccountProfile: mutation("accountProfile"),
        updateAccountUsername: mutation("username"),
        updateTutor: mutation("tutorProfile"),
        updateTutee: mutation("tuteeProfile"),
        updateAccountAcademics: mutation("academic"),
        accountAcademics: academicQuery,
        setMemberships: mutation("membership"),
        transferHead: mutation("transfer"),
        subjects: { useQuery: () => ({ data: [] }) },
        timeSlots: { useQuery: () => ({ data: [] }) },
      },
      account: {
        me: academicQuery,
        academicHistory: { useQuery: () => ({ data: [] }) },
        updateAcademics: mutation("ownAcademic"),
        requestMemberships: mutation("requestMembership"),
      },
      departure: {
        state: {
          useQuery: () => ({
            data: {
              departure: {
                reason: null,
                revision: mock.departureRevision,
                observerRevoked: false,
              },
              role: mock.role,
              access: { canReadManagement: true },
              events: [],
            },
          }),
        },
        setState: mutation("departure"),
        request: mutation("requestDeparture"),
      },
      tuteeHistory: {
        candidates: {
          useQuery: () => ({
            data: [
              {
                id: "owner",
                name: "Verified Person",
                email: "verified@example.test",
              },
            ],
          }),
        },
        link: mutation("link"),
        invite: mutation("invite"),
      },
    },
  };
});
function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const operations: Operation[] = [
  "accountProfile",
  "username",
  "tutorProfile",
  "tuteeProfile",
  "academic",
  "ownAcademic",
  "membership",
  "transfer",
  "departure",
  "link",
  "invite",
  "requestMembership",
  "requestDeparture",
];
const membership: AccountMembership = {
  rank: "ADMIN",
  tutor: true,
  tutee: false,
  viewer: false,
  translator: false,
  crew: false,
};
const originalTimestamp = new Date("2024-10-01T00:00:00Z");
const evidence = "Verified original enrollment evidence";
const failureText = "Independent write failed";
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  mock.version = 7;
  mock.departureRevision = 2;
  mock.role = "HEAD";
  mock.updatedAt = originalTimestamp;
  for (const operation of operations)
    mock.writes[operation] = vi.fn<Write>().mockResolvedValue({});
  mock.invalidate.mockResolvedValue(undefined);
  mock.refetch.mockResolvedValue({ isSuccess: true, data: {} });
  mock.preview.mockResolvedValue({
    fingerprint: "a".repeat(64),
    record: { name: "Original Person", sessions: 6 },
    account: { name: "Verified Person", email: "verified@example.test" },
    conflict: false,
    currentConflict: false,
  });
  client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, gcTime: 0 },
    },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
type Locale = "en" | "zh";
type Kind = "account" | "tutor" | "tutee" | "self";
function Host({ kind, close }: { kind: Kind; close: () => void }) {
  const [open, setOpen] = useState(true);
  const onClose = () => {
    close();
    setOpen(false);
  };
  const row = {
    id: "record",
    englishName: "Original Person",
    firstName: "Original",
    lastName: "Person",
    preferredName: null,
    alternativeNames: null,
    legacyName: "Original Person",
    gradeLevel: null,
    status: "INACTIVE",
    historical: true,
    updatedAt: mock.updatedAt,
    owner: null,
    user: { id: "account", email: "person@example.test" },
    availabilities: [],
    notes: "Original note",
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open editor</button>
      {open &&
        (kind === "account" ? (
          <AccountProfileEditor
            onClose={onClose}
            membership={membership}
            isHead
            profile={{
              userId: "account",
              name: "Original Person",
              firstName: "Original",
              lastName: "Person",
              alternativeNames: null,
              username: "original",
              profileVersion: mock.version,
            }}
          />
        ) : kind === "tutee" ? (
          <TuteeEditor
            row={row as unknown as ComponentProps<typeof TuteeEditor>["row"]}
            onClose={onClose}
            historyPermissions={{ canLink: true, isHead: true }}
          />
        ) : kind === "tutor" ? (
          <TutorProfileEditor
            row={
              row as unknown as ComponentProps<typeof TutorProfileEditor>["row"]
            }
            onClose={onClose}
          />
        ) : (
          <ProfileDialog title="Self service" onClose={onClose}>
            <MembershipEditor
              userId="account"
              initial={{
                ...membership,
                rank: "NONE",
                tutor: false,
                tutee: true,
              }}
              selfService
            />
            <SchoolDeparturePanel />
          </ProfileDialog>
        ))}
    </>
  );
}
function mount(kind: Kind, locale: Locale) {
  const close = vi.fn();
  const tree = () => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
        timeZone="Asia/Shanghai"
      >
        <Host kind={kind} close={close} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    close,
    refresh: () => view.rerender(tree()),
    labels: locale === "en" ? en : zh,
  };
}
it.each(["en", "zh"] as const)(
  "renders the existing transferred tutor option with a translated %s label",
  (locale) => {
    const ui = mount("tutor", locale);
    expect(
      screen.getByRole<HTMLOptionElement>("option", {
        name: ui.labels.schoolDeparture.transferred,
      }).value,
    ).toBe("TRANSFERRED");
  },
);

type Action = {
  element: HTMLElement;
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  kind: "submit" | "click";
};
function submit(action: Action) {
  action.element.dispatchEvent(
    action.kind === "submit"
      ? new Event("submit", { bubbles: true, cancelable: true })
      : new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}
async function prepare(
  operation: Operation,
  labels: typeof en | typeof zh,
): Promise<Action> {
  if (
    operation === "accountProfile" ||
    operation === "tutorProfile" ||
    operation === "tuteeProfile"
  ) {
    const field = screen.getByLabelText<HTMLInputElement>(
      `${labels.personName.firstName} ${labels.signupFields.required}`,
      { exact: true },
    );
    fireEvent.change(field, { target: { value: "Retained" } });
    return { field, element: field.closest("form")!, kind: "submit" };
  }
  if (operation === "username") {
    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: labels.accountProfile.username,
    });
    fireEvent.change(field, { target: { value: "retainedhandle" } });
    return { field, element: field.closest("form")!, kind: "submit" };
  }
  if (operation === "academic") {
    fireEvent.click(
      screen.getByRole("button", { name: labels.academics.edit }),
    );
    const field = screen.getByLabelText<HTMLTextAreaElement>(
      labels.academics.reason,
    );
    fireEvent.change(field, {
      target: { value: "Independent academic reason" },
    });
    fireEvent.change(screen.getByLabelText(labels.academics.grade), {
      target: { value: "11" },
    });
    return { field, element: field.closest("form")!, kind: "submit" };
  }
  if (operation === "membership" || operation === "requestMembership") {
    fireEvent.click(screen.getByLabelText(labels.membership.translator));
    const field =
      operation === "membership"
        ? screen.getByLabelText<HTMLInputElement>(labels.membership.password)
        : screen.getByLabelText<HTMLInputElement>(labels.membership.translator);
    if (operation === "membership")
      fireEvent.change(field, { target: { value: "Synthetic-password" } });
    return {
      field,
      element: screen.getByRole("button", {
        name: labels.membership[
          operation === "membership" ? "save" : "request"
        ],
      }),
      kind: "click",
    };
  }
  if (operation === "departure" || operation === "requestDeparture") {
    const field = screen.getByLabelText<HTMLTextAreaElement>(
      labels.schoolDeparture.reason,
    );
    fireEvent.change(field, {
      target: { value: "Independent departure evidence" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name:
          operation === "departure"
            ? labels.schoolDeparture.review
            : labels.schoolDeparture.request,
      }),
    );
    return {
      field,
      element: screen.getByRole("button", {
        name: labels.schoolDeparture.confirm,
      }),
      kind: "click",
    };
  }
  if (operation === "link") {
    screen
      .getByText(labels.tuteeHistory.linkTitle, { selector: "summary" })
      .closest("details")!.open = true;
    const field = screen.getByLabelText<HTMLTextAreaElement>(
      labels.tuteeHistory.evidence,
    );
    fireEvent.change(field, { target: { value: evidence } });
    fireEvent.change(screen.getByLabelText(labels.tuteeHistory.chooseAccount), {
      target: { value: "owner" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: labels.tuteeHistory.preview }),
    );
    fireEvent.click(
      await screen.findByLabelText(labels.tuteeHistory.confirmIdentity),
    );
    return {
      field,
      element: screen.getByRole("button", { name: labels.tuteeHistory.link }),
      kind: "click",
    };
  }
  throw new Error(`No fixture for ${operation}`);
}
async function idle() {
  await waitFor(() => expect(client.isMutating()).toBe(0));
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("dialog")
        .every((dialog) => dialog.getAttribute("aria-busy") === "false"),
    ).toBe(true),
  );
}
function blocked(close: ReturnType<typeof vi.fn>) {
  for (const dialog of screen.getAllByRole("dialog")) {
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: /^(Close|关闭)$/,
      }).disabled,
    ).toBe(true);
    for (let index = 0; index < 3; index++)
      expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
  }
  expect(close).not.toHaveBeenCalled();
}
function retained(
  operation: Operation,
  action: Action,
  labels: typeof en | typeof zh,
) {
  expect(action.field.isConnected).toBe(true);
  expect(action.field.matches(":disabled")).toBe(false);
  if (operation === "academic") {
    expect(action.field.value).toBe("Independent academic reason");
    expect(
      screen.getByLabelText<HTMLSelectElement>(labels.academics.grade).value,
    ).toBe("11");
  } else if (operation === "link") expect(action.field.value).toBe(evidence);
  else if (operation === "membership") {
    expect(action.field.value).toBe("Synthetic-password");
    expect(
      screen.getByLabelText<HTMLInputElement>(labels.membership.translator)
        .checked,
    ).toBe(true);
  } else if (operation === "departure")
    expect(action.field.value).toBe("Independent departure evidence");
  else if (operation === "accountProfile")
    expect(action.field.value).toBe("Retained");
  expect(
    screen
      .getAllByRole("alert")
      .some((alert) =>
        alert.textContent?.includes(
          operation === "link"
            ? labels.tuteeHistory.HISTORY_STALE
            : failureText,
        ),
      ),
  ).toBe(true);
}
const pairings = [
  ["account", "accountProfile", "membership"],
  ["account", "username", "membership"],
  ["account", "accountProfile", "departure"],
  ["account", "username", "departure"],
  ["account", "username", "accountProfile"],
  ["account", "accountProfile", "academic"],
  ["account", "username", "academic"],
  ["tutee", "tuteeProfile", "academic"],
  ["tutee", "tuteeProfile", "link"],
  ["tutor", "tutorProfile", "academic"],
] as const;
const cases = pairings.flatMap(([kind, primary, sibling]) =>
  (["primary-first", "failure-first"] as const).map(
    (
      order,
    ): {
      kind: typeof kind;
      primary: typeof primary;
      sibling: typeof sibling;
      order: typeof order;
      locale: Locale;
    } => ({
      kind,
      primary,
      sibling,
      order,
      locale: "en",
    }),
  ),
);
// Repeat the principal historical/membership/departure surfaces with their actual Chinese labels.
cases.push(
  ...cases
    .filter(
      (test) =>
        test.kind === "tutee" ||
        (test.kind === "account" &&
          test.primary === "accountProfile" &&
          ["membership", "departure"].includes(test.sibling)),
    )
    .map((test): (typeof cases)[number] => ({ ...test, locale: "zh" })),
);
it.each(cases)(
  "keeps $kind mounted after $primary succeeds and $sibling fails ($order, $locale)",
  async ({ kind, primary, sibling, order, locale }) => {
    const ui = mount(kind, locale);
    const primaryAction = await prepare(primary, ui.labels);
    const siblingAction = await prepare(sibling, ui.labels);
    const first = deferred(),
      independent = deferred();
    mock.writes[primary].mockReturnValueOnce(first.promise);
    mock.writes[sibling].mockReturnValueOnce(independent.promise);
    // Admit both independent handlers in one batch before the shared pending render,
    // and challenge their local duplicate guards in the same batch.
    act(() => {
      submit(primaryAction);
      submit(siblingAction);
      submit(primaryAction);
      submit(siblingAction);
    });
    await waitFor(() => expect(mock.writes[sibling]).toHaveBeenCalledOnce());
    expect(mock.writes[primary]).toHaveBeenCalledOnce();
    blocked(ui.close);
    const primaryInput = mock.writes[primary].mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    const siblingInput = mock.writes[sibling].mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    if (primary === "tuteeProfile" || primary === "tutorProfile") {
      expect(primaryInput.expectedUpdatedAt).toEqual(originalTimestamp);
      expect(primaryInput).not.toHaveProperty("gradeLevel");
      expect(primaryInput).not.toHaveProperty("academicallyGraduated");
    } else expect(primaryInput.expectedProfileVersion).toBe(7);
    const failure = new Error(
      sibling === "link" ? "HISTORY_STALE" : failureText,
    );
    await act(async () => {
      if (order === "primary-first") first.resolve({});
      else independent.reject(failure);
    });
    await waitFor(() => expect(client.isMutating()).toBe(1));
    blocked(ui.close);
    expect(siblingAction.field.isConnected).toBe(true);
    // A background refresh belongs to the source, not the already-open failed draft.
    mock.version = 8;
    mock.departureRevision = 3;
    mock.updatedAt = new Date("2026-10-02T00:00:00Z");
    ui.refresh();
    await act(async () => {
      if (order === "primary-first") independent.reject(failure);
      else first.resolve({});
    });
    // Assert the outcome before querying the dialog, so an old auto-closing
    // parent fails for discarding the independent draft rather than missing DOM.
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(
      ui.close,
      "Parent completion must not discard the independent failed draft",
    ).not.toHaveBeenCalled();
    expect(siblingAction.field.isConnected).toBe(true);
    await idle();
    expect(ui.close).not.toHaveBeenCalled();
    retained(sibling, siblingAction, ui.labels);
    // The completed section remains read-only and cannot accidentally replay its old version.
    expect(primaryAction.field.isConnected).toBe(true);
    expect(
      primaryAction.field.matches(":disabled") ||
        ("readOnly" in primaryAction.field && primaryAction.field.readOnly),
    ).toBe(true);
    act(() => submit(primaryAction));
    expect(mock.writes[primary]).toHaveBeenCalledOnce();
    let retryAction = siblingAction;
    if (sibling === "link") {
      expect(
        screen.queryByRole("button", { name: ui.labels.tuteeHistory.link }),
      ).toBeNull();
      mock.preview.mockResolvedValueOnce({
        fingerprint: "b".repeat(64),
        record: { name: "Original Person", sessions: 6 },
        account: { name: "Verified Person", email: "verified@example.test" },
        conflict: false,
        currentConflict: false,
      });
      fireEvent.click(
        screen.getByRole("button", { name: ui.labels.tuteeHistory.preview }),
      );
      const acknowledgment = await screen.findByLabelText<HTMLInputElement>(
        ui.labels.tuteeHistory.confirmIdentity,
      );
      expect(acknowledgment.checked).toBe(false);
      fireEvent.click(acknowledgment);
      retryAction = {
        ...siblingAction,
        element: screen.getByRole("button", {
          name: ui.labels.tuteeHistory.link,
        }),
      };
    }
    const retry = deferred();
    mock.writes[sibling].mockReturnValueOnce(retry.promise);
    act(() => {
      submit(retryAction);
      submit(retryAction);
    });
    await waitFor(() => expect(mock.writes[sibling]).toHaveBeenCalledTimes(2));
    blocked(ui.close);
    const retryInput = mock.writes[sibling].mock.calls[1]![0] as Record<
      string,
      unknown
    >;
    expect(retryInput).toEqual(
      sibling === "link"
        ? { ...siblingInput, fingerprint: "b".repeat(64) }
        : siblingInput,
    );
    if (sibling === "academic" || sibling === "accountProfile")
      expect(retryInput.expectedProfileVersion).toBe(7);
    if (sibling === "departure") expect(retryInput.expectedRevision).toBe(2);
    await act(async () => retry.resolve({}));
    await idle();
    expect(ui.close).not.toHaveBeenCalled();
    expect(mock.writes[primary]).toHaveBeenCalledOnce();
    // Successful retry never implies an instruction to dismiss a different section.
    fireEvent.click(
      screen.getByRole("button", { name: ui.labels.accountProfile.close }),
    );
    expect(ui.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
    const reopened = screen.getByLabelText<HTMLInputElement>(
      primary === "username"
        ? ui.labels.accountProfile.username
        : `${ui.labels.personName.firstName} ${ui.labels.signupFields.required}`,
      { exact: true },
    );
    expect(reopened.matches(":disabled")).toBe(false);
  },
);
const primaryFailureCases = [
  ["account", "accountProfile", "membership"],
  ["account", "accountProfile", "departure"],
  ["account", "username", "accountProfile"],
  ["tutee", "tuteeProfile", "link"],
  ["tutor", "tutorProfile", "academic"],
] as const;
it.each(
  primaryFailureCases.flatMap(([kind, primary, sibling]) =>
    (["failure-first", "sibling-first"] as const).map((order) => ({
      kind,
      primary,
      sibling,
      order,
    })),
  ),
)(
  "retains failed $primary when $sibling succeeds ($order)",
  async ({ kind, primary, sibling, order }) => {
    const ui = mount(kind, "en");
    const primaryAction = await prepare(primary, ui.labels);
    const siblingAction = await prepare(sibling, ui.labels);
    const primaryWrite = deferred(),
      siblingWrite = deferred();
    mock.writes[primary].mockReturnValueOnce(primaryWrite.promise);
    mock.writes[sibling].mockReturnValueOnce(siblingWrite.promise);
    act(() => {
      submit(primaryAction);
      submit(siblingAction);
    });
    await waitFor(() => expect(mock.writes[sibling]).toHaveBeenCalledOnce());
    const originalInput = mock.writes[primary].mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    await act(async () => {
      if (order === "failure-first")
        primaryWrite.reject(new Error(failureText));
      else siblingWrite.resolve({});
    });
    await waitFor(() => expect(client.isMutating()).toBe(1));
    blocked(ui.close);
    mock.version = 9;
    mock.updatedAt = new Date("2026-10-02T00:00:00Z");
    ui.refresh();
    await act(async () => {
      if (order === "failure-first") siblingWrite.resolve({});
      else primaryWrite.reject(new Error(failureText));
    });
    await idle();
    expect(ui.close).not.toHaveBeenCalled();
    expect(primaryAction.field.isConnected).toBe(true);
    expect(primaryAction.field.matches(":disabled")).toBe(false);
    expect(primaryAction.field.value).toBe(
      primary === "username" ? "retainedhandle" : "Retained",
    );
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.textContent?.includes(failureText)),
    ).toBe(true);
    const retry = deferred();
    mock.writes[primary].mockReturnValueOnce(retry.promise);
    act(() => {
      submit(primaryAction);
      submit(primaryAction);
    });
    await waitFor(() => expect(mock.writes[primary]).toHaveBeenCalledTimes(2));
    expect(mock.writes[primary].mock.calls[1]![0]).toEqual(originalInput);
    if (primary === "tuteeProfile" || primary === "tutorProfile")
      expect(originalInput.expectedUpdatedAt).toEqual(originalTimestamp);
    else expect(originalInput.expectedProfileVersion).toBe(7);
    blocked(ui.close);
    await act(async () => retry.resolve({}));
    await idle();
    expect(primaryAction.field.matches(":disabled")).toBe(true);
    act(() => submit(primaryAction));
    expect(mock.writes[primary]).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole("button", { name: ui.labels.accountProfile.close }),
    );
    expect(ui.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

const allSuccessCases = [
  ["account", "accountProfile", "membership"],
  ["account", "username", "academic"],
  ["tutee", "tuteeProfile", "link"],
  ["tutor", "tutorProfile", "academic"],
] as const;
it.each(
  allSuccessCases.flatMap(([kind, primary, sibling]) =>
    (["primary-first", "sibling-first"] as const).map((order) => ({
      kind,
      primary,
      sibling,
      order,
    })),
  ),
)(
  "requires deliberate Close when $primary and $sibling both succeed ($order)",
  async ({ kind, primary, sibling, order }) => {
    const ui = mount(kind, "en");
    const primaryAction = await prepare(primary, ui.labels),
      siblingAction = await prepare(sibling, ui.labels);
    const primaryWrite = deferred(),
      siblingWrite = deferred();
    mock.writes[primary].mockReturnValueOnce(primaryWrite.promise);
    mock.writes[sibling].mockReturnValueOnce(siblingWrite.promise);
    act(() => {
      submit(primaryAction);
      submit(siblingAction);
    });
    await waitFor(() => expect(mock.writes[sibling]).toHaveBeenCalledOnce());
    await act(async () => {
      if (order === "primary-first") primaryWrite.resolve({});
      else siblingWrite.resolve({});
    });
    await waitFor(() => expect(client.isMutating()).toBe(1));
    blocked(ui.close);
    await act(async () => {
      if (order === "primary-first") siblingWrite.resolve({});
      else primaryWrite.resolve({});
    });
    await idle();
    expect(ui.close).not.toHaveBeenCalled();
    expect(primaryAction.field.matches(":disabled")).toBe(true);
    act(() => submit(primaryAction));
    expect(mock.writes[primary]).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: ui.labels.accountProfile.close }),
    );
    expect(ui.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

const refreshSections = [
  {
    kind: "account",
    primary: "accountProfile",
    path: "admin.accounts",
    otherPath: "admin.tutors",
  },
  {
    kind: "account",
    primary: "username",
    path: "admin.accounts",
    otherPath: "admin.tutors",
  },
  {
    kind: "tutor",
    primary: "tutorProfile",
    path: "admin.tutors",
    otherPath: "admin.accounts",
  },
  {
    kind: "tutee",
    primary: "tuteeProfile",
    path: "admin.tutees",
    otherPath: "admin.tutors",
  },
] as const;
const refreshCases = refreshSections.flatMap((section) =>
  (["failure-first", "failure-last", "both-fail"] as const).map((order) => ({
    ...section,
    secondPath: section.path,
    order,
    scope: "same procedure",
  })),
);
refreshCases.push(
  ...refreshSections.map((section) => ({
    ...section,
    secondPath: section.otherPath,
    order: "failure-first" as const,
    scope: "different procedures",
  })),
);
it.each(refreshCases)(
  "holds committed $primary until both active reads settle ($scope, $order)",
  async ({ kind, primary, path, secondPath, order }) => {
    const firstRead = deferred(),
      secondRead = deferred();
    const firstFetch = vi.fn(() => firstRead.promise),
      secondFetch = vi.fn(() => secondRead.promise);
    const firstKey = [path, "first"],
      secondKey = [secondPath, "second"];
    const firstObserver = new QueryObserver(client, {
      queryKey: firstKey,
      queryFn: firstFetch,
      initialData: "Cached first",
      staleTime: Infinity,
      retry: false,
    });
    const secondObserver = new QueryObserver(client, {
      queryKey: secondKey,
      queryFn: secondFetch,
      initialData: "Cached second",
      staleTime: Infinity,
      retry: false,
    });
    const stopFirst = firstObserver.subscribe(() => undefined),
      stopSecond = secondObserver.subscribe(() => undefined);
    try {
      const ui = mount(kind, "en");
      const primaryAction = await prepare(primary, ui.labels),
        academicAction = await prepare("academic", ui.labels);
      const write = deferred();
      mock.writes[primary].mockReturnValueOnce(write.promise);
      act(() => submit(primaryAction));
      await waitFor(() => expect(mock.writes[primary]).toHaveBeenCalledOnce());
      await act(async () => write.resolve({}));
      await waitFor(() => {
        expect(firstFetch).toHaveBeenCalledOnce();
        expect(secondFetch).toHaveBeenCalledOnce();
      });
      blocked(ui.close);
      await act(async () => {
        if (order === "failure-last") firstRead.resolve("Fresh first");
        else firstRead.reject(new Error("First refresh failed"));
      });
      await waitFor(() =>
        expect(client.getQueryState(firstKey)?.fetchStatus).toBe("idle"),
      );
      expect(client.isMutating()).toBe(1);
      blocked(ui.close);
      expect(
        screen.queryByText(en.accountProfile.sectionRefreshFailed),
      ).toBeNull();
      expect(academicAction.field.value).toBe("Independent academic reason");
      act(() => {
        submit(primaryAction);
        submit(academicAction);
      });
      expect(mock.writes[primary]).toHaveBeenCalledOnce();
      expect(mock.writes.academic).not.toHaveBeenCalled();
      await act(async () => {
        if (order === "failure-first") secondRead.resolve("Fresh second");
        else secondRead.reject(new Error("Second refresh failed"));
      });
      await idle();
      expect(screen.getByText(en.accountProfile.sectionSaved)).toBeTruthy();
      expect(
        screen.getByText(en.accountProfile.sectionRefreshFailed),
      ).toBeTruthy();
      expect(primaryAction.field.matches(":disabled")).toBe(true);
      expect(academicAction.field.matches(":disabled")).toBe(false);
      expect(academicAction.field.value).toBe("Independent academic reason");
      expect(ui.close).not.toHaveBeenCalled();
      act(() => submit(primaryAction));
      expect(mock.writes[primary]).toHaveBeenCalledOnce();
      fireEvent.click(
        screen.getByRole("button", { name: en.accountProfile.close }),
      );
      expect(ui.close).toHaveBeenCalledOnce();
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      firstRead.resolve();
      secondRead.resolve();
      stopFirst();
      stopSecond();
    }
  },
);

it.each(["membership-first", "departure-first"] as const)(
  "keeps self-service requests as proposals after a sibling failure (%s)",
  async (order) => {
    mock.role = "STUDENT";
    const ui = mount("self", "en");
    const membershipAction = await prepare("requestMembership", ui.labels);
    const departureAction = await prepare("requestDeparture", ui.labels);
    const membershipRequest = deferred(),
      departureRequest = deferred();
    mock.writes.requestMembership.mockReturnValueOnce(
      membershipRequest.promise,
    );
    mock.writes.requestDeparture.mockReturnValueOnce(departureRequest.promise);
    act(() => {
      submit(membershipAction);
      submit(departureAction);
      submit(membershipAction);
      submit(departureAction);
    });
    await waitFor(() =>
      expect(mock.writes.requestDeparture).toHaveBeenCalledOnce(),
    );
    blocked(ui.close);
    if (order === "membership-first")
      await act(async () => membershipRequest.resolve({}));
    else await act(async () => departureRequest.reject(new Error(failureText)));
    await waitFor(() => expect(client.isMutating()).toBe(1));
    blocked(ui.close);
    if (order === "membership-first")
      await act(async () => departureRequest.reject(new Error(failureText)));
    else await act(async () => membershipRequest.resolve({}));
    await idle();
    expect(ui.close).not.toHaveBeenCalled();
    expect(screen.getByText(en.membership.requested)).toBeTruthy();
    expect(screen.queryByText(en.membership.saved)).toBeNull();
    expect(screen.queryByText(en.schoolDeparture.saved)).toBeNull();
    expect(
      screen.getByText(new RegExp(en.schoolDeparture.enrolled)),
    ).toBeTruthy();
    expect(mock.writes.membership).not.toHaveBeenCalled();
    expect(mock.writes.departure).not.toHaveBeenCalled();
    expect(mock.writes.transfer).not.toHaveBeenCalled();
    expect(departureAction.field.value).toBe("Independent departure evidence");
    act(() => submit(departureAction));
    await waitFor(() =>
      expect(mock.writes.requestDeparture).toHaveBeenCalledTimes(2),
    );
    await idle();
    expect(mock.writes.requestDeparture.mock.calls[1]![0]).toEqual(
      mock.writes.requestDeparture.mock.calls[0]![0],
    );
    expect(screen.getByText(en.schoolDeparture.requested)).toBeTruthy();
    expect(screen.queryByText(en.schoolDeparture.saved)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: en.accountProfile.close }),
    );
    expect(ui.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);
