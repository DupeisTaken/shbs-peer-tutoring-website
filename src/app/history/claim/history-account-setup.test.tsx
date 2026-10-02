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
  complete: vi.fn(),
  sent: undefined as (() => void) | undefined,
  verified: undefined as
    ((data: { completionProof: string }) => void) | undefined,
  done: undefined as (() => void) | undefined,
  pending: false,
  error: null as null | { message: string },
  success: false,
}));
vi.mock("~/app/_components/tutee-history", () => ({
  HistoryError: ({ message }: { message: string }) => (
    <p role="alert">{message}</p>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    tuteeHistory: {
      startAccount: {
        useMutation: (options: { onSuccess: () => void }) => {
          hooks.sent = options.onSuccess;
          return {
            mutate: hooks.send,
            reset: vi.fn(),
            isPending: hooks.pending,
          };
        },
      },
      verifyAccount: {
        useMutation: (options: {
          onSuccess: (value: { completionProof: string }) => void;
        }) => {
          hooks.verified = options.onSuccess;
          return { mutate: hooks.verify, reset: vi.fn() };
        },
      },
      completeAccount: {
        useMutation: (options: { onSuccess: () => void }) => {
          hooks.done = options.onSuccess;
          return {
            mutate: hooks.complete,
            reset: vi.fn(),
            error: hooks.error,
            isSuccess: hooks.success,
          };
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
  hooks.success = false;
});
afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "requires explicit email proof and confirmation with translated fields in %s",
  (locale) => {
    const messages = (locale === "en" ? en : zh).tuteeHistory;
    const { container } = render(view(locale));
    container.querySelector("details")!.open = true;
    expect(hooks.send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(new RegExp(messages.email)), {
      target: { value: "alumni@example.test" },
    });
    fireEvent.submit(container.querySelector("form")!);
    expect(hooks.send).toHaveBeenCalledWith({
      token,
      email: "alumni@example.test",
    });
    act(() => hooks.sent!());
    fireEvent.change(screen.getByLabelText(new RegExp(messages.emailCode)), {
      target: { value: "ABC12" },
    });
    fireEvent.submit(container.querySelector("form")!);
    expect(hooks.verify).toHaveBeenCalledWith({
      token,
      email: "alumni@example.test",
      code: "ABC12",
    });
    act(() => hooks.verified!({ completionProof: "b".repeat(64) }));
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.createAccount,
      }).disabled,
    ).toBe(true);
    fireEvent.change(
      screen.getByLabelText((text) => text.startsWith(messages.newPassword)),
      { target: { value: "Personal-password!" } },
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(container.querySelector("form")!);
    expect(hooks.complete).toHaveBeenCalledWith({
      token,
      email: "alumni@example.test",
      password: "Personal-password!",
      completionProof: "b".repeat(64),
    });
  },
);

it("retains a password draft after failure, blocks pending requests and keeps the exact claim on successful setup", () => {
  const { container, rerender } = render(view());
  container.querySelector("details")!.open = true;
  act(() => {
    hooks.sent!();
    hooks.verified!({ completionProof: "b".repeat(64) });
  });
  fireEvent.change(
    screen.getByLabelText((text) =>
      text.startsWith(en.tuteeHistory.newPassword),
    ),
    { target: { value: "Personal-password!" } },
  );
  hooks.error = { message: "HISTORY_STALE" };
  rerender(view());
  expect(screen.getByRole("alert").textContent).toBe("HISTORY_STALE");
  expect(
    screen.getByLabelText<HTMLInputElement>((text) =>
      text.startsWith(en.tuteeHistory.newPassword),
    ).value,
  ).toBe("Personal-password!");
  hooks.pending = true;
  rerender(view());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.tuteeHistory.createAccount,
    }).disabled,
  ).toBe(true);
  expect(screen.getByRole("status")).toBeTruthy();
  hooks.pending = false;
  hooks.success = true;
  act(() => hooks.done!());
  rerender(view());
  const url = new URL(
    screen
      .getByRole("link", { name: en.tuteeHistory.signIn })
      .getAttribute("href")!,
    "https://example.test",
  );
  expect(url.searchParams.get("callbackUrl")).toBe(
    `/history/claim?token=${token}`,
  );
  expect(container.querySelector("input[type=password]")).toBeNull();
});

it("does not offer setup for malformed invitations", () => {
  const { container } = render(view("en", "bad-token"));
  expect(screen.getByRole("alert").textContent).toBe(
    "HISTORY_INVITATION_INVALID",
  );
  expect(container.querySelector("form")).toBeNull();
});
