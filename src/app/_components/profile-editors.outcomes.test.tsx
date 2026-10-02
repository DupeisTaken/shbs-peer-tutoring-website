/** @vitest-environment jsdom */
import { useState, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  refreshGate: null as Promise<void> | null,
  invalidations: 0,
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
        const invalidate = async () => {
          transport.invalidations++;
          if (transport.refreshGate) await transport.refreshGate;
          await client.invalidateQueries();
        };
        const invalidator = { invalidate };
        return {
          invalidate,
          account: { me: invalidator, academicHistory: invalidator },
          admin: {
            accounts: invalidator,
            tutors: invalidator,
            tutees: invalidator,
            accountAcademics: invalidator,
            tuteeStats: invalidator,
            pairings: invalidator,
          },
          tutor: { me: invalidator, myProfile: invalidator },
          tutorDetails: invalidator,
          tuteeHistory: invalidator,
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
  transport.refreshGate = null;
  transport.invalidations = 0;
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
    field,
    path,
    initialDraft,
    submit: () =>
      action.dispatchEvent(
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
    act(() => first.submit());
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
      expect(first.field.matches(":disabled")).toBe(true);
      expect(first.field.closest("fieldset")?.getAttribute("aria-busy")).toBe(
        "false",
      );
      act(() => first.submit());
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
      act(() => failed.submit());
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

it.each(["account", "tutor", "tutee", "username"] as const)(
  "does not replay the committed %s operation while refresh is held or fails",
  async (kind) => {
    const close = mount(kind === "username" ? "account" : kind);
    const primary = await operation(
      kind === "username" ? "account" : kind,
      kind === "username" ? "username" : "profile",
      "Primary",
    );
    let rejectRefresh!: (error: Error) => void;
    transport.refreshGate = new Promise<void>((_, reject) => {
      rejectRefresh = reject;
    });
    act(() => {
      primary.submit();
      primary.submit();
    });
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await act(async () => transport.requests[0]!.resolve());
    await waitFor(() => expect(transport.invalidations).toBeGreaterThan(0));
    expect(screen.getByText(en.accountProfile.sectionSaved)).toBeTruthy();
    blocked(close);
    act(() => primary.submit());
    expect(transport.requests).toHaveLength(1);
    await act(async () =>
      rejectRefresh(new Error("Read synchronization failed")),
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(
      screen.getByText(en.accountProfile.sectionRefreshFailed),
    ).toBeTruthy();
    expect(primary.field.matches(":disabled")).toBe(true);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    act(() => primary.submit());
    expect(transport.requests).toHaveLength(1);
    expect(transport.commits).toEqual([primary.path]);
    deliberatelyClose(close);
  },
);
