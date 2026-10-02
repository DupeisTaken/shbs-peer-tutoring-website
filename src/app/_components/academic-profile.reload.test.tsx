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
import en from "../../../messages/en.json";
import { AcademicPanel } from "./academic-profile";
import { ProfileDialog } from "./profile-dialog";
import { useDialogBusy } from "./ui/modal";

const mock = vi.hoisted(() => ({
  academicRead: vi.fn(),
  policyRead: vi.fn(),
  save: vi.fn(),
  siblingSave: vi.fn(),
  throwAcademic: false,
  throwPolicy: false,
  syncAcademic: false,
  syncPolicy: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  const initialAcademic = {
    academic: {
      status: "REPORTED",
      gradeLevel: 9,
      schoolYear: "26-27",
      needsConfirmation: false,
    },
    profileVersion: 7,
    history: [],
  };
  const initialPolicy = {
    offeredGrades: [9, 10, 11],
    currentSchoolYear: "26-27",
  };
  // Installed React Query produces real error results retaining initial cached data.
  const academicQuery = (scope: string) => ({
    useQuery: (_input: unknown, options: { enabled: boolean }) => {
      const query = useQuery({
        queryKey: ["reload-academic", scope],
        queryFn: () => mock.academicRead() as Promise<typeof initialAcademic>,
        initialData: initialAcademic,
        staleTime: Infinity,
        retry: false,
        ...options,
      });
      return {
        ...query,
        refetch: () => {
          if (mock.syncAcademic) throw new Error("Synchronous read failure");
          return query.refetch({ throwOnError: mock.throwAcademic });
        },
      };
    },
  });
  const mutation = {
    useMutation: (options: { onSuccess: () => Promise<void> }) =>
      useMutation({
        mutationFn: async (input: unknown) =>
          mock.save(input) as Promise<unknown>,
        retry: false,
        ...options,
      }),
  };
  const invalidation = { invalidate: async () => undefined };
  return {
    api: {
      program: {
        profilePolicy: {
          useQuery: () => {
            const query = useQuery({
              queryKey: ["reload-policy"],
              queryFn: () => mock.policyRead() as Promise<typeof initialPolicy>,
              initialData: initialPolicy,
              staleTime: Infinity,
              retry: false,
            });
            return {
              ...query,
              refetch: () => {
                if (mock.syncPolicy)
                  throw new Error("Synchronous policy failure");
                return query.refetch({ throwOnError: mock.throwPolicy });
              },
            };
          },
        },
      },
      account: {
        me: academicQuery("self"),
        academicHistory: { useQuery: () => ({ data: [] }) },
        updateAcademics: mutation,
      },
      admin: {
        accountAcademics: academicQuery("staff"),
        updateAccountAcademics: mutation,
      },
      useUtils: () => ({
        account: { me: invalidation, academicHistory: invalidation },
        admin: {
          accountAcademics: invalidation,
          accounts: invalidation,
          tutors: invalidation,
          tutees: invalidation,
        },
        tutor: { me: invalidation, myProfile: invalidation },
        tutorDetails: invalidation,
        tuteeHistory: invalidation,
      }),
    },
  };
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
}
const freshAcademic = {
  academic: {
    status: "REPORTED",
    gradeLevel: 11,
    schoolYear: "27-28",
    needsConfirmation: false,
  },
  profileVersion: 8,
  history: [],
};
const freshPolicy = { offeredGrades: [11, 12], currentSchoolYear: "27-28" };
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  mock.throwAcademic = false;
  mock.throwPolicy = false;
  mock.syncAcademic = false;
  mock.syncPolicy = false;
  mock.academicRead.mockResolvedValue(freshAcademic);
  mock.policyRead.mockResolvedValue(freshPolicy);
  mock.save.mockRejectedValue(
    Object.assign(new Error("Changed since editing"), {
      data: { code: "CONFLICT" },
    }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function Sibling() {
  const busy = useDialogBusy();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) mock.siblingSave();
      }}
    >
      <fieldset disabled={busy}>
        <input aria-label="Profile note" defaultValue="Keep independent note" />
        <button disabled={busy}>Save profile</button>
      </fieldset>
    </form>
  );
}
async function openConflict() {
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <ProfileDialog title="Linked editor" onClose={close}>
          <Sibling />
          <AcademicPanel userId="linked" />
        </ProfileDialog>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: en.academics.edit }));
  const grade = screen.getByLabelText<HTMLSelectElement>(en.academics.grade),
    reason = screen.getByLabelText<HTMLTextAreaElement>(en.academics.reason);
  fireEvent.change(grade, { target: { value: "10" } });
  fireEvent.change(reason, {
    target: { value: "Keep original academic reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
  await screen.findByText(en.academics.conflict);
  const reload = screen.getByRole<HTMLButtonElement>("button", {
    name: en.academics.reload,
  });
  const sibling = screen.getByRole<HTMLButtonElement>("button", {
    name: "Save profile",
  });
  return { close, grade, reason, reload, sibling };
}
function expectDraft(ui: Awaited<ReturnType<typeof openConflict>>) {
  expect(screen.getByLabelText(en.academics.grade)).toBe(ui.grade);
  expect(ui.grade.value).toBe("10");
  expect(ui.reason.value).toBe("Keep original academic reason");
  expect(screen.getByLabelText<HTMLInputElement>("Profile note").value).toBe(
    "Keep independent note",
  );
  expect(screen.getByText(en.academics.conflict)).toBeTruthy();
}
async function expectDeliberateRecovery(
  ui: Awaited<ReturnType<typeof openConflict>>,
) {
  mock.throwAcademic = false;
  mock.throwPolicy = false;
  mock.syncAcademic = false;
  mock.syncPolicy = false;
  mock.academicRead.mockResolvedValue(freshAcademic);
  mock.policyRead.mockResolvedValue(freshPolicy);
  await waitFor(() => expect(ui.reload.disabled).toBe(false));
  fireEvent.click(ui.reload);
  await screen.findByRole("button", { name: en.academics.edit });
  expect(screen.queryByText(en.academics.reloadFailed)).toBeNull();
  expect(screen.queryByText(en.academics.conflict)).toBeNull();
  expect(ui.sibling.disabled).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Profile note").value).toBe(
    "Keep independent note",
  );
  fireEvent.click(screen.getByRole("button", { name: en.academics.edit }));
  expect(
    screen.getByLabelText<HTMLSelectElement>(en.academics.grade).value,
  ).toBe("11");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.academics.reason).value,
  ).toBe("");
  fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
  await waitFor(() =>
    expect(mock.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedProfileVersion: 8,
        expectedSchoolYear: "27-28",
        gradeLevel: 11,
      }),
    ),
  );
}

