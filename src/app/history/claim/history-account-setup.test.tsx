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
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { HistoryAccountSetup } from "./history-account-setup";
const hooks = vi.hoisted(() => ({
  send: vi.fn(),
  verify: vi.fn(),
  sent: undefined as (() => void) | undefined,
  verified: undefined as ((data: { invitationId: string }) => void) | undefined,
  settled: undefined as (() => void) | undefined,
  pending: false,
  error: null as null | { message: string },
}));
vi.mock("~/app/_components/tutee-history", () => ({
  HistoryError: ({ message }: { message: string }) => (
    <p role="alert">{message}</p>
  ),
}));
vi.mock("../../register/invitation-redemption", () => ({
  InvitationRedemption: ({ invitationId }: { invitationId: string }) => (
    <p>Shared invitation {invitationId}</p>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    tuteeHistory: {
      startAccount: {
        useMutation: (options: {
          onSuccess: () => void;
          onSettled: () => void;
        }) => {
          hooks.sent = options.onSuccess;
          hooks.settled = options.onSettled;
          return {
            mutate: hooks.send,
            reset: vi.fn(),
            isPending: hooks.pending,
            error: hooks.error,
          };
        },
      },
      verifyAccount: {
        useMutation: (options: {
          onSuccess: (data: { invitationId: string }) => void;
        }) => {
          hooks.verified = options.onSuccess;
          return { mutate: hooks.verify, reset: vi.fn() };
        },
      },
    },
  },
}));
const token = "a".repeat(64);
function view(locale: "en" | "zh" = "en", invitation = token) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <HistoryAccountSetup token={invitation} />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  hooks.pending = false;
  hooks.error = null;
});
afterEach(cleanup);
it.each(["en", "zh"] as const)(
  "verifies mailbox then enters the shared invitation without claiming history in %s",
  (locale) => {
    const messages = (locale === "en" ? en : zh).tuteeHistory;
    const { container } = render(view(locale));
    container.querySelector("details")!.open = true;
    expect(hooks.send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(new RegExp(messages.email)), {
      target: { value: "alumni@example.test" },
    });
    fireEvent.submit(container.querySelector("form")!);
    fireEvent.submit(container.querySelector("form")!);
    expect(hooks.send).toHaveBeenCalledTimes(1);
    expect(hooks.send).toHaveBeenCalledWith({
      token,
      email: "alumni@example.test",
    });
    act(() => {
      hooks.sent!();
      hooks.settled!();
    });
    fireEvent.change(screen.getByLabelText(new RegExp(messages.emailCode)), {
      target: { value: "ABC12" },
    });
    fireEvent.submit(container.querySelector("form")!);
    expect(hooks.verify).toHaveBeenCalledWith({
      token,
      email: "alumni@example.test",
      code: "ABC12",
    });
    act(() => hooks.verified!({ invitationId: "history-invitation" }));
    expect(
      screen.getByText("Shared invitation history-invitation"),
    ).toBeTruthy();
    expect(container.querySelector("input[type=password]")).toBeNull();
  },
);
it("retains email after failure, freezes pending fields and supports going back from code", () => {
  const { container, rerender } = render(view());
  container.querySelector("details")!.open = true;
  const email = screen.getByLabelText<HTMLInputElement>(
    new RegExp(en.tuteeHistory.email),
  );
  fireEvent.change(email, { target: { value: "alumni@example.test" } });
  hooks.error = { message: "HISTORY_STALE" };
  rerender(view());
  expect(screen.getByRole("alert").textContent).toBe("HISTORY_STALE");
  expect(email.value).toBe("alumni@example.test");
  hooks.pending = true;
  rerender(view());
  expect(email.closest("fieldset")!.disabled).toBe(true);
  hooks.pending = false;
  hooks.error = null;
  act(() => hooks.sent!());
  rerender(view());
  expect(email.readOnly).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: en.accountInvitation.back }),
  );
  expect(email.readOnly).toBe(false);
  expect(email.value).toBe("alumni@example.test");
  expect(
    screen.queryByLabelText(new RegExp(en.tuteeHistory.emailCode)),
  ).toBeNull();
});
it("does not offer setup for malformed invitations", () => {
  const { container } = render(view("en", "bad-token"));
  expect(screen.getByRole("alert").textContent).toBe(
    "HISTORY_INVITATION_INVALID",
  );
  expect(container.querySelector("form")).toBeNull();
});
