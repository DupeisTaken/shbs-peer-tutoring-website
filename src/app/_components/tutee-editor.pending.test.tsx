/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { useState, type ComponentProps } from "react";
import en from "../../../messages/en.json";
import { TuteeEditor } from "./tutee-editor";

const mock = vi.hoisted(() => ({
  save: vi.fn(),
  invite: vi.fn(),
  cancel: vi.fn(),
  link: vi.fn(),
  preview: vi.fn(),
  invalidate: vi.fn(),
  refreshTutees: vi.fn(),
  refreshTuteeStats: vi.fn(),
  refreshTutors: vi.fn(),
  academicSave: vi.fn(),
  selfAcademicSave: vi.fn(),
  academicRefetch: vi.fn(),
  routerRefresh: vi.fn(),
  academicVersion: 7,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.routerRefresh }),
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  const mutation = (fn: (input: unknown) => unknown) => ({
    // Real mutation state stays pending through asynchronous success callbacks.
    useMutation: (options: {
      onSuccess?: () => void | Promise<void>;
      onError?: (error: Error) => void;
    }) =>
      useMutation({
        mutationFn: async (input: unknown) => fn(input),
        retry: false,
        ...options,
      }),
  });
  const invalidation = { invalidate: mock.invalidate };
  return {
    api: {
      useUtils: () => ({
        admin: {
          tutees: { invalidate: mock.refreshTutees },
          tuteeStats: { invalidate: mock.refreshTuteeStats },
          pairings: invalidation,
          accounts: invalidation,
          tutors: { invalidate: mock.refreshTutors },
          accountAcademics: invalidation,
        },
        account: { me: invalidation, academicHistory: invalidation },
        tutor: { me: invalidation, myProfile: invalidation },
        tutorDetails: invalidation,
        student: invalidation,
        tuteeHistory: { ...invalidation, preview: { fetch: mock.preview } },
      }),
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: {
              offeredGrades: [9, 10],
              requireLatinNames: true,
              currentSchoolYear: "26-27",
            },
            refetch: mock.academicRefetch,
          }),
        },
      },
      admin: {
        updateTutee: mutation(mock.save),
        subjects: { useQuery: () => ({ data: [] }) },
        timeSlots: { useQuery: () => ({ data: [] }) },
        accountAcademics: {
          useQuery: () => ({
            data: {
              academic: {
                status: "REPORTED",
                gradeLevel: 9,
                schoolYear: "26-27",
                needsConfirmation: false,
              },
              profileVersion: mock.academicVersion,
              history: [],
            },
            refetch: mock.academicRefetch,
          }),
        },
        updateAccountAcademics: mutation(mock.academicSave),
      },
      account: {
        me: { useQuery: () => ({}) },
        academicHistory: { useQuery: () => ({ data: [] }) },
        updateAcademics: mutation(mock.selfAcademicSave),
      },
      tuteeHistory: {
        invite: mutation(mock.invite),
        cancelInvitation: mutation(mock.cancel),
        link: mutation(mock.link),
        invitationStatus: {
          useQuery: () => ({
            data: {
              email: "alumni@example.test",
              expiresAt: new Date("2026-10-09"),
              revision: "a".repeat(64),
            },
            refetch: mock.invalidate,
          }),
        },
        candidates: {
          useQuery: () => ({
            data: [
              {
                id: "owner",
                name: "Verified Alumnus",
                email: "alumni@example.test",
              },
            ],
          }),
        },
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
const row = {
  id: "archive",
  englishName: "Alex Lin",
  firstName: "Alex",
  lastName: "Lin",
  legacyName: "Alex Lin",
  gradeLevel: "9",
  status: "INACTIVE",
  historical: true,
  updatedAt: new Date("2024-10-01"),
  user: null,
  owner: null,
  availabilities: [],
  notes: "Original note",
} as unknown as ComponentProps<typeof TuteeEditor>["row"];
const preview = {
  fingerprint: "b".repeat(64),
  record: { name: "Alex Lin", sessions: 3 },
  account: { name: "Verified Alumnus" },
  conflict: false,
  currentConflict: false,
};
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  mock.academicVersion = 7;
  for (const mutation of [
    mock.save,
    mock.invite,
    mock.cancel,
    mock.link,
    mock.invalidate,
    mock.academicSave,
    mock.selfAcademicSave,
    mock.academicRefetch,
  ])
    mutation.mockResolvedValue({});
  mock.preview.mockResolvedValue(preview);
  for (const refresh of [
    mock.refreshTutees,
    mock.refreshTuteeStats,
    mock.refreshTutors,
  ])
    refresh.mockImplementation(() => mock.invalidate() as Promise<void>);
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function renderEditor(editorRow = row, unmountOnClose = false) {
  const close = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return open ? (
      <TuteeEditor
        row={editorRow}
        onClose={() => {
          close();
          if (unmountOnClose) setOpen(false);
        }}
        historyPermissions={{ canLink: true, isHead: false }}
      />
    ) : null;
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
function mount() {
  const close = renderEditor();
  fireEvent.click(
    screen.getByText(en.tuteeHistory.linkTitle, { selector: "summary" }),
  );
  const notes = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.profileCorrection.notes,
  });
  const evidence = screen.getByLabelText<HTMLTextAreaElement>(
    en.tuteeHistory.evidence,
  );
  const email = screen.getByLabelText<HTMLInputElement>(en.tuteeHistory.email);
  const save = screen.getByRole<HTMLButtonElement>("button", {
    name: en.profileCorrection.save,
  });
  const invite = screen.getByRole<HTMLButtonElement>("button", {
    name: en.tuteeHistory.sendInvitation,
  });
  fireEvent.change(notes, { target: { value: "Unsaved personal draft" } });
  fireEvent.change(evidence, {
    target: { value: "Exact archived identity evidence reviewed" },
  });
  fireEvent.change(email, { target: { value: "alumni@example.test" } });
  return {
    close,
    notes,
    evidence,
    email,
    save,
    invite,
    profileForm: save.closest("form")!,
    inviteForm: invite.closest("form")!,
  };
}
async function selectOwner() {
  fireEvent.change(
    screen.getByRole("combobox", { name: en.tuteeHistory.chooseAccount }),
    { target: { value: "owner" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.preview }),
  );
  const confirmation = await screen.findByRole("checkbox", {
    name: en.tuteeHistory.confirmIdentity,
  });
  fireEvent.click(confirmation);
}
async function flushMutationJobs() {
  // A direct submit can enqueue its mutation after the handler returns. Give an
  // accidentally admitted request a turn to run before asserting it was blocked.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it.each(["invite", "cancel", "link", "preview"] as const)(
  "blocks profile submission during %s and recovers both drafts after failure",
  async (operation) => {
    const ui = mount();
    if (operation === "link") await selectOwner();
    if (operation === "preview")
      fireEvent.change(
        screen.getByRole("combobox", { name: en.tuteeHistory.chooseAccount }),
        { target: { value: "owner" } },
      );
    const work = deferred();
    mock[operation].mockReturnValueOnce(work.promise);
    const names = {
      invite: en.tuteeHistory.sendInvitation,
      cancel: en.tuteeHistory.cancelInvitation,
      link: en.tuteeHistory.link,
      preview: en.tuteeHistory.preview,
    };
    fireEvent.click(screen.getByRole("button", { name: names[operation] }));
    await waitFor(() => expect(ui.save.disabled).toBe(true));
    expect(ui.notes.matches(":disabled")).toBe(true);
    expect(ui.evidence.matches(":disabled")).toBe(true);
    // Dispatch directly as well as checking disabled UI, covering the handler guard.
    fireEvent.submit(ui.profileForm);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    await flushMutationJobs();
    expect(mock.save).not.toHaveBeenCalled();
    expect(ui.close).not.toHaveBeenCalled();
    await act(async () => {
      work.reject(new Error("HISTORY_STALE"));
    });
    await waitFor(() => expect(ui.save.disabled).toBe(false));
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.accountProfile.close,
      }).disabled,
    ).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain(
      en.tuteeHistory.HISTORY_STALE,
    );
    expect(ui.notes.value).toBe("Unsaved personal draft");
    expect(ui.evidence.value).toBe("Exact archived identity evidence reviewed");
    expect(ui.email.value).toBe("alumni@example.test");
    expect(ui.invite.disabled).toBe(false);
    fireEvent.submit(ui.profileForm);
    await closeSavedEditor(ui.close);
    expect(mock.save).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Unsaved personal draft" }),
    );
  },
);

