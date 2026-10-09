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
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { InvitationRedemption } from "./invitation-redemption";
import { RegisterFlow } from "./register-flow";

type MutationCallbacks = {
  onSuccess?: (data: unknown) => void;
  onSettled?: () => void;
};
const state = vi.hoisted(() => {
  const callbacks: Record<string, MutationCallbacks> = {};
  return {
    verify: vi.fn(),
    complete: vi.fn(),
    send: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    callbacks,
    pending: "",
    error: null as { message: string } | null,
    saved: false,
    readError: null as { message: string } | null,
    info: {
      kind: "TUTOR",
      email: "person@example.test",
      name: "Person One",
      firstName: "Person",
      lastName: "One",
      preferredName: "",
      alternativeNames: "",
      gradeLevel: 9,
      completed: false,
      existing: false,
      needsPassword: true,
      requiresSignIn: false,
      mfaRequired: false,
      completionProof: "a".repeat(64),
      academicConfirmationRequired: false,
      legacyName: null as string | null,
    },
  };
});
vi.mock("./actions", () => ({
  invitationSignIn: state.login,
  switchInvitationAccount: vi.fn(),
}));
vi.mock("~/trpc/react", () => {
  const mutation = (name: string, action: (...args: unknown[]) => unknown) => ({
    useMutation: (options: MutationCallbacks) => {
      state.callbacks[name] = options;
      return {
        mutate: action,
        reset: vi.fn(),
        isPending: state.pending === name,
        error: name === "complete" ? state.error : null,
        isSuccess: name === "complete" && state.saved,
      };
    },
  });
  return {
    api: {
      useUtils: () => ({
        accountInvitation: { inspect: { invalidate: state.refresh } },
      }),
      program: {
        profilePolicy: {
          useQuery: () => ({ data: { offeredGrades: [1, 9, 12] } }),
        },
      },
      accountInvitation: {
        verify: mutation("verify", state.verify),
        complete: mutation("complete", state.complete),
        inspect: {
          useQuery: (_input: unknown, options: { enabled: boolean }) => ({
            data: options.enabled ? state.info : undefined,
            isLoading: false,
            error: state.readError,
            refetch: state.refresh,
          }),
        },
      },
      registration: {
        check: mutation("check", vi.fn()),
        sendEmailCode: mutation("send", state.send),
      },
    },
  };
});
function view(locale: "en" | "zh" = "en", initial = false, signedIn = false) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      {initial ? (
        <RegisterFlow />
      ) : (
        <InvitationRedemption invitationId="invite" signedIn={signedIn} />
      )}
    </NextIntlClientProvider>
  );
}
async function verified() {
  await act(async () => {
    state.callbacks.verify!.onSuccess!({ proof: "a".repeat(64) });
    state.callbacks.verify!.onSettled?.();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.pending = "";
  state.error = null;
  state.readError = null;
  state.saved = false;
  Object.assign(state.info, {
    kind: "TUTOR",
    completed: false,
    academicConfirmationRequired: false,
    legacyName: null,
    existing: false,
    needsPassword: true,
    requiresSignIn: false,
    mfaRequired: false,
    name: "Person One",
    firstName: "Person",
    lastName: "One",
    preferredName: "",
    alternativeNames: "",
    gradeLevel: 9,
  });
  state.login.mockResolvedValue({ signedIn: true, mfaRequired: false });
  state.refresh.mockResolvedValue(undefined);
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["en", "zh"] as const)(
  "uses translated review, required fields and deliberate focus in %s",
  async (locale) => {
    const copy = (locale === "en" ? en : zh).accountInvitation;
    render(view(locale));
    expect(screen.getByRole("heading", { name: copy.enterCode })).toBeTruthy();
    expect(state.verify).not.toHaveBeenCalled();
    await verified();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: copy.reviewTitle }),
    );
    expect(screen.getByLabelText(new RegExp(`^${copy.password}`))).toBeTruthy();
    expect(
      screen.getByLabelText<HTMLInputElement>(
        new RegExp(`^${(locale === "en" ? en : zh).personName.firstName}`),
      ).value,
    ).toBe("Person");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: copy.accept })
        .disabled,
    ).toBe(true);
  },
);

