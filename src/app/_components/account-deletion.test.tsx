/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { AccountDeletion } from "./account-deletion";

const state = vi.hoisted(() => ({
  data: undefined as
    | undefined
    | {
        target: { id: string; name: string; email: string; username: string };
        fingerprint: string;
        blockers: string[];
        removed: Record<string, number>;
        retained: Record<string, number>;
      },
  error: null as null | { message: string; data?: { code: string } },
  fetching: false,
  refetch: vi.fn(),
  refresh: vi.fn(),
  mutate:
    vi.fn<
      (input: {
        userId: string;
        fingerprint: string;
        confirmPassword: string;
      }) => void
    >(),
  close: vi.fn(),
  recovery: vi.fn(),
  options: vi.fn(),
  callbacks: undefined as
    | undefined
    | {
        onSuccess: (
          result: unknown,
          input: {
            userId: string;
            fingerprint: string;
            confirmPassword: string;
          },
        ) => Promise<void>;
        onError: (error: { message: string; data?: { code: string } }) => void;
        onSettled: () => void;
      },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { accounts: { invalidate: state.refresh } } }),
    admin: {
      previewDeleteUser: {
        useQuery: (_input: unknown, options: unknown) => {
          state.options(options);
          return {
            data: state.data,
            error: state.error,
            isFetching: state.fetching,
            refetch: state.refetch,
          };
        },
      },
      deleteUser: {
        useMutation: (callbacks: typeof state.callbacks) => {
          state.callbacks = callbacks;
          return { mutate: state.mutate, isPending: false };
        },
      },
    },
  },
}));
const preview = () => ({
  target: {
    id: "login",
    name: "Casey Brook",
    email: "casey@example.test",
    username: "casey",
  },
  fingerprint: "reviewed",
  blockers: [],
  removed: { emails: 1, academicProfiles: 1 },
  retained: { messages: 2, sessionNotices: 0 },
});
function Controller() {
  const [target, setTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  return (
    <>
      <button onClick={() => setTarget({ id: "login", name: "Casey Brook" })}>
        Delete Casey
      </button>
      <button onClick={() => setTarget({ id: "second", name: "Drew Vale" })}>
        Delete Drew
      </button>
      <AccountDeletion
        target={target}
        onRecoveryChange={state.recovery}
        onClose={() => {
          state.close();
          setTarget(null);
        }}
        onDeleted={() => setTarget(null)}
      />
    </>
  );
}
const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Controller />
    </NextIntlClientProvider>,
  );
const open = () => {
  const button = screen.getByRole("button", { name: "Delete Casey" });
  button.focus();
  fireEvent.click(button);
  return button;
};
const password = () =>
  screen.getByLabelText<HTMLInputElement>(
    messages.admin.users.confirm.passwordLabel,
  );
const submit = () => {
  fireEvent.change(password(), { target: { value: "synthetic password" } });
  fireEvent.submit(password().closest("form")!);
};
beforeEach(() => {
  vi.clearAllMocks();
  state.data = preview();
  state.error = null;
  state.fetching = false;
  state.refresh.mockResolvedValue(undefined);
  state.refetch.mockImplementation(async () => ({
    data: state.data,
    error: state.error,
  }));
});
afterEach(cleanup);

it("shows retained essential scheduling evidence and blocks deletion with the scheduling-history explanation", () => {
  state.data = {
    ...preview(),
    retained: { messages: 2, sessionNotices: 3 },
    blockers: ["schedulingHistory"],
  };
  mount();
  open();
  expect(
    screen.getByText(messages.accountDeletion.counts.sessionNotices),
  ).toBeTruthy();
  expect(
    screen.getByText(messages.accountDeletion.blockers.schedulingHistory),
  ).toBeTruthy();
  // Native fieldset disabled state is inherited; input.disabled only reports
  // the input's own attribute and remains false for this composition.
  expect(password().matches(":disabled")).toBe(true);
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
});
it("reads a fresh review on every opening and restores the exact opener on idle Escape", async () => {
  mount();
  const opener = open();
  expect(state.options).toHaveBeenLastCalledWith(
    expect.objectContaining({
      enabled: true,
      staleTime: 0,
      refetchOnMount: "always",
    }),
  );
  expect(screen.getByText("Current academic profile")).toBeTruthy();
  expect(document.activeElement).toBe(password());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Delete",
    }).disabled,
  ).toBe(true);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  await waitFor(() => expect(document.activeElement).toBe(opener));
  open();
  expect(password().value).toBe("");
  expect(state.mutate).not.toHaveBeenCalled();
});

