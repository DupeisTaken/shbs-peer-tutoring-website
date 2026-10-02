/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import { AccountProfileEditor } from "./account-profile-editor";
import { TutorProfileEditor } from "./tutor-profile-editor";
import { TuteeEditor } from "./tutee-editor";
import { useDialogPending } from "./ui/modal";

const state = vi.hoisted(() => ({
  pending: false,
  childPending: false,
  error: null as { message: string } | null,
  subjects: [] as unknown[] | undefined,
  slots: [] as unknown[] | undefined,
  subjectError: null as { message: string } | null,
  slotError: null as { message: string } | null,
  mutate: vi.fn(),
  retrySubjects: vi.fn(),
  retrySlots: vi.fn(),
  success: () => Promise.resolve(),
  settled: (): void => undefined,
}));

vi.mock("~/trpc/react", () => {
  const useMutation = (options: {
    onSuccess: () => Promise<void>;
    onSettled: () => void;
  }) => {
    state.success = options.onSuccess;
    state.settled = options.onSettled;
    return {
      mutate: state.mutate,
      isPending: state.pending,
      error: state.error,
    };
  };
  const invalidation = { invalidate: () => Promise.resolve() };
  return {
    api: {
      useUtils: () => ({
        admin: {
          accounts: invalidation,
          tutors: invalidation,
          tutees: invalidation,
          pairings: invalidation,
          tuteeStats: invalidation,
        },
        account: { me: invalidation },
        tuteeHistory: invalidation,
        student: invalidation,
      }),
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: { offeredGrades: [10], currentSchoolYear: "26-27" },
          }),
        },
      },
      admin: {
        updateAccountProfile: { useMutation },
        updateTutor: { useMutation },
        updateTutee: { useMutation },
        subjects: {
          useQuery: () => ({
            data: state.subjects,
            error: state.subjectError,
            refetch: state.retrySubjects,
          }),
        },
        timeSlots: {
          useQuery: () => ({
            data: state.slots,
            error: state.slotError,
            refetch: state.retrySlots,
          }),
        },
      },
    },
  };
});
vi.mock("./academic-profile", () => ({
  AcademicPanel: () => {
    const busy = useDialogPending(state.childPending);
    return <input aria-label="Independent academic draft" disabled={busy} />;
  },
}));
vi.mock("./school-departure", () => ({ SchoolDeparturePanel: () => null }));

beforeEach(() => {
  state.pending = false;
  state.childPending = false;
  state.error = null;
  state.subjects = [];
  state.slots = [];
  state.subjectError = null;
  state.slotError = null;
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);

const row = {
  id: "person",
  firstName: "Original",
  lastName: "Person",
  englishName: "Original Person",
  preferredName: null,
  alternativeNames: null,
  gradeLevel: null,
  status: "ACTIVE",
  historical: false,
  updatedAt: new Date("2026-09-01"),
  user: { id: "account", email: "person@example.test" },
  availabilities: [],
};
type Kind = "account" | "tutor" | "tutee";
function editor(kind: Kind, close: () => void) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      {kind === "account" ? (
        <AccountProfileEditor
          onClose={close}
          profile={{
            ...row,
            name: row.englishName,
            userId: "account",
            profileVersion: 7,
          }}
        />
      ) : kind === "tutor" ? (
        <TutorProfileEditor
          onClose={close}
          row={
            row as unknown as ComponentProps<typeof TutorProfileEditor>["row"]
          }
        />
      ) : (
        <TuteeEditor
          onClose={close}
          row={row as unknown as ComponentProps<typeof TuteeEditor>["row"]}
        />
      )}
    </NextIntlClientProvider>
  );
}

it.each<Kind>(["account", "tutor", "tutee"])(
  "freezes the %s submitted draft and dismissal, then restores the failed draft",
  (kind) => {
    const close = vi.fn();
    const view = render(editor(kind, close));
    const name = screen.getByLabelText<HTMLInputElement>("First Name Required");
    fireEvent.change(name, { target: { value: "Corrected" } });
    const submit = screen.getByRole("button", {
      name: kind === "tutee" ? "Save Details" : "Save profile",
    });
    fireEvent.click(submit);
    // A second event can arrive before React renders mutation.isPending.
    fireEvent.click(submit);
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
      firstName: "Corrected",
    });
    if (kind === "account")
      expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
        expectedProfileVersion: 7,
      });
    else
      expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
        expectedUpdatedAt: row.updatedAt,
        email: "person@example.test",
      });
    state.pending = true;
    view.rerender(editor(kind, close));
    expect(name.matches(":disabled")).toBe(true);
    expect(
      screen.getByLabelText<HTMLInputElement>("Independent academic draft")
        .disabled,
    ).toBe(true);
    const closeButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Close",
    });
    expect(closeButton.disabled).toBe(true);
    fireEvent.click(closeButton);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(close).not.toHaveBeenCalled();
    state.pending = false;
    state.error = { message: "Save failed" };
    state.settled();
    view.rerender(editor(kind, close));
    expect(name.matches(":disabled")).toBe(false);
    expect(name.value).toBe("Corrected");
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(submit);
    expect(state.mutate).toHaveBeenCalledTimes(2);
  },
);

it.each<Kind>(["account", "tutor", "tutee"])(
  "protects the %s parent while an independent section saves",
  (kind) => {
    const close = vi.fn();
    const view = render(editor(kind, close));
    state.childPending = true;
    view.rerender(editor(kind, close));
    expect(
      screen.getByLabelText("First Name Required").matches(":disabled"),
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled,
    ).toBe(true);
    state.childPending = false;
    view.rerender(editor(kind, close));
    expect(
      screen.getByLabelText("First Name Required").matches(":disabled"),
    ).toBe(false);
  },
);

it("closes the account profile only after successful invalidation", async () => {
  const close = vi.fn();
  render(editor("account", close));
  await act(() => state.success());
  expect(close).toHaveBeenCalledOnce();
});

it.each(["subjects", "slots"] as const)(
  "shows a retryable %s dependency failure instead of a blank editor",
  async (dependency) => {
    state[dependency] = undefined;
    if (dependency === "subjects") state.subjectError = { message: "offline" };
    else state.slotError = { message: "offline" };
    const view = render(editor("tutee", vi.fn()));
    expect(screen.getByRole("alert").textContent).toContain(
      en.uiPatterns.loadFailed,
    );
    expect(screen.queryByLabelText("First Name Required")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    expect(state.retrySubjects).toHaveBeenCalledOnce();
    expect(state.retrySlots).toHaveBeenCalledOnce();
    state.subjects = [];
    state.slots = [];
    state.subjectError = null;
    state.slotError = null;
    view.rerender(editor("tutee", vi.fn()));
    expect(screen.getByLabelText("First Name Required")).toBeTruthy();
  },
);

it("keeps an edited tutee draft visible during a failed dependency refresh", () => {
  const close = vi.fn();
  const view = render(editor("tutee", close));
  fireEvent.change(screen.getByLabelText("First Name Required"), {
    target: { value: "Unsaved" },
  });
  state.subjectError = { message: "offline" };
  view.rerender(editor("tutee", close));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>("First Name Required").value,
  ).toBe("Unsaved");
});