it("verifies recipient email/code once even when two submits happen in the same turn", () => {
  const { container } = render(view());
  fireEvent.change(screen.getByLabelText(/^Invited email/), {
    target: { value: "person@example.test" },
  });
  fireEvent.change(screen.getByLabelText(/^Invitation code/), {
    target: { value: "ABC12" },
  });
  act(() => {
    fireEvent.submit(container.querySelector("form")!);
    fireEvent.submit(container.querySelector("form")!);
  });
  expect(state.verify).toHaveBeenCalledTimes(1);
  expect(state.verify).toHaveBeenCalledWith({
    invitationId: "invite",
    email: "person@example.test",
    code: "ABC12",
  });
});

it("requires matching passwords and review, freezes pending fields, and preserves a failed draft", async () => {
  const { container, rerender } = render(view());
  await verified();
  fireEvent.change(screen.getByLabelText(/^Create password/), {
    target: { value: "PersonalPassword!" },
  });
  fireEvent.change(screen.getByLabelText(/^Confirm password/), {
    target: { value: "DifferentPassword!" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(container.querySelector("form")!);
  expect(state.complete).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^Confirm password/), {
    target: { value: "PersonalPassword!" },
  });
  act(() => {
    fireEvent.submit(container.querySelector("form")!);
    fireEvent.submit(container.querySelector("form")!);
  });
  expect(state.complete).toHaveBeenCalledTimes(1);
  expect(state.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      proof: "a".repeat(64),
      reviewed: true,
      password: "PersonalPassword!",
    }),
  );
  state.pending = "complete";
  rerender(view());
  expect(container.querySelector("fieldset[disabled]")).not.toBeNull();
  state.pending = "";
  state.error = { message: "INVITATION_ACCOUNT_CHANGED" };
  act(() => state.callbacks.complete!.onSettled?.());
  rerender(view());
  expect(
    screen.getByLabelText<HTMLInputElement>(/^Create password/).value,
  ).toBe("PersonalPassword!");
  expect(screen.getByText(en.accountInvitation.accountChanged)).toBeTruthy();
});

it("respects clearing optional prefilled identity fields", async () => {
  Object.assign(state.info, {
    preferredName: "Old nickname",
    alternativeNames: "Old alias",
  });
  const { container } = render(view());
  await verified();
  fireEvent.change(screen.getByDisplayValue("Old nickname"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByDisplayValue("Old alias"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText(/^Create password/), {
    target: { value: "PersonalPassword!" },
  });
  fireEvent.change(screen.getByLabelText(/^Confirm password/), {
    target: { value: "PersonalPassword!" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(container.querySelector("form")!);
  expect(state.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      preferredName: "",
      alternativeNames: "",
      gradeLevel: null,
    }),
  );
});

it("existing accounts review access without password/name editors", async () => {
  Object.assign(state.info, { existing: true, needsPassword: false });
  const { container } = render(view());
  await verified();
  expect(container.querySelector("input[type=password]")).toBeNull();
  expect(container.querySelector("input[name=firstName]")).toBeNull();
  expect(screen.getByText(en.accountInvitation.preserveIdentity)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(container.querySelector("form")!);
  expect(state.complete.mock.calls[0]![0]).not.toHaveProperty("password");
});

it("a recovered saved receipt retains the required academic next step", () => {
  Object.assign(state.info, {
    completed: true,
    existing: true,
    needsPassword: false,
    academicConfirmationRequired: true,
  });
  render(view("en", false, true));
  expect(screen.getByText(en.academics.confirmationRequired)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.academics.review })
      .getAttribute("href"),
  ).toBe("/my-account");
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("navigating to a different invitation discards the prior proof, password and identity draft", async () => {
  const { rerender } = render(view());
  await verified();
  fireEvent.change(screen.getByLabelText(/^Create password/), {
    target: { value: "OldInvitationPassword!" },
  });
  rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <InvitationRedemption invitationId="different-invitation" />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole("heading", { name: en.accountInvitation.enterCode }),
  ).toBeTruthy();
  expect(screen.queryByLabelText(/^Create password/)).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>(/^Invited email/).value).toBe(
    "",
  );
  expect(state.complete).not.toHaveBeenCalled();
});

it("an existing account with missing identity can fill its name without replacing canonical academics", async () => {
  Object.assign(state.info, {
    existing: true,
    name: "",
    firstName: "",
    lastName: "",
    needsPassword: false,
  });
  render(view());
  await verified();
  expect(
    screen.getByLabelText(new RegExp(`^${en.personName.firstName}`)),
  ).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("shows the exact unsplit roster identity without guessing a first name", async () => {
  Object.assign(state.info, {
    name: "Historical Roster Label",
    legacyName: "Historical Roster Label",
    firstName: "",
    lastName: "",
  });
  render(view());
  await verified();
  expect(
    screen.getByText("Historical Roster Label", { exact: true }),
  ).toBeTruthy();
  const first = screen.getByLabelText<HTMLInputElement>(
    new RegExp(`^${en.personName.firstName}`),
  );
  expect(first.value).toBe("");
  expect(first.required).toBe(true);
});

it("an existing Viewer-request recipient continues after code sign-in without an access review", async () => {
  Object.assign(state.info, {
    kind: "LOGIN",
    existing: true,
    needsPassword: false,
  });
  state.login.mockResolvedValue({ signedIn: true, completedLogin: true });
  render(view());
  await verified();
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: en.accountInvitation.doneTitle }),
    ).toBeTruthy(),
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.accountInvitation.accept }),
  ).toBeNull();
  expect(state.complete).not.toHaveBeenCalled();
});