it("blocks every history write during profile save, then allows a failed save to be retried without latching", async () => {
  const ui = mount();
  await selectOwner();
  const work = deferred();
  mock.save.mockReturnValueOnce(work.promise);
  fireEvent.submit(ui.profileForm);
  await waitFor(() => expect(ui.invite.disabled).toBe(true));
  for (const name of [
    en.tuteeHistory.cancelInvitation,
    en.tuteeHistory.link,
    en.tuteeHistory.preview,
  ])
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name }).disabled,
    ).toBe(true);
  expect(ui.evidence.matches(":disabled")).toBe(true);
  expect(ui.email.matches(":disabled")).toBe(true);
  fireEvent.submit(ui.inviteForm);
  fireEvent.submit(ui.profileForm);
  await flushMutationJobs();
  expect(mock.invite).not.toHaveBeenCalled();
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(ui.close).not.toHaveBeenCalled();
  await act(async () => {
    work.reject(new Error("PROFILE_STALE"));
  });
  await waitFor(() => expect(ui.invite.disabled).toBe(false));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(false);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(ui.notes.value).toBe("Unsaved personal draft");
  expect(ui.evidence.value).toBe("Exact archived identity evidence reviewed");
  expect(ui.email.value).toBe("alumni@example.test");
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: en.tuteeHistory.confirmIdentity,
    }).checked,
  ).toBe(true);
  fireEvent.submit(ui.inviteForm);
  await screen.findByText(en.tuteeHistory.sent);
  await waitFor(() => expect(ui.save.disabled).toBe(false));
  expect(ui.close).not.toHaveBeenCalled();
  fireEvent.submit(ui.profileForm);
  await closeSavedEditor(ui.close);
});

