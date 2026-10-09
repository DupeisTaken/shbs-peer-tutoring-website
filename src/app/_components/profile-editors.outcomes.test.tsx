/** @vitest-environment jsdom */
import { useState, type ComponentProps } from "react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type InvalidateOptions,
  type InvalidateQueryFilters,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { AccountProfileEditor } from "./account-profile-editor";
import { TutorProfileEditor } from "./tutor-profile-editor";
import { TuteeEditor } from "./tutee-editor";

type Request = {
  path: string;
  input: Record<string, unknown>;
  settled: boolean;
  resolve: () => void;
  reject: (message: string) => void;
};
const transport = vi.hoisted(() => ({
  requests: [] as Request[],
  commits: [] as string[],
  version: 7,
  refreshGates: new Map<string, Promise<void>>(),
  invalidations: [] as string[],
  routerRefresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: transport.routerRefresh }),
}));

// Only transport is controlled. The editors, their academic/membership/departure/username
// children, dialog context, mutation lifecycle and query invalidation are real components.
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  const academic = () => ({
    academic: {
      status: "REPORTED",
      gradeLevel: 10,
      rawGrade: null,
      schoolYear: "26-27",
      confirmedAt: null,
      needsConfirmation: true,
      expectedGraduationYear: 2029,
    },
    profileVersion: transport.version,
    history: [],
  });
  function query(path: string, data: () => unknown) {
    return {
      useQuery(input?: unknown, options?: { enabled?: boolean }) {
        return useQuery({
          queryKey: [path, input ?? null],
          queryFn: async () => data(),
          initialData: data,
          ...options,
        });
      },
    };
  }
  function mutation(path: string) {
    return {
      useMutation(
        options: {
          onSuccess?: (data: unknown) => unknown;
          onError?: (error: Error) => unknown;
          onSettled?: () => unknown;
        } = {},
      ) {
        return useMutation({
          mutationKey: [path],
          mutationFn: (input: Record<string, unknown>) =>
            new Promise<unknown>((resolve, reject) => {
              const request: Request = {
                path,
                input,
                settled: false,
                resolve: () => {
                  request.settled = true;
                  transport.commits.push(path);
                  if (
                    path.includes("Profile") ||
                    path.includes("Academics") ||
                    path.includes("Username")
                  )
                    transport.version++;
                  resolve({});
                },
                reject: (message) => {
                  request.settled = true;
                  reject(new Error(message));
                },
              };
              transport.requests.push(request);
            }),
          ...options,
        });
      },
    };
  }
  return {
    api: {
      useUtils() {
        const client = useQueryClient();
        const invalidate = async (
          path: string,
          filters?: InvalidateQueryFilters,
          options?: InvalidateOptions,
        ) => {
          transport.invalidations.push(path);
          const gate = transport.refreshGates.get(path);
          if (gate) await gate;
          // Match the installed tRPC adapter: forward both filter and error options,
          // and constrain invalidation to the procedure/router prefix it represents.
          await client.invalidateQueries(
            { ...filters, queryKey: path === "*" ? undefined : [path] },
            options,
          );
        };
        const invalidator = (path: string) => ({
          // A forced authorized read returns the committed row, not invalidation's void result.
          fetch: async () => {
            const saved = [...transport.requests]
              .reverse()
              .find(
                (request) =>
                  request.settled &&
                  transport.commits.includes(request.path) &&
                  (path === "admin.accounts"
                    ? request.path.includes("Account")
                    : path === "admin.tutors"
                      ? request.path === "admin.updateTutor"
                      : request.path === "admin.updateTutee"),
              );
            const firstName =
              typeof saved?.input.firstName === "string"
                ? saved.input.firstName
                : row.firstName;
            const fresh = {
              ...row,
              ...saved?.input,
              userId: "account",
              name: `${firstName} Person`,
              profileVersion: transport.version,
              updatedAt: new Date("2026-09-02"),
            };
            return path === "admin.accounts" ? { rows: [fresh] } : [fresh];
          },
          invalidate: (
            _input?: unknown,
            filters?: InvalidateQueryFilters,
            options?: InvalidateOptions,
          ) => invalidate(path, filters, options),
        });
        return {
          invalidate: (
            _input?: unknown,
            filters?: InvalidateQueryFilters,
            options?: InvalidateOptions,
          ) => invalidate("*", filters, options),
          account: {
            me: invalidator("account.me"),
            academicHistory: invalidator("account.academicHistory"),
          },
          admin: {
            accounts: invalidator("admin.accounts"),
            tutors: invalidator("admin.tutors"),
            tutees: invalidator("admin.tutees"),
            accountAcademics: invalidator("admin.accountAcademics"),
            tuteeStats: invalidator("admin.tuteeStats"),
            pairings: invalidator("admin.pairings"),
          },
          tutor: {
            me: invalidator("tutor.me"),
            myProfile: invalidator("tutor.myProfile"),
          },
          tutorDetails: invalidator("tutorDetails"),
          tuteeHistory: invalidator("tuteeHistory"),
        };
      },
      program: {
        profilePolicy: query("program.profilePolicy", () => ({
          requireLatinNames: false,
          offeredGrades: [9, 10, 11, 12],
          currentSchoolYear: "26-27",
        })),
      },
      admin: {
        updateAccountProfile: mutation("admin.updateAccountProfile"),
        updateTutor: mutation("admin.updateTutor"),
        updateTutee: mutation("admin.updateTutee"),
        updateAccountUsername: mutation("admin.updateAccountUsername"),
        updateAccountAcademics: mutation("admin.updateAccountAcademics"),
        setMemberships: mutation("admin.setMemberships"),
        transferHead: mutation("admin.transferHead"),
        accountAcademics: query("admin.accountAcademics", academic),
        subjects: query("admin.subjects", () => []),
        timeSlots: query("admin.timeSlots", () => []),
      },
      account: {
        me: query("account.me", academic),
        academicHistory: query("account.academicHistory", () => []),
        updateAcademics: mutation("account.updateAcademics"),
        requestMemberships: mutation("account.requestMemberships"),
      },
      departure: {
        state: query("departure.state", () => ({
          role: "HEAD",
          departure: null,
          events: [],
        })),
        setState: mutation("departure.setState"),
        request: mutation("departure.request"),
      },
    },
  };
});

