/** @vitest-environment jsdom */
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
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AccountProfileEditor } from "./account-profile-editor";
import { MembershipEditor } from "./membership-editor";
import { SchoolDeparturePanel } from "./school-departure";
import { ProfileDialog } from "./profile-dialog";
import type { AccountMembership } from "~/lib/account-membership";

type Operation =
  | "profile"
  | "username"
  | "academic"
  | "membership"
  | "requestMembership"
  | "transfer"
  | "departure"
  | "requestDeparture";
type Failure = {
  message: string;
  data?: { code?: string; approvalId?: string };
};
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
  revision: 2,
  role: "HEAD",
  invalidate: vi.fn(async (): Promise<void> => {}),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./management-actions", () => ({ ManagementActions: () => null }));
// Only transport/query state is mocked: parent, nested dialogs and all profile sections are real imports.
vi.mock("~/trpc/react", () => {
  const mutation = (operation: Operation) => ({
    useMutation: (callbacks: Callbacks = {}) => {
      state.callbacks[operation] = callbacks;
      state.mutations[operation] ??= vi.fn();
      return {
        mutate: state.mutations[operation],
        isPending: !!state.pending[operation],
        error: state.errors[operation] ?? null,
        reset: vi.fn(),
      };
    },
  });
  const invalidator = { invalidate: async () => undefined };
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
        profileVersion: 7,
        history: [],
        role: state.role,
      },
    }),
  };
  return {
    api: {
      useUtils: () => ({
        invalidate: state.invalidate,
        admin: {
          accounts: invalidator,
          tutors: invalidator,
          tutees: invalidator,
          accountAcademics: invalidator,
        },
        account: { me: invalidator, academicHistory: invalidator },
        tutor: { me: invalidator, myProfile: invalidator },
        tutorDetails: invalidator,
        tuteeHistory: invalidator,
      }),
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: {
              requireLatinNames: false,
              offeredGrades: [10],
              currentSchoolYear: "26-27",
            },
          }),
        },
      },
      admin: {
        updateAccountProfile: mutation("profile"),
        updateAccountUsername: mutation("username"),
        updateAccountAcademics: mutation("academic"),
        accountAcademics: academicQuery,
        setMemberships: mutation("membership"),
        transferHead: mutation("transfer"),
      },
      account: {
        me: academicQuery,
        academicHistory: { useQuery: () => ({ data: [] }) },
        updateAcademics: mutation("academic"),
        requestMemberships: mutation("requestMembership"),
      },
      departure: {
        state: {
          useQuery: () => ({
            data: {
              departure: {
                reason: null,
                revision: state.revision,
                observerRevoked: false,
              },
              role: state.role,
              access: { canReadManagement: true },
              events: [],
            },
          }),
        },
        setState: mutation("departure"),
        request: mutation("requestDeparture"),
      },
    },
  };
});
const membership: AccountMembership = {
  rank: "ADMIN",
  tutor: true,
  tutee: false,
  viewer: false,
  crew: false,
  translator: false,
};
const close = vi.fn();
type Mode = "account" | "membershipRequest" | "departureRequest";
function ui(locale: "en" | "zh" = "en", mode: Mode = "account") {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      {mode === "account" ? (
        <AccountProfileEditor
          onClose={close}
          isHead
          membership={membership}
          profile={{
            userId: "account",
            name: "Original Person",
            firstName: "Original",
            lastName: "Person",
            alternativeNames: null,
            username: "original",
            profileVersion: 7,
          }}
        />
      ) : (
        <ProfileDialog title="Self service" onClose={close}>
          {mode === "membershipRequest" ? (
            <MembershipEditor
              userId="account"
              initial={membership}
              selfService
            />
          ) : (
            <SchoolDeparturePanel />
          )}
        </ProfileDialog>
      )}
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  state.pending = {};
  state.errors = {};
  state.callbacks = {};
  state.mutations = {};
  state.revision = 2;
  state.role = "HEAD";
  state.invalidate.mockReset().mockResolvedValue(undefined);
  close.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
function blockedDialogs() {
  for (const dialog of screen.getAllByRole("dialog")) {
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
  }
  expect(close).not.toHaveBeenCalled();
}
async function fail(operation: Operation, message = "Write failed") {
  const error = { message };
  state.errors[operation] = error;
  state.pending[operation] = false;
  await act(async () => {
    await state.callbacks[operation]?.onError?.(error);
    await state.callbacks[operation]?.onSettled?.();
  });
}

it.each(["en", "zh"] as const)(
  "registers real %s membership writes, freezes the parent, and retries the retained draft",
  async (locale) => {
    const labels = locale === "en" ? en : zh;
    const view = render(ui(locale));
    const password = screen.getByLabelText<HTMLInputElement>(
      labels.membership.password,
    );
    const firstName = screen.getByLabelText<HTMLInputElement>(
      new RegExp(labels.personName.firstName),
    );
    fireEvent.change(firstName, { target: { value: "Retained parent" } });
    fireEvent.click(screen.getByLabelText(labels.membership.translator));
    fireEvent.change(password, { target: { value: "Synthetic-password" } });
    const save = screen.getByRole("button", { name: labels.membership.save });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(state.mutations.membership).toHaveBeenCalledOnce();
    const submitted = state.mutations.membership!.mock.calls[0]![0];
    state.pending.membership = true;
    view.rerender(ui(locale));
    blockedDialogs();
    expect(password.disabled).toBe(true);
    expect(firstName.matches(":disabled")).toBe(true);
    fireEvent.submit(firstName.closest("form")!);
    expect(state.mutations.profile).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText(labels.schoolDeparture.reason).matches(":disabled"),
    ).toBe(true);
    await fail("membership");
    view.rerender(ui(locale));
    expect(password.value).toBe("Synthetic-password");
    expect(firstName.value).toBe("Retained parent");
    expect(
      screen.getByLabelText<HTMLInputElement>(labels.membership.translator)
        .checked,
    ).toBe(true);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    fireEvent.click(save);
    expect(state.mutations.membership).toHaveBeenCalledTimes(2);
    expect(state.mutations.membership!.mock.calls[1]![0]).toEqual(submitted);
  },
);