it("keeps history unavailable through successful profile invalidation before deliberate Close", async () => {
  const ui = mount();
  const refresh = deferred();
  mock.invalidate.mockReturnValue(refresh.promise);
  fireEvent.submit(ui.profileForm);
  await waitFor(() => expect(mock.invalidate).toHaveBeenCalled());
  expect(ui.invite.disabled).toBe(true);
  fireEvent.submit(ui.inviteForm);
  await flushMutationJobs();
  expect(mock.invite).not.toHaveBeenCalled();
  expect(ui.close).not.toHaveBeenCalled();
  await act(async () => {
    refresh.resolve();
  });
  await closeSavedEditor(ui.close);
});

it.each(["invite", "cancel", "link"] as const)(
  "keeps the profile unavailable through successful %s refresh without latching",
  async (operation) => {
    const ui = mount();
    if (operation === "link") await selectOwner();
    const refresh = deferred();
    mock.invalidate.mockReturnValue(refresh.promise);
    const names = {
      invite: en.tuteeHistory.sendInvitation,
      cancel: en.tuteeHistory.cancelInvitation,
      link: en.tuteeHistory.link,
    };
    fireEvent.click(screen.getByRole("button", { name: names[operation] }));
    await waitFor(() => expect(mock.invalidate).toHaveBeenCalled());
    expect(ui.save.disabled).toBe(true);
    expect(ui.notes.matches(":disabled")).toBe(true);
    fireEvent.submit(ui.profileForm);
    await flushMutationJobs();
    expect(mock.save).not.toHaveBeenCalled();
    expect(ui.close).not.toHaveBeenCalled();
    await act(async () => {
      refresh.resolve();
    });
    await waitFor(() => expect(ui.save.disabled).toBe(false));
    expect(ui.notes.value).toBe("Unsaved personal draft");
    fireEvent.submit(ui.profileForm);
    await closeSavedEditor(ui.close);
  },
);

