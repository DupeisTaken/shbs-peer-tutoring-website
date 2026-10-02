/** @vitest-environment jsdom */
// Actual historical tutee composition; transport state is controlled independently below.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { TuteeEditor } from "./tutee-editor";
import { AcademicPanel } from "./academic-profile";

type Operation =
  "profile" | "selfAcademic" | "staffAcademic" | "link" | "invite";
type Failure = { message: string; data?: { code?: string } };
type Callbacks = {
  onSuccess?: () => unknown;
  onError?: (error: Failure) => unknown;
  onSettled?: () => unknown;
};
const state = vi.hoisted(() => ({
  pending: {} as Partial<Record<Operation, boolean>>,
  errors: {} as Partial<Record<Operation, Failure>>,
  callbacks: {} as Partial<Record<Operation, Callbacks>>,
  mutations: {} as Partial<Record<Operation, ReturnType<typeof vi.fn>>>,
  version: 7,
  updatedAt: new Date("2024-10-01T00:00:00Z"),
  preview: vi.fn(),
  refetch: vi.fn(),
  refetchPolicy: vi.fn(),
  invalidate: vi.fn(async (): Promise<void> => {}),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The complete historical tutee editor and its academic/link sections are real imports.
vi.mock("~/trpc/react", () => {
  const mutation = (operation: Operation) => ({
    useMutation: (callbacks: Callbacks = {}) => {
      state.callbacks[operation] = callbacks;
      state.mutations[operation] ??= vi.fn();
      return {
        mutate: state.mutations[operation],
        isPending: !!state.pending[operation],
        error: state.errors[operation],
        reset: vi.fn(),
      };
    },
  });
  const invalidator = { invalidate: state.invalidate };
  const academic = {
    status: "REPORTED",
    gradeLevel: 10,
    rawGrade: null,
    schoolYear: "26-27",
    confirmedAt: null,
    needsConfirmation: false,
    expectedGraduationYear: 2029,
  };
  const academicQuery = {
    useQuery: () => ({
      data: { academic, profileVersion: state.version, history: [] },
      refetch: state.refetch,
    }),
  };
  return {
    api: {
      useUtils: () => ({
        admin: {
          accounts: invalidator,
          tutors: invalidator,
          tutees: invalidator,
          pairings: invalidator,
          tuteeStats: invalidator,
          accountAcademics: invalidator,
        },
        account: { me: invalidator, academicHistory: invalidator },
        tutor: { me: invalidator, myProfile: invalidator },
        tutorDetails: invalidator,
        student: invalidator,
        tuteeHistory: { ...invalidator, preview: { fetch: state.preview } },
      }),
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: { offeredGrades: [10, 11], currentSchoolYear: "26-27" },
            refetch: state.refetchPolicy,
          }),
        },
      },
      account: {
        me: academicQuery,
        academicHistory: { useQuery: () => ({ data: [] }) },
        updateAcademics: mutation("selfAcademic"),
      },
      admin: {
        accountAcademics: academicQuery,
        updateAccountAcademics: mutation("staffAcademic"),
        updateTutee: mutation("profile"),
        subjects: { useQuery: () => ({ data: [] }) },
        timeSlots: { useQuery: () => ({ data: [] }) },
      },
      tuteeHistory: {
        candidates: {
          useQuery: () => ({
            data: [
              {
                id: "account",
                name: "Verified Person",
                email: "person@example.test",
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
const close = vi.fn();
function ui(locale: "en" | "zh" = "en", linked = true) {
  const row = {
    id: "record",
    firstName: "Original",
    lastName: "Person",
    englishName: "Original Person",
    preferredName: null,
    alternativeNames: null,
    gradeLevel: null,
    status: "INACTIVE",
    historical: true,
    updatedAt: state.updatedAt,
    owner: null,
    user: linked ? { id: "account", email: "person@example.test" } : null,
    availabilities: [],
  } as unknown as ComponentProps<typeof TuteeEditor>["row"];
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      <TuteeEditor
        row={row}
        onClose={close}
        historyPermissions={{ canLink: true, isHead: true }}
      />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  state.pending = {};
  state.errors = {};
  state.callbacks = {};
  state.mutations = {};
  state.version = 7;
  state.updatedAt = new Date("2024-10-01T00:00:00Z");
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.preview.mockReset().mockResolvedValue({
    fingerprint: "a".repeat(64),
    record: { name: "Original Person", sessions: 6 },
    account: { name: "Verified Person", email: "person@example.test" },
    conflict: false,
    currentConflict: false,
  });
  state.refetch.mockReset().mockResolvedValue({ isSuccess: true, data: {} });
  state.refetchPolicy
    .mockReset()
    .mockResolvedValue({ isSuccess: true, data: {} });
  close.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
const labelsFor = (locale: "en" | "zh") => (locale === "en" ? en : zh);
function openHistory(locale: "en" | "zh") {
  screen
    .getByText(labelsFor(locale).tuteeHistory.linkTitle)
    .closest("details")!.open = true;
}
function blocked() {
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(dialog.getAttribute("closedby")).toBe("none");
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: /^(Close|关闭)$/,
    }).disabled,
  ).toBe(true);
  for (let count = 0; count < 3; count++)
    expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(close).not.toHaveBeenCalled();
}
async function fail(operation: Operation) {
  const error = { message: "Write failed", data: { code: "CONFLICT" } };
  state.errors[operation] = error;
  await act(async () => {
    await state.callbacks[operation]?.onError?.(error);
    await state.callbacks[operation]?.onSettled?.();
  });
  state.pending[operation] = false;
}
it.each(["en", "zh"] as const)(
  "registers real %s academics inside the historical tutee editor and retains the original failed version",
  async (locale) => {
    const labels = labelsFor(locale);
    const view = render(ui(locale));
    openHistory(locale);
    fireEvent.click(
      screen.getByRole("button", { name: labels.academics.edit }),
    );
    const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: labels.academics.reason,
    });
    fireEvent.change(reason, {
      target: { value: "Independent current academic draft" },
    });
    state.version = 8;
    view.rerender(ui(locale));
    const form = reason.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(state.mutations.staffAcademic).toHaveBeenCalledOnce();
    expect(state.mutations.staffAcademic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedProfileVersion: 7,
        schoolYear: "26-27",
        reason: "Independent current academic draft",
        userId: "account",
      }),
    );
    state.pending.staffAcademic = true;
    view.rerender(ui(locale));
    blocked();
    const firstName = screen.getByLabelText<HTMLInputElement>(
      new RegExp(labels.personName.firstName),
    );
    expect(firstName.matches(":disabled")).toBe(true);
    expect(
      screen.getByLabelText(labels.tuteeHistory.evidence).matches(":disabled"),
    ).toBe(true);
    fireEvent.submit(firstName.closest("form")!);
    expect(state.mutations.profile).not.toHaveBeenCalled();
    await fail("staffAcademic");
    view.rerender(ui(locale));
    expect(reason.value).toBe("Independent current academic draft");
    expect(reason.matches(":disabled")).toBe(false);
    fireEvent.submit(form);
    expect(state.mutations.staffAcademic).toHaveBeenCalledTimes(2);
    expect(state.mutations.staffAcademic!.mock.calls[1]![0]).toEqual(
      state.mutations.staffAcademic!.mock.calls[0]![0],
    );
  },
);
it("keeps academic reload guarded, excludes direct submit, and retains the draft when a read returns stale cached data with an error", async () => {
  const view = render(ui());
  fireEvent.click(screen.getByRole("button", { name: en.academics.edit }));
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.academics.reason,
  });
  fireEvent.change(reason, {
    target: { value: "Keep failed reload evidence" },
  });
  fireEvent.submit(reason.closest("form")!);
  await fail("staffAcademic");
  view.rerender(ui());
  let finish!: (value: unknown) => void;
  state.refetch.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.academics.reload }));
  expect(reason.matches(":disabled")).toBe(true);
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  blocked();
  fireEvent.submit(reason.closest("form")!);
  expect(state.mutations.staffAcademic).toHaveBeenCalledOnce();
  await act(async () => {
    finish({ isSuccess: false, data: { profileVersion: 99 } });
  });
  expect(reason.value).toBe("Keep failed reload evidence");
  expect(reason.matches(":disabled")).toBe(false);
  fireEvent.submit(reason.closest("form")!);
  expect(state.mutations.staffAcademic).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedProfileVersion: 7 }),
  );
});
it("disables a standalone academic form during Reload without requiring a dialog provider", async () => {
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <AcademicPanel userId="account" />
    </NextIntlClientProvider>
  );
  const view = render(tree());
  fireEvent.click(screen.getByRole("button", { name: en.academics.edit }));
  const reason = screen.getByLabelText<HTMLTextAreaElement>(
    en.academics.reason,
  );
  fireEvent.change(reason, {
    target: { value: "Standalone retained evidence" },
  });
  fireEvent.submit(reason.closest("form")!);
  await fail("staffAcademic");
  view.rerender(tree());
  let finish!: (value: unknown) => void;
  state.refetch.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.academics.reload }));
  expect(reason.matches(":disabled")).toBe(true);
  fireEvent.submit(reason.closest("form")!);
  expect(state.mutations.staffAcademic).toHaveBeenCalledOnce();
  await act(async () => {
    finish({ isSuccess: false, data: { profileVersion: 99 } });
  });
  expect(reason.value).toBe("Standalone retained evidence");
  expect(reason.matches(":disabled")).toBe(false);
  expect(screen.getByText(en.academics.reloadFailed)).toBeTruthy();
});
it.each(["en", "zh"] as const)(
  "registers real %s historical linking and requires a fresh review after failure",
  async (locale) => {
    const labels = labelsFor(locale);
    const view = render(ui(locale));
    openHistory(locale);
    fireEvent.change(screen.getByLabelText(labels.tuteeHistory.evidence), {
      target: { value: "Verified original enrollment evidence" },
    });
    fireEvent.change(screen.getByLabelText(labels.tuteeHistory.chooseAccount), {
      target: { value: "account" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: labels.tuteeHistory.preview }),
      );
    });
    fireEvent.click(screen.getByLabelText(labels.tuteeHistory.confirmIdentity));
    const link = screen.getByRole("button", { name: labels.tuteeHistory.link });
    fireEvent.click(link);
    fireEvent.click(link);
    expect(state.mutations.link).toHaveBeenCalledOnce();
    state.pending.link = true;
    view.rerender(ui(locale));
    blocked();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: labels.academics.edit,
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByLabelText(labels.tuteeHistory.evidence).matches(":disabled"),
    ).toBe(true);
    await fail("link");
    view.rerender(ui(locale));
    expect(
      screen.queryByRole("button", { name: labels.tuteeHistory.link }),
    ).toBeNull();
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: labels.tuteeHistory.evidence,
      }).value,
    ).toBe("Verified original enrollment evidence");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: labels.tuteeHistory.preview }),
      );
    });
    expect(
      screen.getByLabelText<HTMLInputElement>(
        labels.tuteeHistory.confirmIdentity,
      ).checked,
    ).toBe(false);
    fireEvent.click(screen.getByLabelText(labels.tuteeHistory.confirmIdentity));
    fireEvent.click(
      screen.getByRole("button", { name: labels.tuteeHistory.link }),
    );
    expect(state.mutations.link).toHaveBeenCalledTimes(2);
    state.pending.link = true;
    view.rerender(ui(locale));
    await act(async () => {
      await state.callbacks.link?.onSuccess?.();
    });
    expect(
      screen.getByText(labels.tuteeHistory.linkTitle).closest("details")!.open,
    ).toBe(true);
    state.pending.link = false;
    state.callbacks.link?.onSettled?.();
    view.rerender(ui(locale));
    expect(
      screen.getByText(labels.tuteeHistory.linkTitle).closest("details")!.open,
    ).toBe(false);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    expect(close).not.toHaveBeenCalled();
  },
);
it("freezes only local controls during preview reads and excludes link/invitation writes while the read is unresolved", async () => {
  render(ui("en", false));
  openHistory("en");
  fireEvent.change(screen.getByLabelText(en.tuteeHistory.evidence), {
    target: { value: "Original evidence while reviewing" },
  });
  const email = screen.getByLabelText<HTMLInputElement>(en.tuteeHistory.email);
  fireEvent.change(email, { target: { value: "invited@example.test" } });
  fireEvent.change(screen.getByLabelText(en.tuteeHistory.chooseAccount), {
    target: { value: "account" },
  });
  let finish!: (value: unknown) => void;
  state.preview.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.preview }),
  );
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
  expect(email.disabled).toBe(true);
  fireEvent.submit(email.closest("form")!);
  expect(state.mutations.invite).not.toHaveBeenCalled();
  await act(async () => {
    finish({
      fingerprint: "b".repeat(64),
      record: { name: "Original Person", sessions: 6 },
      account: { name: "Verified Person", email: "person@example.test" },
      conflict: false,
      currentConflict: false,
    });
  });
  expect(email.disabled).toBe(false);
});
it.each(["en", "zh"] as const)(
  "registers real %s invitation writes and retains original enrollment version across background refetch and failure",
  async (locale) => {
    const labels = labelsFor(locale);
    const view = render(ui(locale, false));
    openHistory(locale);
    fireEvent.change(screen.getByLabelText(labels.tuteeHistory.evidence), {
      target: { value: "Verified historical invitation evidence" },
    });
    const email = screen.getByLabelText<HTMLInputElement>(
      labels.tuteeHistory.email,
    );
    fireEvent.change(email, { target: { value: "invited@example.test" } });
    state.updatedAt = new Date("2026-10-02T00:00:00Z");
    view.rerender(ui(locale, false));
    fireEvent.submit(email.closest("form")!);
    fireEvent.submit(email.closest("form")!);
    expect(state.mutations.invite).toHaveBeenCalledOnce();
    expect(state.mutations.invite).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedUpdatedAt: new Date("2024-10-01T00:00:00Z"),
        email: "invited@example.test",
      }),
    );
    state.pending.invite = true;
    view.rerender(ui(locale, false));
    blocked();
    await fail("invite");
    view.rerender(ui(locale, false));
    expect(email.value).toBe("invited@example.test");
    fireEvent.submit(email.closest("form")!);
    expect(state.mutations.invite).toHaveBeenCalledTimes(2);
    expect(state.mutations.invite!.mock.calls[1]![0]).toEqual(
      state.mutations.invite!.mock.calls[0]![0],
    );
  },
);
