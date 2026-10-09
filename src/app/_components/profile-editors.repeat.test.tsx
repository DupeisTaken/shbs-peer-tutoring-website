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
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import { AccountProfileEditor } from "./account-profile-editor";
import { AccountUsernameEditor } from "./account-username-editor";
import { TutorProfileEditor } from "./tutor-profile-editor";
import { TuteeEditor } from "./tutee-editor";
import { ProfileDialog } from "./profile-dialog";

type Request = {
  path: string;
  input: Record<string, unknown>;
  resolve: () => void;
  reject: (message: string, code?: string) => void;
};
const transport = vi.hoisted(() => {
  const latest: Record<string, unknown> = {};
  return {
    requests: [] as Request[],
    fetch:
      vi.fn<
        (path: string, input: unknown, options: unknown) => Promise<unknown>
      >(),
    invalidate: vi.fn<(path: string) => Promise<void>>(),
    latest,
    routerRefresh: vi.fn(),
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: transport.routerRefresh }),
}));

// Keep the real mutation lifecycle, dialog registration, name fields and section UI.
// Read/write transport alone is controlled so a GET retry cannot masquerade as a POST.
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  function mutation(path: string) {
    return {
      useMutation(
        options: {
          onSuccess?: (data: unknown) => unknown;
          onSettled?: () => unknown;
        } = {},
      ) {
        return useMutation({
          mutationFn: (input: Record<string, unknown>) =>
            new Promise<unknown>((resolve, reject) => {
              transport.requests.push({
                path,
                input,
                resolve: () => resolve({}),
                reject: (message, code) =>
                  reject(
                    Object.assign(new Error(message), {
                      data: code ? { code } : undefined,
                    }),
                  ),
              });
            }),
          ...options,
        });
      },
    };
  }
  const invalidator = (path: string) => ({
    invalidate: () => transport.invalidate(path),
    fetch: (input: unknown, options: unknown) =>
      transport.fetch(path, input, options),
  });
  const query = (data: unknown) => ({
    useQuery: () => ({
      data,
      isLoading: false,
      isFetching: false,
      error: null,
    }),
  });
  return {
    api: {
      useUtils: () => ({
        admin: {
          accounts: invalidator("admin.accounts"),
          tutors: invalidator("admin.tutors"),
          tutees: invalidator("admin.tutees"),
          pairings: invalidator("admin.pairings"),
          tuteeStats: invalidator("admin.tuteeStats"),
        },
        account: { me: invalidator("account.me") },
        tuteeHistory: invalidator("tuteeHistory"),
      }),
      program: {
        profilePolicy: query({
          offeredGrades: [9, 10, 11, 12],
          currentSchoolYear: "26-27",
        }),
      },
      admin: {
        updateAccountProfile: mutation("admin.updateAccountProfile"),
        updateAccountUsername: mutation("admin.updateAccountUsername"),
        updateAccountAcademics: mutation("admin.updateAccountAcademics"),
        updateTutor: mutation("admin.updateTutor"),
        updateTutee: mutation("admin.updateTutee"),
        subjects: query([]),
        timeSlots: query([]),
      },
    },
  };
});
vi.mock("./school-departure", () => ({ SchoolDeparturePanel: () => null }));
vi.mock("./tutor-history-link", () => ({
  TutorHistorySection: () => {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="Independent historical link draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));
vi.mock("./academic-profile", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  const { useDialogPending } = await import("./ui/modal");
  return {
    AcademicPanel: () => {
      const [draft, setDraft] = useState("");
      // This independent fixture deliberately captures its own original version.
      const save = useMutation({
        mutationFn: (input: Record<string, unknown>) =>
          new Promise<void>((resolve, reject) => {
            transport.requests.push({
              path: "admin.updateAccountAcademics",
              input,
              resolve,
              reject: (message) => reject(new Error(message)),
            });
          }),
      });
      const busy = useDialogPending(save.isPending);
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy)
              save.mutate({
                userId: "account",
                expectedProfileVersion: 7,
                reason: draft,
              });
          }}
        >
          <input
            aria-label="Independent academic draft"
            disabled={busy}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button disabled={busy} type="submit">
            Save independent academics
          </button>
          {save.error && <p role="alert">{save.error.message}</p>}
        </form>
      );
    },
  };
});