it.each([false, true])(
  "retains the draft read-only when preview recovery fails (signed-in resume=%s)",
  async (signedIn) => {
    const { container, rerender } = render(view("en", false, signedIn));
    if (!signedIn) await verified();
    fireEvent.change(screen.getByLabelText(/^Create password/), {
      target: { value: "RetainedPassword!" },
    });
    state.readError = { message: "INVITATION_ACCOUNT_CHANGED" };
    rerender(view("en", false, signedIn));
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    expect(
      screen.getByLabelText<HTMLInputElement>(/^Create password/).value,
    ).toBe("RetainedPassword!");
    fireEvent.submit(container.querySelector("form")!);
    expect(state.complete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: en.accountInvitation.retry }),
    );
    expect(state.refresh).toHaveBeenCalled();
  },
);

it("keeps the invitation return destination while enforced MFA is completed", async () => {
  Object.assign(state.info, {
    existing: true,
    needsPassword: false,
    requiresSignIn: true,
    mfaRequired: true,
  });
  state.login.mockResolvedValue({ signedIn: false, mfaRequired: true });
  render(view());
  await verified();
  expect(screen.getByText(en.accountInvitation.mfaRequired)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.accountInvitation.accept }),
  ).toBeNull();
  const link = new URL(
    screen
      .getByRole("link", { name: en.accountInvitation.signIn })
      .getAttribute("href")!,
    "https://example.test",
  );
  expect(link.searchParams.get("callbackUrl")).toBe(
    "/register?invitation=invite",
  );
});

it("offers an explicit account switch for a different signed-in account with enforced MFA", () => {
  Object.assign(state.info, {
    existing: true,
    needsPassword: false,
    requiresSignIn: true,
    mfaRequired: true,
  });
  render(view("en", false, true));
  expect(
    screen.getByRole("button", { name: en.accountInvitation.switchAccount }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.accountInvitation.accept }),
  ).toBeNull();
});

it("does not offer a disabled public invitation source", () => {
  render(view("en", true));
  expect(
    screen.queryByRole("link", { name: en.accountInvitation.requestCode }),
  ).toBeNull();
});

it("shows a saved write separately from failed sign-in and never offers resubmission", async () => {
  const { container, rerender } = render(view());
  await verified();
  state.saved = true;
  state.login.mockResolvedValue({ signedIn: false, mfaRequired: false });
  await act(async () => state.callbacks.complete!.onSuccess!({ ok: true }));
  rerender(view());
  await waitFor(() =>
    expect(
      screen.getByText(en.accountInvitation.savedLoginFailed),
    ).toBeTruthy(),
  );
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector("input[type=password]")).toBeNull();
});

it("staff-key navigation focuses its next heading and Back retains the key", async () => {
  render(view("en", true));
  const input = screen.getByLabelText(
    new RegExp(en.auth.register.step.code.label),
  );
  fireEvent.change(input, { target: { value: "ABC12" } });
  await act(async () => {
    state.callbacks.check!.onSuccess!({
      boundEmail: "person@example.test",
    });
    state.callbacks.check!.onSettled?.();
  });
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: en.accountInvitation.sendInvitation }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.accountInvitation.back }),
  );
  expect(
    screen.getByLabelText<HTMLInputElement>(
      new RegExp(en.auth.register.step.code.label),
    ).value,
  ).toBe("ABC12");
});