function mountLinked(unmountOnClose = false) {
  const close = renderEditor(
    {
      ...row,
      user: { id: "linked", email: "linked@example.test" },
    } as typeof row,
    unmountOnClose,
  );
  fireEvent.click(screen.getByRole("button", { name: en.academics.edit }));
  fireEvent.click(
    screen.getByText(en.tuteeHistory.linkTitle, { selector: "summary" }),
  );
  const notes = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.profileCorrection.notes,
  });
  const evidence = screen.getByLabelText<HTMLTextAreaElement>(
    en.tuteeHistory.evidence,
  );
  const reason = screen.getByLabelText<HTMLTextAreaElement>(
    en.academics.reason,
  );
  const grade = screen.getByRole<HTMLSelectElement>("combobox", {
    name: en.academics.grade,
  });
  const profileSave = screen.getByRole<HTMLButtonElement>("button", {
    name: en.profileCorrection.save,
  });
  const academicSave = screen.getByRole<HTMLButtonElement>("button", {
    name: en.academics.confirm,
  });
  fireEvent.change(notes, { target: { value: "Linked profile draft" } });
  fireEvent.change(evidence, {
    target: { value: "Verified retained enrollment identity" },
  });
  fireEvent.change(reason, { target: { value: "Independent academic draft" } });
  fireEvent.change(grade, { target: { value: "10" } });
  return {
    close,
    notes,
    evidence,
    reason,
    grade,
    profileSave,
    academicSave,
    profileForm: profileSave.closest("form")!,
    academicForm: academicSave.closest("form")!,
  };
}
function expectLinkedDrafts(ui: ReturnType<typeof mountLinked>) {
  expect(ui.notes.value).toBe("Linked profile draft");
  expect(ui.evidence.value).toBe("Verified retained enrollment identity");
  expect(ui.reason.value).toBe("Independent academic draft");
  expect(ui.grade.value).toBe("10");
}
function expectDismissalBlocked(close: ReturnType<typeof vi.fn>) {
  const dialog = screen.getByRole("dialog");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(true);
  for (let attempt = 0; attempt < 3; attempt++)
    expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(close).not.toHaveBeenCalled();
}

async function closeSavedEditor(close: ReturnType<typeof vi.fn>) {
  await screen.findByText(en.accountProfile.sectionSaved);
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: en.accountProfile.close,
  });
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
}

it("registers a linked academic save, blocks profile/history handlers and preserves independent versions on failure", async () => {
  const ui = mountLinked();
  await selectOwner();
  const work = deferred();
  mock.academicSave.mockReturnValueOnce(work.promise);
  fireEvent.submit(ui.academicForm);
  await waitFor(() => expect(ui.profileSave.disabled).toBe(true));
  expect(ui.notes.matches(":disabled")).toBe(true);
  expect(ui.evidence.matches(":disabled")).toBe(true);
  expectDismissalBlocked(ui.close);
  fireEvent.submit(ui.profileForm);
  fireEvent.submit(ui.academicForm);
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.link }));
  fireEvent.click(screen.getByRole("button", { name: en.academics.cancel }));
  await flushMutationJobs();
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.link).not.toHaveBeenCalled();
  expect(mock.academicSave).toHaveBeenCalledTimes(1);
  // A background account version change must not silently rebase this open draft.
  mock.academicVersion = 8;
  await act(async () => {
    work.reject(new Error("PROFILE_STALE"));
  });
  await waitFor(() => expect(ui.profileSave.disabled).toBe(false));
  expectLinkedDrafts(ui);
  fireEvent.submit(ui.academicForm);
  await screen.findByText(en.academics.saved);
  expect(mock.academicSave).toHaveBeenLastCalledWith(
    expect.objectContaining({
      userId: "linked",
      expectedProfileVersion: 7,
      expectedSchoolYear: "26-27",
      schoolYear: "26-27",
      gradeLevel: 10,
      reason: "Independent academic draft",
    }),
  );
  expect(mock.selfAcademicSave).not.toHaveBeenCalled();
  await waitFor(() => expect(ui.profileSave.disabled).toBe(false));
  expect(ui.notes.value).toBe("Linked profile draft");
  fireEvent.submit(ui.profileForm);
  await closeSavedEditor(ui.close);
  expect(mock.save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedUpdatedAt: row.updatedAt }),
  );
  expect(mock.save.mock.calls[0]![0]).not.toHaveProperty("gradeLevel");
  expect(mock.save.mock.calls[0]![0]).not.toHaveProperty(
    "academicallyGraduated",
  );
});