const original = {
  id: "person",
  userId: "account",
  firstName: "Original",
  lastName: "Person",
  name: "Original Person",
  englishName: "Original Person",
  preferredName: null,
  alternativeNames: null,
  legacyName: "Original Person",
  username: "originaluser",
  profileVersion: 7,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  gradeLevel: 10,
  status: "ACTIVE",
  historical: false,
  email: "person@example.test",
  phone: "111",
  notes: "Original note",
  preferredContact: null,
  firstChoiceId: null,
  secondChoiceId: null,
  availabilities: [],
  user: { id: "account", email: "person@example.test" },
};
const latestTime = new Date("2026-09-02T00:00:00Z");
type Kind = "account" | "username" | "tutor" | "tutee";
const kinds: Kind[] = ["account", "username", "tutor", "tutee"];
let client: QueryClient;
beforeEach(() => {
  transport.requests = [];
  transport.latest = {
    ...original,
    firstName: "Synchronized",
    name: "Synchronized Person",
    englishName: "Synchronized Person",
    username: "synchronizeduser",
    profileVersion: 8,
    updatedAt: latestTime,
    phone: "222",
    notes: "Synchronized note",
  };
  transport.invalidate.mockReset().mockResolvedValue(undefined);
  transport.fetch.mockReset().mockImplementation(async (path: string) =>
    path === "admin.accounts"
      ? {
          rows: [
            {
              ...transport.latest,
              userId: "someone-else",
              firstName: "Wrong",
            },
            transport.latest,
          ],
        }
      : [
          { ...transport.latest, id: "someone-else", firstName: "Wrong" },
          transport.latest,
        ],
  );
  transport.routerRefresh.mockClear();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
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

function mount(kind: Kind) {
  const close = vi.fn();
  const node =
    kind === "account" ? (
      <AccountProfileEditor profile={original} onClose={close} />
    ) : kind === "username" ? (
      <ProfileDialog title="Username editor" onClose={close}>
        <AccountUsernameEditor
          userId="account"
          username={original.username}
          profileVersion={7}
        />
      </ProfileDialog>
    ) : kind === "tutor" ? (
      <TutorProfileEditor
        row={
          original as unknown as ComponentProps<
            typeof TutorProfileEditor
          >["row"]
        }
        onClose={close}
      />
    ) : (
      <TuteeEditor
        row={original as unknown as ComponentProps<typeof TuteeEditor>["row"]}
        onClose={close}
      />
    );
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const field = screen.getByLabelText<HTMLInputElement>(
    kind === "username" ? en.accountProfile.username : "First Name Required",
  );
  return { field, form: field.closest("form")!, close };
}
async function committed(form: HTMLFormElement) {
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  await waitFor(() => expect(transport.requests).toHaveLength(1));
  await act(async () => transport.requests[0]!.resolve());
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.getByText(en.accountProfile.sectionSaved)).toBeTruthy();
}
const refresh = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: en.accountProfile.retryRefresh,
  });
const currentField = (kind: Kind) =>
  screen.getByLabelText<HTMLInputElement>(
    kind === "username" ? en.accountProfile.username : "First Name Required",
  );
const pathFor = (kind: Kind) =>
  kind === "tutor"
    ? "admin.tutors"
    : kind === "tutee"
      ? "admin.tutees"
      : "admin.accounts";
const response = (kind: Kind) =>
  pathFor(kind) === "admin.accounts"
    ? { rows: [transport.latest] }
    : [transport.latest];

it.each(kinds)(
  "automatically adopts each fresh %s fence across three explicit saves",
  async (kind) => {
    const { close } = mount(kind);
    for (let cycle = 0; cycle < 3; cycle++) {
      const field = currentField(kind);
      const draft = kind === "username" ? `save${cycle}` : `Save${cycle}`;
      const expected =
        kind === "account" || kind === "username"
          ? { expectedProfileVersion: 7 + cycle }
          : {
              expectedUpdatedAt:
                cycle === 0
                  ? original.updatedAt
                  : new Date(`2026-09-0${cycle + 1}T00:00:00Z`),
            };
      fireEvent.change(field, { target: { value: draft } });
      expect(screen.queryByText(en.accountProfile.sectionSaved)).toBeNull();
      act(() => {
        fireEvent.submit(field.closest("form")!);
        fireEvent.submit(field.closest("form")!);
      });
      await waitFor(() => expect(transport.requests).toHaveLength(cycle + 1));
      expect(transport.requests[cycle]!.input).toMatchObject(expected);
      transport.latest = {
        ...transport.latest,
        firstName: draft,
        username: draft,
        profileVersion: 8 + cycle,
        updatedAt: new Date(`2026-09-0${cycle + 2}T00:00:00Z`),
      };
      await act(async () => transport.requests[cycle]!.resolve());
      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(currentField(kind).matches(":disabled")).toBe(false);
      expect(currentField(kind).value).toBe(draft);
      if (kind === "tutee") {
        expect(
          screen.getByLabelText<HTMLInputElement>(en.profileCorrection.phone)
            .value,
        ).toBe("222");
        expect(
          screen.getByLabelText<HTMLTextAreaElement>(en.profileCorrection.notes)
            .value,
        ).toBe("Synchronized note");
      }
      expect(screen.getByText(en.accountProfile.sectionSaved)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: en.accountProfile.retryRefresh }),
      ).toBeNull();
      expect(transport.fetch).toHaveBeenLastCalledWith(
        pathFor(kind),
        undefined,
        { staleTime: 0 },
      );
    }
    expect(close).not.toHaveBeenCalled();
  },
);