it("keeps leadership review cancellable, then prevents cross-action submission during the real transfer", async () => {
  const view = render(ui());
  fireEvent.change(screen.getByLabelText(en.membership.password), {
    target: { value: "Synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.membership.makeHead }));
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
  expect(state.mutations.transfer).not.toHaveBeenCalled();
  // Opening and cancelling the review must not acquire an owned-write registration.
  fireEvent.click(screen.getByRole("button", { name: en.membership.makeHead }));
  expect(
    screen.queryByRole("button", { name: en.membership.confirmTransfer }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.membership.makeHead }));
  const confirm = screen.getByRole("button", {
    name: en.membership.confirmTransfer,
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  fireEvent.click(screen.getByRole("button", { name: en.membership.save }));
  expect(state.mutations.transfer).toHaveBeenCalledOnce();
  expect(state.mutations.membership).not.toHaveBeenCalled();
  state.pending.transfer = true;
  view.rerender(ui());
  blockedDialogs();
  await fail("transfer");
  view.rerender(ui());
  expect(
    screen.getByLabelText<HTMLInputElement>(en.membership.password).value,
  ).toBe("Synthetic-password");
  fireEvent.click(confirm);
  expect(state.mutations.transfer).toHaveBeenCalledTimes(2);
});

it("registers self-service membership requests without treating queued intent as a grant", async () => {
  const view = render(ui("en", "membershipRequest"));
  fireEvent.click(screen.getByLabelText(en.membership.translator));
  const request = screen.getByRole("button", { name: en.membership.request });
  fireEvent.click(request);
  fireEvent.click(request);
  expect(state.mutations.requestMembership).toHaveBeenCalledOnce();
  state.pending.requestMembership = true;
  view.rerender(ui("en", "membershipRequest"));
  blockedDialogs();
  await act(async () => {
    await state.callbacks.requestMembership?.onSuccess?.();
  });
  state.pending.requestMembership = false;
  state.callbacks.requestMembership?.onSettled?.();
  view.rerender(ui("en", "membershipRequest"));
  expect(screen.getByRole("status").textContent).toBe(en.membership.requested);
  expect(
    screen.getByLabelText<HTMLInputElement>(en.membership.translator).checked,
  ).toBe(true);
  expect(state.mutations.membership).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
});

it.each(["en", "zh"] as const)(
  "retains the real nested %s departure review and original revision through failure and retry",
  async (locale) => {
    const labels = locale === "en" ? en : zh;
    const view = render(ui(locale));
    const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: labels.schoolDeparture.reason,
    });
    fireEvent.change(reason, { target: { value: "Reviewed departure draft" } });
    const review = screen.getByRole("button", {
      name: labels.schoolDeparture.review,
    });
    review.focus();
    fireEvent.click(review);
    let nested = screen.getByRole("dialog", {
      name: labels.schoolDeparture.review,
    });
    expect(nested.getAttribute("aria-busy")).toBe("false");
    fireEvent(nested, new Event("cancel", { cancelable: true }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(review);
    expect(state.mutations.departure).not.toHaveBeenCalled();
    fireEvent.click(review);
    nested = screen.getByRole("dialog", {
      name: labels.schoolDeparture.review,
    });
    state.revision = 3;
    view.rerender(ui(locale));
    const confirm = within(nested).getByRole("button", {
      name: labels.schoolDeparture.confirm,
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(state.mutations.departure).toHaveBeenCalledOnce();
    expect(state.mutations.departure).toHaveBeenLastCalledWith({
      action: "TRANSFERRED",
      expectedRevision: 2,
      explanation: "Reviewed departure draft",
      userId: "account",
    });
    state.pending.departure = true;
    view.rerender(ui(locale));
    blockedDialogs();
    expect(
      screen.getByLabelText(labels.membership.password).matches(":disabled"),
    ).toBe(true);
    await fail("departure");
    view.rerender(ui(locale));
    expect(within(nested).getByRole("alert").textContent).toBe("Write failed");
    expect(reason.value).toBe("Reviewed departure draft");
    fireEvent.click(confirm);
    expect(state.mutations.departure).toHaveBeenCalledTimes(2);
    expect(state.mutations.departure!.mock.calls[1]![0]).toEqual(
      state.mutations.departure!.mock.calls[0]![0],
    );
    state.pending.departure = true;
    view.rerender(ui(locale));
    let finishRefresh!: () => void;
    state.invalidate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      }),
    );
    let completion: unknown;
    await act(async () => {
      completion = state.callbacks.departure?.onSuccess?.();
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    await act(async () => {
      finishRefresh();
      await completion;
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    state.pending.departure = false;
    state.callbacks.departure?.onSettled?.();
    view.rerender(ui(locale));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(reason.value).toBe("");
    expect(screen.getByText(labels.schoolDeparture.saved)).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
  },
);

it("retains queued departure evidence and closes review only after the actual write settles", async () => {
  state.role = "COORDINATOR";
  const view = render(ui());
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.schoolDeparture.reason,
  });
  fireEvent.change(reason, { target: { value: "Queued departure evidence" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolDeparture.request }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolDeparture.confirm }),
  );
  state.pending.departure = true;
  view.rerender(ui());
  const error = { message: "Queued", data: { approvalId: "approval" } };
  state.errors.departure = error;
  await act(async () => {
    await state.callbacks.departure?.onError?.(error);
  });
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  state.pending.departure = false;
  state.callbacks.departure?.onSettled?.();
  view.rerender(ui());
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(reason.value).toBe("Queued departure evidence");
  expect(screen.getByText(en.schoolDeparture.requested)).toBeTruthy();
  expect(screen.queryByText(en.schoolDeparture.saved)).toBeNull();
  // Reopening queued evidence keeps its original revision even after a query refresh.
  state.revision = 3;
  view.rerender(ui());
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolDeparture.request }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolDeparture.confirm }),
  );
  expect(state.mutations.departure).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: 2 }),
  );
});

it("registers the real self-service departure request without granting departure locally", async () => {
  state.role = "STUDENT";
  const view = render(ui("en", "departureRequest"));
  fireEvent.change(
    screen.getByRole("textbox", { name: en.schoolDeparture.reason }),
    { target: { value: "Self-service departure review" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolDeparture.request }),
  );
  const confirm = screen.getByRole("button", {
    name: en.schoolDeparture.confirm,
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(state.mutations.requestDeparture).toHaveBeenCalledOnce();
  expect(state.mutations.departure).not.toHaveBeenCalled();
  state.pending.requestDeparture = true;
  view.rerender(ui("en", "departureRequest"));
  blockedDialogs();
  await fail("requestDeparture");
  view.rerender(ui("en", "departureRequest"));
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  fireEvent.click(confirm);
  expect(state.mutations.requestDeparture).toHaveBeenCalledTimes(2);
});