let client: QueryClient;
beforeEach(() => {
  transport.requests = [];
  transport.commits = [];
  transport.version = 7;
  transport.refreshGates.clear();
  transport.invalidations = [];
  transport.routerRefresh.mockClear();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

const row = {
  id: "person",
  firstName: "Original",
  lastName: "Person",
  englishName: "Original Person",
  username: "originaluser",
  preferredName: null,
  alternativeNames: null,
  gradeLevel: 10,
  status: "ACTIVE",
  historical: false,
  updatedAt: new Date("2026-09-01"),
  user: { id: "account", email: "person@example.test" },
  availabilities: [],
};
type Kind = "account" | "tutor" | "tutee";
type Operation =
  "profile" | "username" | "academic" | "membership" | "departure";
function mount(kind: Kind) {
  const close = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    const onClose = () => {
      close();
      setOpen(false);
    };
    return (
      open &&
      (kind === "account" ? (
        <AccountProfileEditor
          profile={{
            ...row,
            name: row.englishName,
            userId: "account",
            profileVersion: 7,
          }}
          membership={{
            rank: "NONE",
            tutor: true,
            tutee: false,
            viewer: false,
            translator: false,
            crew: false,
          }}
          isHead
          onClose={onClose}
        />
      ) : kind === "tutor" ? (
        <TutorProfileEditor
          row={
            row as unknown as ComponentProps<typeof TutorProfileEditor>["row"]
          }
          onClose={onClose}
        />
      ) : (
        <TuteeEditor
          row={row as unknown as ComponentProps<typeof TuteeEditor>["row"]}
          onClose={onClose}
        />
      ))
    );
  }
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <Host />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return close;
}
async function operation(kind: Kind, which: Operation, prefix: string) {
  let field: HTMLInputElement | HTMLTextAreaElement;
  let action: HTMLFormElement | HTMLButtonElement;
  let path: string;
  if (which === "profile") {
    field = screen.getByLabelText("First Name Required");
    action = field.closest("form")!;
    path =
      kind === "account"
        ? "admin.updateAccountProfile"
        : kind === "tutor"
          ? "admin.updateTutor"
          : "admin.updateTutee";
    fireEvent.change(field, { target: { value: `${prefix}ProfileDraft` } });
  } else if (which === "username") {
    field = screen.getByLabelText(en.accountProfile.username);
    action = field.closest("form")!;
    path = "admin.updateAccountUsername";
    fireEvent.change(field, {
      target: { value: `${prefix.toLowerCase()}username` },
    });
  } else if (which === "academic") {
    const section = screen
      .getByRole("heading", { name: en.academics.title })
      .closest("section")!;
    fireEvent.click(
      await within(section).findByRole("button", { name: en.academics.review }),
    );
    field = within(section).getByRole("textbox", { name: en.academics.reason });
    action = field.closest("form")!;
    path = "admin.updateAccountAcademics";
    fireEvent.change(field, { target: { value: `${prefix} academic reason` } });
  } else if (which === "membership") {
    const section = screen
      .getByRole("heading", { name: en.membership.title })
      .closest("section")!;
    fireEvent.change(
      within(section).getByRole("combobox", { name: en.membership.rank }),
      { target: { value: "COORDINATOR" } },
    );
    field = within(section).getByLabelText(en.membership.password);
    fireEvent.change(field, {
      target: { value: `${prefix}SyntheticConfirmation` },
    });
    action = within(section).getByRole("button", { name: en.membership.save });
    path = "admin.setMemberships";
  } else {
    const section = screen
      .getByRole("heading", { name: en.schoolDeparture.title })
      .closest("section")!;
    field = within(section).getByRole("textbox", {
      name: en.schoolDeparture.reason,
    });
    fireEvent.change(field, {
      target: { value: `${prefix} departure explanation` },
    });
    fireEvent.click(
      within(section).getByRole("button", { name: en.schoolDeparture.review }),
    );
    action = within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", {
      name: en.schoolDeparture.confirm,
    });
    path = "departure.setState";
  }
  const initialDraft = field.value;
  return {
    get field() {
      return which === "profile"
        ? screen.getByLabelText<HTMLInputElement>("First Name Required")
        : field;
    },
    path,
    initialDraft,
    submit: () =>
      (which === "profile"
        ? screen.getByLabelText("First Name Required").closest("form")!
        : action
      ).dispatchEvent(
        action instanceof HTMLFormElement
          ? new Event("submit", { bubbles: true, cancelable: true })
          : new MouseEvent("click", { bubbles: true }),
      ),
  };
}
function blocked(close: ReturnType<typeof vi.fn>) {
  for (const dialog of screen.getAllByRole("dialog")) {
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: en.accountProfile.close,
      }).disabled,
    ).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
  }
  expect(close).not.toHaveBeenCalled();
}
function deliberatelyClose(close: ReturnType<typeof vi.fn>) {
  // A failed departure review owns the first Close; its parent remains until separately closed.
  if (screen.getAllByRole("dialog").length === 2) {
    fireEvent.click(
      within(screen.getAllByRole("dialog")[1]!).getByRole("button", {
        name: en.accountProfile.close,
      }),
    );
    expect(close).not.toHaveBeenCalled();
  }
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.close }),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
}