it.each(kinds)(
  "recovers failed %s synchronization and missing rows by reads without replay",
  async (kind) => {
    transport.invalidate.mockRejectedValueOnce(
      new Error("Synchronization offline"),
    );
    const { field, form } = mount(kind);
    fireEvent.change(field, {
      target: { value: kind === "username" ? "savedusername" : "Saved" },
    });
    await committed(form);
    expect(field.matches(":disabled")).toBe(true);
    expect(transport.fetch).not.toHaveBeenCalled();
    transport.fetch.mockRejectedValueOnce(new Error("Fresh profile offline"));
    await act(async () => fireEvent.click(refresh()));
    expect(screen.getByText("Fresh profile offline")).toBeTruthy();
    transport.fetch.mockResolvedValueOnce(
      pathFor(kind) === "admin.accounts" ? { rows: [] } : [],
    );
    await act(async () => fireEvent.click(refresh()));
    expect(field.matches(":disabled")).toBe(true);
    expect(field.value).toBe(kind === "username" ? "savedusername" : "Saved");
    fireEvent.submit(form);
    expect(transport.requests).toHaveLength(1);
    await act(async () => fireEvent.click(refresh()));
    expect(transport.fetch).toHaveBeenCalledTimes(3);
    expect(currentField(kind).matches(":disabled")).toBe(false);
    expect(
      screen.queryByText(en.accountProfile.sectionRefreshFailed),
    ).toBeNull();
    expect(transport.requests).toHaveLength(1);
  },
);

it.each(kinds)(
  "returns focus from %s Retry refresh to its fresh own field",
  async (kind) => {
    transport.invalidate.mockRejectedValueOnce(
      new Error("Synchronization offline"),
    );
    const { form } = mount(kind);
    await committed(form);
    refresh().focus();
    await act(async () => fireEvent.click(refresh()));
    expect(document.activeElement).toBe(currentField(kind));
    expect(transport.requests).toHaveLength(1);
  },
);

it.each<Exclude<Kind, "username">>(["account", "tutor", "tutee"])(
  "preserves moved sibling focus during a held %s Retry refresh read",
  async (kind) => {
    transport.invalidate.mockRejectedValueOnce(
      new Error("Synchronization offline"),
    );
    const { form } = mount(kind);
    const sibling = screen.getByLabelText<HTMLInputElement>(
      "Independent academic draft",
    );
    fireEvent.change(sibling, { target: { value: "Keep typing" } });
    await committed(form);
    let finish!: (value: unknown) => void;
    transport.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    refresh().focus();
    fireEvent.click(refresh());
    await waitFor(() => expect(transport.fetch).toHaveBeenCalledOnce());
    expect(sibling.matches(":disabled")).toBe(false);
    sibling.focus();
    fireEvent.change(sibling, { target: { value: "Continued while reading" } });
    await act(async () => finish(response(kind)));
    expect(currentField(kind).matches(":disabled")).toBe(false);
    expect(document.activeElement).toBe(sibling);
    expect(screen.getByLabelText("Independent academic draft")).toBe(sibling);
    expect(sibling.value).toBe("Continued while reading");
    expect(transport.requests).toHaveLength(1);
  },
);

it.each(kinds)(
  "locks %s while its automatic fresh read waits without replaying its write",
  async (kind) => {
    let finish!: (value: unknown) => void;
    transport.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { field, form, close } = mount(kind);
    fireEvent.submit(form);
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await act(async () => transport.requests[0]!.resolve());
    await waitFor(() => expect(transport.fetch).toHaveBeenCalledOnce());
    expect(field.matches(":disabled")).toBe(true);
    fireEvent.submit(form);
    expect(transport.requests).toHaveLength(1);
    await act(async () => finish(response(kind)));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(currentField(kind).matches(":disabled")).toBe(false);
    expect(close).not.toHaveBeenCalled();
  },
);

