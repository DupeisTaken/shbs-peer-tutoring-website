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
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import { TuteeEditor } from "./tutee-editor";

const mock = vi.hoisted(() => ({
  save: vi.fn(),
  invite: vi.fn(),
  cancel: vi.fn(),
  link: vi.fn(),
  preview: vi.fn(),
  invalidate: vi.fn(),
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
          tutees: invalidation,
          tuteeStats: invalidation,
          pairings: invalidation,
          accounts: invalidation,
          tutors: invalidation,
        },
        student: invalidation,
        tuteeHistory: { ...invalidation, preview: { fetch: mock.preview } },
      }),
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: {
              offeredGrades: [9],
              requireLatinNames: true,
              currentSchoolYear: "26-27",
            },
          }),
        },
      },
      admin: {
        updateTutee: mutation(mock.save),
        subjects: { useQuery: () => ({ data: [] }) },
        timeSlots: { useQuery: () => ({ data: [] }) },
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
  for (const mutation of [
    mock.save,
    mock.invite,
    mock.cancel,
    mock.link,
    mock.invalidate,
  ])
    mutation.mockResolvedValue({});
  mock.preview.mockResolvedValue(preview);
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function mount() {
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <TuteeEditor
          row={row}
          onClose={close}
          historyPermissions={{ canLink: true, isHead: false }}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
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
    await waitFor(() => expect(ui.close).toHaveBeenCalledOnce());
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
  await waitFor(() => expect(ui.close).toHaveBeenCalledOnce());
});

it("keeps history unavailable through successful profile invalidation before closing", async () => {
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
  await waitFor(() => expect(ui.close).toHaveBeenCalledOnce());
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
    await waitFor(() => expect(ui.close).toHaveBeenCalledOnce());
  },
);