const pairs = [
  ["account", "profile", "academic"],
  ["tutor", "profile", "academic"],
  ["tutee", "profile", "academic"],
  ["account", "profile", "username"],
  ["account", "profile", "membership"],
  ["account", "profile", "departure"],
  ["account", "username", "profile"],
  ["account", "username", "academic"],
  ["account", "username", "membership"],
  ["account", "username", "departure"],
] as const;
const cases = pairs.flatMap(([kind, primary, sibling]) =>
  (["primary-first", "sibling-first"] as const).flatMap((order) =>
    (["sibling-fails", "primary-fails", "all-success"] as const).map(
      (outcome) => ({ kind, primary, sibling, order, outcome }),
    ),
  ),
);
it.each(cases)(
  "retains $kind $primary / $sibling outcomes ($order, $outcome)",
  async ({ kind, primary, sibling, order, outcome }) => {
    const close = mount(kind);
    const first = await operation(kind, primary, "Primary");
    const second = await operation(kind, sibling, "Sibling");
    // Model already-admitted operations before their shared pending render. Ordinary later
    // submissions are blocked below. This does not bypass production API authorization.
    act(() => {
      first.submit();
      second.submit();
    });
    await waitFor(() => expect(transport.requests).toHaveLength(2));
    const primaryRequest = transport.requests.find(
      (r) => r.path === first.path,
    )!;
    const siblingRequest = transport.requests.find(
      (r) => r.path === second.path,
    )!;
    expect(primaryRequest).toBeTruthy();
    expect(siblingRequest).toBeTruthy();
    await waitFor(() => expect(client.isMutating()).toBe(2));
    blocked(close);
    act(() => {
      first.submit();
    });
    expect(transport.requests).toHaveLength(2);
    const complete = async (request: Request, failed: boolean) => {
      await act(async () => {
        if (failed) request.reject(`Failed ${request.path}`);
        else request.resolve();
      });
    };
    await complete(
      order === "primary-first" ? primaryRequest : siblingRequest,
      order === "primary-first"
        ? outcome === "primary-fails"
        : outcome === "sibling-fails",
    );
    await waitFor(() => expect(client.isMutating()).toBe(1));
    blocked(close);
    await complete(
      order === "primary-first" ? siblingRequest : primaryRequest,
      order === "primary-first"
        ? outcome === "sibling-fails"
        : outcome === "primary-fails",
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(close).not.toHaveBeenCalled();
    for (const dialog of screen.getAllByRole("dialog"))
      expect(dialog.getAttribute("aria-busy")).toBe("false");
    if (outcome !== "primary-fails") {
      expect(first.field.isConnected).toBe(true);
      expect(first.field.matches(":disabled")).toBe(false);
      expect(first.field.closest("fieldset")?.getAttribute("aria-busy")).toBe(
        "false",
      );
      // A successful section is ready for a new explicit Save; it never submits automatically.
      expect(transport.requests).toHaveLength(2);
    }
    if (outcome !== "all-success") {
      const failed = outcome === "sibling-fails" ? second : first;
      const failedRequest =
        outcome === "sibling-fails" ? siblingRequest : primaryRequest;
      expect(failed.field.isConnected).toBe(true);
      expect(failed.field.value).toBe(failed.initialDraft);
      expect(failed.field.matches(":disabled")).toBe(false);
      expect(
        screen.getAllByText(`Failed ${failed.path}`).length,
      ).toBeGreaterThan(0);
      // A background refresh after the unrelated success may change cached versions, but
      // retry must still use the failed draft's captured request. It must not replay the commit.
      act(() => {
        failed.submit();
      });
      await waitFor(() => expect(transport.requests).toHaveLength(3));
      expect(transport.requests[2]!.input).toEqual(failedRequest.input);
      expect(transport.commits).toHaveLength(1);
      await complete(transport.requests[2]!, true);
      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(failed.field.value).toBe(failed.initialDraft);
      expect(failed.field.matches(":disabled")).toBe(false);
    } else expect(transport.commits).toHaveLength(2);
    deliberatelyClose(close);
  },
);

const observedRefreshCases = [
  { kind: "account", path: "admin.accounts" },
  { kind: "tutor", path: "admin.tutors" },
  { kind: "tutee", path: "admin.tutees" },
  { kind: "username", path: "admin.accounts" },
] as const;
it.each(
  observedRefreshCases.flatMap((entry) =>
    (["success", "failure"] as const).flatMap((firstOutcome) =>
      (["success", "failure"] as const).map((lastOutcome) => ({
        ...entry,
        firstOutcome,
        lastOutcome,
      })),
    ),
  ),
)(
  "owns both active $path reads after committed $kind ($firstOutcome then $lastOutcome)",
  async ({ kind, path, firstOutcome, lastOutcome }) => {
    const editorKind = kind === "username" ? "account" : kind;
    const close = mount(editorKind);
    const primary = await operation(
      editorKind,
      kind === "username" ? "username" : "profile",
      "Primary",
    );
    const sibling = await operation(editorKind, "academic", "Sibling");
    const firstRead = refreshGate();
    const lastRead = refreshGate();
    const firstError = new Error("First actual GET failed");
    const lastError = new Error("Last actual GET failed");
    const firstFetch = vi.fn(async () => {
      await firstRead.promise;
      return [{ id: "first-fresh" }];
    });
    const lastFetch = vi.fn(async () => {
      await lastRead.promise;
      return [{ id: "last-fresh" }];
    });
    // Two real active cache entries under one procedure prefix expose QueryClient's
    // inner aggregate. Errors originate in query functions, not mocked invalidations.
    const firstObserver = new QueryObserver(client, {
      queryKey: [path, { page: 1 }],
      queryFn: firstFetch,
      initialData: [{ id: "first-cached" }],
      staleTime: Infinity,
    });
    const lastObserver = new QueryObserver(client, {
      queryKey: [path, { page: 2 }],
      queryFn: lastFetch,
      initialData: [{ id: "last-cached" }],
      staleTime: Infinity,
    });
    const stopFirst = firstObserver.subscribe(() => undefined);
    const stopLast = lastObserver.subscribe(() => undefined);
    try {
      expect(firstFetch).not.toHaveBeenCalled();
      expect(lastFetch).not.toHaveBeenCalled();
      act(() => {
        primary.submit();
      });
      await waitFor(() => expect(transport.requests).toHaveLength(1));
      await act(async () => transport.requests[0]!.resolve());
      await waitFor(() => {
        expect(firstFetch).toHaveBeenCalledOnce();
        expect(lastFetch).toHaveBeenCalledOnce();
      });
      blocked(close);
      expect(screen.getByText(en.accountProfile.sectionSaved)).toBeTruthy();
      await act(async () => {
        if (firstOutcome === "failure") firstRead.reject(firstError);
        else firstRead.resolve();
        // Flush the installed query/mutation lifecycle so an early aggregate rejection
        // cannot pass merely because React Query has not yet delivered its notifications.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      expect(firstObserver.getCurrentResult().isFetching).toBe(false);
      expect(firstObserver.getCurrentResult().error).toBe(
        firstOutcome === "failure" ? firstError : null,
      );
      expect(lastObserver.getCurrentResult().isFetching).toBe(true);
      expect(client.isMutating()).toBe(1);
      expect(
        screen.queryByText(en.accountProfile.sectionRefreshFailed),
      ).toBeNull();
      blocked(close);
      expect(sibling.field.matches(":disabled")).toBe(true);
      act(() => {
        primary.submit();
        sibling.submit();
      });
      expect(transport.requests).toHaveLength(1);
      expect(transport.routerRefresh).not.toHaveBeenCalled();
      await act(async () => {
        if (lastOutcome === "failure") lastRead.reject(lastError);
        else lastRead.resolve();
      });
      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(lastObserver.getCurrentResult().isFetching).toBe(false);
      expect(lastObserver.getCurrentResult().error).toBe(
        lastOutcome === "failure" ? lastError : null,
      );
      expect(firstObserver.getCurrentResult().data).toEqual([
        { id: firstOutcome === "failure" ? "first-cached" : "first-fresh" },
      ]);
      expect(lastObserver.getCurrentResult().data).toEqual([
        { id: lastOutcome === "failure" ? "last-cached" : "last-fresh" },
      ]);
      if (firstOutcome === "failure" || lastOutcome === "failure")
        expect(
          screen.getByText(en.accountProfile.sectionRefreshFailed),
        ).toBeTruthy();
      else
        expect(
          screen.queryByText(en.accountProfile.sectionRefreshFailed),
        ).toBeNull();
      expect(primary.field.matches(":disabled")).toBe(
        firstOutcome === "failure" || lastOutcome === "failure",
      );
      expect(primary.field.closest("fieldset")?.getAttribute("aria-busy")).toBe(
        "false",
      );
      expect(sibling.field.isConnected).toBe(true);
      expect(sibling.field.value).toBe(sibling.initialDraft);
      expect(sibling.field.matches(":disabled")).toBe(false);
      expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe(
        "false",
      );
      expect(close).not.toHaveBeenCalled();
      if (firstOutcome === "failure" || lastOutcome === "failure") {
        act(() => {
          primary.submit();
        });
      }
      expect(transport.requests).toHaveLength(1);
      expect(transport.commits).toEqual([primary.path]);
      // The correction must neither retry the GET nor replay a committed POST.
      expect(firstFetch).toHaveBeenCalledOnce();
      expect(lastFetch).toHaveBeenCalledOnce();
      if (kind === "username")
        expect(transport.routerRefresh).toHaveBeenCalledOnce();
      deliberatelyClose(close);
    } finally {
      stopFirst();
      stopLast();
    }
  },
);

function refreshGate() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}
const refreshCases = [
  { kind: "account", failed: "admin.accounts", held: "account.me" },
  { kind: "tutor", failed: "admin.tutors", held: "admin.accounts" },
  { kind: "username", failed: "admin.accounts", held: "account.me" },
  // Both sides of the nested boundary matter: the outer aggregate cannot repair an
  // early-rejecting inner group, and the inner group cannot protect an early outer exit.
  { kind: "tutee", failed: "admin.tutees", held: "tuteeHistory" },
  { kind: "tutee", failed: "admin.tutors", held: "admin.pairings" },
  { kind: "tutee", failed: "admin.accounts", held: "admin.tutors" },
] as const;
it.each(
  refreshCases.flatMap((entry) =>
    (["success", "failure"] as const).map((lastOutcome) => ({
      ...entry,
      lastOutcome,
    })),
  ),
)(
  "keeps committed $kind pending after $failed rejects until $held settles ($lastOutcome)",
  async ({ kind, failed, held, lastOutcome }) => {
    const editorKind = kind === "username" ? "account" : kind;
    const close = mount(editorKind);
    const primary = await operation(
      editorKind,
      kind === "username" ? "username" : "profile",
      "Primary",
    );
    const sibling = await operation(editorKind, "academic", "Sibling");
    const failedRead = refreshGate();
    const heldRead = refreshGate();
    transport.refreshGates.set(failed, failedRead.promise);
    transport.refreshGates.set(held, heldRead.promise);
    act(() => {
      primary.submit();
      primary.submit();
    });
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await act(async () => transport.requests[0]!.resolve());
    await waitFor(() => {
      expect(transport.invalidations).toContain(failed);
      expect(transport.invalidations).toContain(held);
    });
    expect(screen.getByText(en.accountProfile.sectionSaved)).toBeTruthy();
    blocked(close);
    act(() => {
      primary.submit();
    });
    expect(transport.requests).toHaveLength(1);
    await act(async () => {
      failedRead.reject(new Error("First read synchronization failed"));
      // Let the rejection and mutation lifecycle run; a fail-fast aggregate would now
      // settle even though the other independently controlled refresh is still held.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(client.isMutating()).toBe(1);
    expect(
      screen.queryByText(en.accountProfile.sectionRefreshFailed),
    ).toBeNull();
    blocked(close);
    expect(sibling.field.matches(":disabled")).toBe(true);
    act(() => {
      primary.submit();
      sibling.submit();
    });
    expect(transport.requests).toHaveLength(1);
    expect(transport.routerRefresh).not.toHaveBeenCalled();
    await act(async () => {
      if (lastOutcome === "success") heldRead.resolve();
      else heldRead.reject(new Error("Last read synchronization failed"));
    });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(
      screen.getByText(en.accountProfile.sectionRefreshFailed),
    ).toBeTruthy();
    expect(primary.field.matches(":disabled")).toBe(true);
    expect(primary.field.closest("fieldset")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(sibling.field.isConnected).toBe(true);
    expect(sibling.field.value).toBe(sibling.initialDraft);
    expect(sibling.field.matches(":disabled")).toBe(false);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    act(() => {
      primary.submit();
    });
    expect(transport.requests).toHaveLength(1);
    expect(transport.commits).toEqual([primary.path]);
    if (kind === "username")
      expect(transport.routerRefresh).toHaveBeenCalledOnce();
    deliberatelyClose(close);
  },
);