it.each(kinds)(
  "retains a conflicting second %s draft and captured fence on Retry",
  async (kind) => {
    const { form } = mount(kind);
    await committed(form);
    const field = currentField(kind);
    fireEvent.change(field, {
      target: {
        value: kind === "username" ? "conflictusername" : "Conflicting",
      },
    });
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(transport.requests).toHaveLength(2));
    const second = transport.requests[1]!;
    await act(async () => second.reject("Concurrent change", "CONFLICT"));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    transport.latest = {
      ...transport.latest,
      profileVersion: 99,
      updatedAt: new Date("2026-09-03T00:00:00Z"),
    };
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(transport.requests).toHaveLength(3));
    expect(transport.requests[2]!.input).toEqual(second.input);
    expect(transport.fetch).toHaveBeenCalledOnce();
    await act(async () =>
      transport.requests[2]!.reject("Concurrent change", "CONFLICT"),
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(field.value).toBe(
      kind === "username" ? "conflictusername" : "Conflicting",
    );
    expect(field.matches(":disabled")).toBe(false);
  },
);

it.each<Exclude<Kind, "username">>(["account", "tutor", "tutee"])(
  "preserves sibling %s drafts, focus, mounts and original fence during automatic refresh",
  async (kind) => {
    const { form } = mount(kind);
    const sibling = screen.getByLabelText<HTMLInputElement>(
      "Independent academic draft",
    );
    fireEvent.change(sibling, {
      target: { value: "Keep academic correction" },
    });
    fireEvent.submit(sibling.closest("form")!);
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    const academic = transport.requests[0]!;
    await act(async () => academic.reject("Academic correction failed"));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    let finish!: (value: unknown) => void;
    transport.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.submit(form);
    await waitFor(() => expect(transport.requests).toHaveLength(2));
    await act(async () => transport.requests[1]!.resolve());
    await waitFor(() => expect(transport.fetch).toHaveBeenCalledOnce());
    // Initial synchronization belongs to the admitted write, so sibling controls stay disabled.
    // The dialog remains the usable focus destination until that write lifecycle settles.
    expect(sibling.matches(":disabled")).toBe(true);
    const dialog = screen.getByRole("dialog");
    dialog.focus();
    await act(async () => finish(response(kind)));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByLabelText("Independent academic draft")).toBe(sibling);
    expect(sibling.value).toBe("Keep academic correction");
    expect(document.activeElement).toBe(dialog);
    sibling.focus();
    expect(document.activeElement).toBe(sibling);
    expect(screen.getByText("Academic correction failed")).toBeTruthy();
    fireEvent.submit(sibling.closest("form")!);
    await waitFor(() => expect(transport.requests).toHaveLength(3));
    expect(transport.requests[2]!.input).toEqual(academic.input);
    await act(async () =>
      transport.requests[2]!.reject("Academic correction failed"),
    );
  },
);

it("retains tutor sibling editors across automatic reactivation refresh and refreshed parent props", async () => {
  const archived = { ...original, status: "ARCHIVED", historicalGrade: true };
  const active = {
    ...transport.latest,
    status: "ACTIVE",
    historicalGrade: false,
  };
  const close = vi.fn();
  const content = (row: typeof archived | typeof active) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <TutorProfileEditor
          row={
            row as unknown as ComponentProps<typeof TutorProfileEditor>["row"]
          }
          onClose={close}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const view = render(content(archived));
  const historical = screen.getByLabelText<HTMLInputElement>(
    "Independent historical link draft",
  );
  const academic = screen.getByLabelText<HTMLInputElement>(
    "Independent academic draft",
  );
  fireEvent.change(historical, {
    target: { value: "Retain historical account preview" },
  });
  fireEvent.change(academic, {
    target: { value: "Retain academic correction" },
  });
  fireEvent.change(screen.getByLabelText(en.admin.tutors.colStatus), {
    target: { value: "ACTIVE" },
  });
  let finish!: (value: unknown) => void;
  transport.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.submit(currentField("tutor").closest("form")!);
  await waitFor(() => expect(transport.requests).toHaveLength(1));
  await act(async () => transport.requests[0]!.resolve());
  await waitFor(() => expect(transport.fetch).toHaveBeenCalledOnce());
  expect(transport.requests[0]!.input.status).toBe("ACTIVE");
  // The parent list can refresh while the profile owns its separate automatic read.
  view.rerender(content(active));
  expect(screen.getByLabelText("Independent historical link draft")).toBe(
    historical,
  );
  expect(screen.getByLabelText("Independent academic draft")).toBe(academic);
  await act(async () => finish([active]));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.getByLabelText("Independent historical link draft")).toBe(
    historical,
  );
  expect(screen.getByLabelText("Independent academic draft")).toBe(academic);
  expect(historical.value).toBe("Retain historical account preview");
  expect(academic.value).toBe("Retain academic correction");
  expect(
    screen.getByText(en.historicalAcademics.HISTORICAL_EDITOR_REQUIRED),
  ).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLSelectElement>(en.admin.tutors.colStatus).value,
  ).toBe("ACTIVE");
  expect(currentField("tutor").matches(":disabled")).toBe(false);
  expect(close).not.toHaveBeenCalled();
});