it("blocks linked academic submission during profile save and recovers every draft after failure", async () => {
  const ui = mountLinked();
  const work = deferred();
  mock.save.mockReturnValueOnce(work.promise);
  fireEvent.submit(ui.profileForm);
  await waitFor(() => expect(ui.academicSave.disabled).toBe(true));
  expect(ui.grade.matches(":disabled")).toBe(true);
  expectDismissalBlocked(ui.close);
  fireEvent.submit(ui.academicForm);
  fireEvent.submit(ui.profileForm);
  await flushMutationJobs();
  expect(mock.academicSave).not.toHaveBeenCalled();
  expect(mock.save).toHaveBeenCalledTimes(1);
  await act(async () => {
    work.reject(new Error("PROFILE_STALE"));
  });
  await waitFor(() => expect(ui.academicSave.disabled).toBe(false));
  expectLinkedDrafts(ui);
  fireEvent.submit(ui.academicForm);
  await screen.findByText(en.academics.saved);
  await waitFor(() => expect(ui.profileSave.disabled).toBe(false));
  fireEvent.submit(ui.profileForm);
  await closeSavedEditor(ui.close);
});

it("blocks linked academic submission during a historical link and restores it on failure", async () => {
  const ui = mountLinked();
  await selectOwner();
  const work = deferred();
  mock.link.mockReturnValueOnce(work.promise);
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.link }));
  await waitFor(() => expect(ui.academicSave.disabled).toBe(true));
  expectDismissalBlocked(ui.close);
  fireEvent.submit(ui.academicForm);
  fireEvent.submit(ui.profileForm);
  await flushMutationJobs();
  expect(mock.academicSave).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
  await act(async () => {
    work.reject(new Error("HISTORY_STALE"));
  });
  await waitFor(() => expect(ui.academicSave.disabled).toBe(false));
  expectLinkedDrafts(ui);
});

it.each(["academic", "profile", "history"] as const)(
  "guards all linked forms until %s refresh has settled",
  async (operation) => {
    const ui = mountLinked();
    if (operation === "history") await selectOwner();
    const refresh = deferred();
    mock.invalidate.mockReturnValue(refresh.promise);
    if (operation === "history")
      fireEvent.click(
        screen.getByRole("button", { name: en.tuteeHistory.link }),
      );
    else
      fireEvent.submit(
        operation === "academic" ? ui.academicForm : ui.profileForm,
      );
    await waitFor(() => expect(mock.invalidate).toHaveBeenCalled());
    expect(ui.academicSave.disabled).toBe(true);
    expect(ui.profileSave.disabled).toBe(true);
    expectDismissalBlocked(ui.close);
    const calls = [
      mock.save.mock.calls.length,
      mock.academicSave.mock.calls.length,
    ];
    fireEvent.submit(ui.academicForm);
    fireEvent.submit(ui.profileForm);
    await flushMutationJobs();
    expect([
      mock.save.mock.calls.length,
      mock.academicSave.mock.calls.length,
    ]).toEqual(calls);
    expectLinkedDrafts(ui);
    await act(async () => {
      refresh.resolve();
    });
    if (operation === "profile") await closeSavedEditor(ui.close);
    else {
      await waitFor(() => expect(ui.profileSave.disabled).toBe(false));
      expect(ui.close).not.toHaveBeenCalled();
      expect(ui.notes.value).toBe("Linked profile draft");
      if (operation === "academic")
        expect(mock.routerRefresh).toHaveBeenCalledOnce();
      else expectLinkedDrafts(ui);
    }
  },
);