it.each([false, true])(
  "handles delayed initial review without stealing explored focus=%s",
  async (explored) => {
    state.data = undefined;
    state.fetching = true;
    const view = mount();
    open();
    expect(screen.getByText(messages.accountDeletion.loading)).toBeTruthy();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    if (explored) fireEvent.keyDown(cancel, { key: "Tab" });
    state.data = preview();
    state.fetching = false;
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Controller />
      </NextIntlClientProvider>,
    );
    expect(document.activeElement).toBe(explored ? cancel : password());
  },
);

it("admits one same-turn submission and guards cancel/reload before pending renders", () => {
  mount();
  open();
  const cancel = screen.getByRole("button", { name: "Cancel" });
  fireEvent.change(password(), { target: { value: "synthetic password" } });
  const form = password().closest("form")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.click(cancel);
  });
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith({
    userId: "login",
    fingerprint: "reviewed",
    confirmPassword: "synthetic password",
  });
  expect(state.close).not.toHaveBeenCalled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  act(() => {
    state.callbacks!.onError({ message: "Password rejected" });
    state.callbacks!.onSettled();
  });
  expect(password().value).toBe("synthetic password");
  expect(password().matches(":disabled")).toBe(false);
  expect(screen.getByRole("alert").textContent).toBe("Password rejected");
});

it("requires explicit review reload after conflict and keeps cached consequences after read failure", async () => {
  const view = mount();
  open();
  submit();
  act(() => {
    state.callbacks!.onError({
      message: "Changed",
      data: { code: "CONFLICT" },
    });
    state.callbacks!.onSettled();
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Delete",
    }).disabled,
  ).toBe(true);
  state.error = { message: "Network unavailable" };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Controller />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("Current academic profile")).toBeTruthy();
  expect(password().value).toBe("synthetic password");
  state.error = null;
  state.data = { ...preview(), fingerprint: "new-review" };
  await act(async () => {
    fireEvent.click(
      screen.getAllByRole("button", {
        name: messages.accountDeletion.reload,
      })[0]!,
    );
  });
  expect(password().value).toBe("");
  submit();
  expect(state.mutate).toHaveBeenLastCalledWith({
    userId: "login",
    fingerprint: "new-review",
    confirmPassword: "synthetic password",
  });
});

it("conceals denied evidence through a later transport failure and restores it only on explicit successful read", async () => {
  const view = mount();
  open();
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Controller />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByText("casey@example.test · @casey")).toBeNull();
  state.error = { message: "Network unavailable" };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Controller />
    </NextIntlClientProvider>,
  );
  expect(
    screen.queryByLabelText(messages.admin.users.confirm.passwordLabel),
  ).toBeNull();
  state.error = null;
  state.data = { ...preview(), fingerprint: "automatic-new-data" };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Controller />
    </NextIntlClientProvider>,
  );
  expect(
    screen.queryByLabelText(messages.admin.users.confirm.passwordLabel),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: messages.accountDeletion.reload }),
  ).toBeTruthy();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: messages.accountDeletion.reload }),
    );
  });
  expect(password()).toBeTruthy();
});

it("shows retained ownership blockers and never admits password confirmation", () => {
  state.data = { ...preview(), blockers: ["studentHistory"] };
  mount();
  open();
  expect(screen.getByRole("alert").textContent).toContain(
    messages.accountDeletion.blockers.studentHistory,
  );
  expect(password().matches(":disabled")).toBe(true);
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
});

it("retains accepted deletion recovery after row/dialog removal and retries reads without replay", async () => {
  mount();
  open();
  state.refresh.mockRejectedValue(new Error("Read failed"));
  submit();
  await act(async () => {
    await state.callbacks!.onSuccess({}, state.mutate.mock.calls.at(-1)![0]);
    state.callbacks!.onSettled();
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByText(messages.accountDeletion.savedRefreshFailed),
  ).toBeTruthy();
  expect(state.recovery).toHaveBeenLastCalledWith(true);
  state.refresh.mockResolvedValue(undefined);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: messages.accountDeletion.retryList }),
    );
  });
  expect(state.recovery).toHaveBeenLastCalledWith(false);
  expect(state.mutate).toHaveBeenCalledOnce();
  expect(
    screen.queryByText(messages.accountDeletion.savedRefreshFailed),
  ).toBeNull();
});