it.each([
  "academic-error",
  "policy-error",
  "thrown-academic",
  "thrown-policy",
  "sync-academic",
  "sync-policy",
])(
  "preserves cached-data draft/version/conflict after %s and permits deliberate recovery",
  async (failure) => {
    const ui = await openConflict();
    if (failure.includes("academic"))
      mock.academicRead.mockRejectedValue(new Error("Academic read failed"));
    else mock.policyRead.mockRejectedValue(new Error("Policy read failed"));
    mock.throwAcademic = failure === "thrown-academic";
    mock.throwPolicy = failure === "thrown-policy";
    mock.syncAcademic = failure === "sync-academic";
    mock.syncPolicy = failure === "sync-policy";
    fireEvent.click(ui.reload);
    await waitFor(() => expect(ui.sibling.disabled).toBe(false));
    expectDraft(ui);
    expect(screen.getByText(en.academics.reloadFailed)).toBeTruthy();
    expect(ui.reload.disabled).toBe(false);
    expect(mock.save).toHaveBeenCalledTimes(1);
    expect(mock.siblingSave).not.toHaveBeenCalled();
    if (!failure.startsWith("sync-")) {
      const state = client.getQueryState(
        failure.includes("academic")
          ? ["reload-academic", "staff"]
          : ["reload-policy"],
      );
      expect(state?.status).toBe("error");
      expect(state?.data).toBeTruthy();
    }
    // Retrying a save after failed reads still sends the original captured version/year.
    fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
    expect(mock.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedProfileVersion: 7,
        expectedSchoolYear: "26-27",
        gradeLevel: 10,
        reason: "Keep original academic reason",
      }),
    );
    await screen.findByText(en.academics.conflict);
    await expectDeliberateRecovery(ui);
  },
);

it("keeps the reload guard until the other required read settles after a thrown read", async () => {
  const ui = await openConflict(),
    policy = deferred();
  mock.throwAcademic = true;
  mock.academicRead.mockRejectedValue(new Error("Academic read failed"));
  mock.policyRead.mockReturnValue(policy.promise);
  fireEvent.click(ui.reload);
  await waitFor(() =>
    expect(client.getQueryState(["reload-academic", "staff"])?.status).toBe(
      "error",
    ),
  );
  expect(ui.sibling.disabled).toBe(true);
  expect(ui.reload.disabled).toBe(true);
  fireEvent.submit(ui.sibling.closest("form")!);
  const dialog = screen.getByRole("dialog");
  for (let attempt = 0; attempt < 3; attempt++)
    expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
  expect(ui.close).not.toHaveBeenCalled();
  expect(mock.siblingSave).not.toHaveBeenCalled();
  await act(async () => {
    policy.resolve(freshPolicy);
  });
  await waitFor(() => expect(ui.sibling.disabled).toBe(false));
  expectDraft(ui);
  expect(screen.getByText(en.academics.reloadFailed)).toBeTruthy();
});

it("discards the conflicting draft only after both successful reads finish", async () => {
  const ui = await openConflict(),
    academic = deferred(),
    policy = deferred();
  mock.academicRead.mockReturnValue(academic.promise);
  mock.policyRead.mockReturnValue(policy.promise);
  fireEvent.click(ui.reload);
  await waitFor(() => expect(ui.sibling.disabled).toBe(true));
  await act(async () => {
    academic.resolve(freshAcademic);
  });
  expectDraft(ui);
  expect(ui.sibling.disabled).toBe(true);
  expect(mock.save).toHaveBeenCalledTimes(1);
  await act(async () => {
    policy.resolve(freshPolicy);
  });
  await screen.findByRole("button", { name: en.academics.edit });
  expect(screen.queryByLabelText(en.academics.reason)).toBeNull();
  expect(ui.sibling.disabled).toBe(false);
  expect(ui.close).not.toHaveBeenCalled();
  expect(mock.save).toHaveBeenCalledTimes(1);
});

it("waits for academic data when the settings read throws synchronously", async () => {
  const ui = await openConflict(),
    academic = deferred();
  mock.academicRead.mockReturnValue(academic.promise);
  mock.syncPolicy = true;
  fireEvent.click(ui.reload);
  await waitFor(() => expect(mock.academicRead).toHaveBeenCalledTimes(1));
  expect(ui.sibling.disabled).toBe(true);
  expect(ui.reload.disabled).toBe(true);
  expectDraft(ui);
  await act(async () => {
    academic.resolve(freshAcademic);
  });
  await waitFor(() => expect(ui.sibling.disabled).toBe(false));
  expectDraft(ui);
  expect(screen.getByText(en.academics.reloadFailed)).toBeTruthy();
  expect(mock.save).toHaveBeenCalledTimes(1);
});