it("keeps profile/history guarded during explicit academic conflict reload without discarding their drafts", async () => {
  const ui = mountLinked();
  mock.academicSave.mockRejectedValueOnce(
    Object.assign(new Error("Outdated academics"), {
      data: { code: "CONFLICT" },
    }),
  );
  fireEvent.submit(ui.academicForm);
  const reload = await screen.findByRole("button", {
    name: en.academics.reload,
  });
  const refetch = deferred();
  mock.academicRefetch.mockReturnValue(refetch.promise);
  fireEvent.click(reload);
  await waitFor(() => expect(ui.profileSave.disabled).toBe(true));
  expectDismissalBlocked(ui.close);
  fireEvent.submit(ui.profileForm);
  fireEvent.submit(ui.academicForm);
  await flushMutationJobs();
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.academicSave).toHaveBeenCalledTimes(1);
  await act(async () => {
    refetch.resolve({ data: {}, isSuccess: true });
  });
  await waitFor(() => expect(ui.profileSave.disabled).toBe(false));
  expect(ui.notes.value).toBe("Linked profile draft");
  expect(ui.evidence.value).toBe("Verified retained enrollment identity");
});

it("admits only one same-frame profile submission and releases its own guard after failure", async () => {
  const ui = mountLinked(true),
    first = deferred();
  mock.save.mockReturnValueOnce(first.promise);
  // Raw events in one batch reproduce the interval before isPending renders.
  act(() => {
    for (let attempt = 0; attempt < 2; attempt++)
      ui.profileForm.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
  });
  await flushMutationJobs();
  expect(mock.save).toHaveBeenCalledTimes(1);
  expectDismissalBlocked(ui.close);
  await act(async () => first.reject(new Error("PROFILE_STALE")));
  await waitFor(() => expect(ui.profileSave.disabled).toBe(false));
  expectLinkedDrafts(ui);
  fireEvent.submit(ui.profileForm);
  await closeSavedEditor(ui.close);
  expect(mock.save).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([
  ["academic", "profile-first", false],
  ["academic", "sibling-first", false],
  ["history", "profile-first", false],
  ["history", "sibling-first", false],
  ["academic", "profile-first", true],
  ["academic", "sibling-first", true],
  ["history", "profile-first", true],
  ["history", "sibling-first", true],
] as const)(
  "retains already-admitted %s work (%s, sibling failure %s) until deliberate Close",
  async (section, order, siblingFails) => {
    const ui = mountLinked(true),
      profile = deferred(),
      sibling = deferred();
    if (section === "history") await selectOwner();
    mock.save.mockReturnValueOnce(profile.promise);
    const siblingMutation =
      section === "academic" ? mock.academicSave : mock.link;
    siblingMutation.mockReturnValueOnce(sibling.promise);
    const siblingError =
      section === "academic"
        ? Object.assign(new Error("Outdated academics"), {
            data: { code: "CONFLICT" },
          })
        : new Error("HISTORY_STALE");
    const link =
      section === "history"
        ? screen.getByRole("button", { name: en.tuteeHistory.link })
        : null;
    // Both handlers have already admitted their work before the shared busy render.
    act(() => {
      ui.profileForm.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      if (section === "academic")
        ui.academicForm.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      else link!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(siblingMutation).toHaveBeenCalledOnce());
    expect(mock.save).toHaveBeenCalledOnce();
    expectDismissalBlocked(ui.close);
    const profileIsSettled = () =>
      client
        .getMutationCache()
        .getAll()
        .some((mutation) => {
          const variables = mutation.state.variables as
            { id?: string } | undefined;
          return (
            variables?.id === row.id && mutation.state.status === "success"
          );
        });
    if (order === "profile-first") {
      mock.academicVersion = 8;
      await act(async () => profile.resolve({}));
      await waitFor(() => expect(profileIsSettled()).toBe(true));
      expectLinkedDrafts(ui);
    } else {
      await act(async () => {
        if (siblingFails) sibling.reject(siblingError);
        else sibling.resolve({});
      });
      await waitFor(() => expect(client.isMutating()).toBe(1));
    }
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(ui.notes.isConnected).toBe(true);
    expect(ui.notes.value).toBe("Linked profile draft");
    expectDismissalBlocked(ui.close);
    fireEvent.submit(ui.profileForm);
    await flushMutationJobs();
    expect(mock.save).toHaveBeenCalledOnce();
    await act(async () => {
      if (order === "sibling-first") {
        mock.academicVersion = 8;
        profile.resolve({});
      } else if (siblingFails) sibling.reject(siblingError);
      else sibling.resolve({});
    });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    await screen.findByText(en.accountProfile.sectionSaved);
    expect(ui.close).not.toHaveBeenCalled();
    expect(ui.notes.isConnected).toBe(true);
    expect(ui.notes.matches(":disabled")).toBe(true);
    expect(ui.profileSave.disabled).toBe(true);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    fireEvent.submit(ui.profileForm);
    await flushMutationJobs();
    expect(mock.save).toHaveBeenCalledOnce();
    expect(mock.save.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        expectedUpdatedAt: row.updatedAt,
        notes: "Linked profile draft",
      }),
    );
    expect(mock.save.mock.calls[0]![0]).not.toHaveProperty("gradeLevel");
    if (siblingFails) {
      expectLinkedDrafts(ui);
      const errorText =
        section === "academic"
          ? en.academics.conflict
          : en.tuteeHistory.HISTORY_STALE;
      expect(screen.getByText(errorText)).toBeTruthy();
      const retry = deferred();
      siblingMutation.mockReturnValueOnce(retry.promise);
      if (section === "academic") {
        expect(ui.academicSave.disabled).toBe(false);
        fireEvent.submit(ui.academicForm);
      } else {
        // Failed linking discards the old preview/acknowledgement, not identity evidence.
        expect(
          screen.queryByRole("checkbox", {
            name: en.tuteeHistory.confirmIdentity,
          }),
        ).toBeNull();
        mock.preview.mockResolvedValueOnce({
          ...preview,
          fingerprint: "c".repeat(64),
        });
        await selectOwner();
        fireEvent.click(
          screen.getByRole("button", { name: en.tuteeHistory.link }),
        );
      }
      await waitFor(() => expect(siblingMutation).toHaveBeenCalledTimes(2));
      expectDismissalBlocked(ui.close);
      expect(siblingMutation).toHaveBeenLastCalledWith(
        expect.objectContaining(
          section === "academic"
            ? {
                expectedProfileVersion: 7,
                expectedSchoolYear: "26-27",
                gradeLevel: 10,
                reason: "Independent academic draft",
              }
            : {
                fingerprint: "c".repeat(64),
                reason: "Verified retained enrollment identity",
              },
        ),
      );
      await act(async () => retry.reject(siblingError));
      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(screen.getByText(errorText)).toBeTruthy();
      expectLinkedDrafts(ui);
      expect(mock.save).toHaveBeenCalledOnce();
    }
    await closeSavedEditor(ui.close);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("keeps a committed profile read-only after refresh fails without freezing sibling retry or Close", async () => {
  const ui = mountLinked(true);
  mock.invalidate.mockRejectedValue(new Error("Refresh unavailable"));
  fireEvent.submit(ui.profileForm);
  await screen.findByText(en.accountProfile.sectionRefreshFailed);
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.getByText(en.accountProfile.sectionSaved)).toBeTruthy();
  expect(ui.notes.matches(":disabled")).toBe(true);
  expect(ui.grade.matches(":disabled")).toBe(false);
  expectLinkedDrafts(ui);
  fireEvent.submit(ui.profileForm);
  await flushMutationJobs();
  expect(mock.save).toHaveBeenCalledOnce();
  await closeSavedEditor(ui.close);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["outer", "nested"] as const)(
  "holds the saved profile and dialog until the independent %s refresh settles after a read failure",
  async (group) => {
    const ui = mountLinked(true),
      held = deferred();
    mock.refreshTutees.mockRejectedValue(new Error("Roster refresh failed"));
    const delayed =
      group === "outer" ? mock.refreshTutors : mock.refreshTuteeStats;
    delayed.mockReturnValue(held.promise);
    fireEvent.submit(ui.profileForm);
    await screen.findByText(en.accountProfile.sectionSaved);
    await waitFor(() => expect(delayed).toHaveBeenCalledOnce());
    await flushMutationJobs();
    expectDismissalBlocked(ui.close);
    expect(
      screen.queryByText(en.accountProfile.sectionRefreshFailed),
    ).toBeNull();
    expectLinkedDrafts(ui);
    fireEvent.submit(ui.profileForm);
    fireEvent.submit(ui.academicForm);
    await flushMutationJobs();
    expect(mock.save).toHaveBeenCalledOnce();
    expect(mock.academicSave).not.toHaveBeenCalled();
    await act(async () => held.resolve());
    await screen.findByText(en.accountProfile.sectionRefreshFailed);
    await waitFor(() => expect(ui.academicSave.disabled).toBe(false));
    expect(ui.profileSave.disabled).toBe(true);
    expect(ui.notes.matches(":disabled")).toBe(true);
    expectLinkedDrafts(ui);
    await closeSavedEditor(ui.close);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it.each([
  ["academic", "profile-first"],
  ["academic", "sibling-first"],
  ["history", "profile-first"],
  ["history", "sibling-first"],
] as const)(
  "retains a failed profile beside successful %s work (%s) and permits its original-version retry",
  async (section, order) => {
    const ui = mountLinked(true),
      profile = deferred(),
      sibling = deferred();
    if (section === "history") await selectOwner();
    mock.save.mockReturnValueOnce(profile.promise);
    const siblingMutation =
      section === "academic" ? mock.academicSave : mock.link;
    siblingMutation.mockReturnValueOnce(sibling.promise);
    const link =
      section === "history"
        ? screen.getByRole("button", { name: en.tuteeHistory.link })
        : null;
    act(() => {
      ui.profileForm.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      if (section === "academic")
        ui.academicForm.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      else link!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(siblingMutation).toHaveBeenCalledOnce());
    expect(mock.save).toHaveBeenCalledOnce();
    await act(async () => {
      if (order === "profile-first") profile.reject(new Error("PROFILE_STALE"));
      else sibling.resolve({});
    });
    await waitFor(() => expect(client.isMutating()).toBe(1));
    expectDismissalBlocked(ui.close);
    expect(ui.notes.value).toBe("Linked profile draft");
    await act(async () => {
      if (order === "profile-first") sibling.resolve({});
      else profile.reject(new Error("PROFILE_STALE"));
    });
    await waitFor(() => expect(ui.profileSave.disabled).toBe(false));
    expect(ui.notes.isConnected).toBe(true);
    expect(ui.notes.value).toBe("Linked profile draft");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(en.accountProfile.sectionSaved)).toBeNull();
    expect(ui.close).not.toHaveBeenCalled();
    fireEvent.submit(ui.profileForm);
    await screen.findByText(en.accountProfile.sectionSaved);
    expect(mock.save).toHaveBeenCalledTimes(2);
    expect(mock.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedUpdatedAt: row.updatedAt,
        notes: "Linked profile draft",
      }),
    );
    await closeSavedEditor(ui.close);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);
