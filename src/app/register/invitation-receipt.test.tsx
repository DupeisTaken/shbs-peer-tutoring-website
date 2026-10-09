/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { InvitationReceipt } from "./invitation-receipt";

const state = vi.hoisted(() => ({
  remember: vi.fn(),
  send: vi.fn(),
  pending: false,
  settled: undefined as (() => void) | undefined,
  error: null as null | { message: string },
}));
vi.mock("./actions", () => ({ rememberInvitation: state.remember }));
vi.mock("~/trpc/react", () => ({
  api: {
    accountInvitation: {
      email: {
        useMutation: (options: { onSettled: () => void }) => {
          state.settled = options.onSettled;
          return {
            mutate: state.send,
            isPending: state.pending,
            isSuccess: false,
            error: state.error,
          };
        },
      },
    },
  },
}));
const invitation = {
  invitationId: "receipt123",
  code: "AB3D7",
  proof: "a".repeat(64),
  email: "verified@example.test",
};
const view = (locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
    <InvitationReceipt invitation={invitation} />
  </NextIntlClientProvider>
);
beforeEach(() => {
  state.remember.mockReset().mockResolvedValue(undefined);
  state.send.mockReset();
  state.pending = false;
  state.error = null;
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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);

it("admits one email write per click burst and allows retry after failure", async () => {
  const { rerender } = render(view());
  await screen.findByRole("link", {
    name: en.accountInvitation.continueSignup,
  });
  const send = screen.getByRole("button", {
    name: en.accountInvitation.emailCode,
  });
  fireEvent.click(send);
  fireEvent.click(send);
  expect(state.send).toHaveBeenCalledTimes(1);
  state.error = { message: "SIGNUP_MAIL_FAILED" };
  state.settled!();
  rerender(view());
  fireEvent.click(send);
  expect(state.send).toHaveBeenCalledTimes(2);
  expect(screen.getByText(invitation.code)).toBeTruthy();
});

it.each(["en", "zh"] as const)(
  "shows a retained %s popup with optional delivery and a code-only URL",
  async (locale) => {
    const t = (locale === "en" ? en : zh).accountInvitation;
    render(view(locale));
    expect(screen.getByRole("dialog", { name: t.receiptTitle })).toBeTruthy();
    const link = await screen.findByRole("link", { name: t.continueSignup });
    expect(link.getAttribute("href")).toBe(
      "/register?invitation=receipt123&code=AB3D7",
    );
    expect(link.getAttribute("href")).not.toContain(invitation.proof);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.remember).toHaveBeenCalledWith({
      invitationId: invitation.invitationId,
      proof: invitation.proof,
    });
    fireEvent.click(screen.getByRole("button", { name: t.copyCode }));
    await screen.findByRole("button", { name: t.copied });
    fireEvent.click(screen.getByRole("button", { name: t.emailCode }));
    expect(state.send).toHaveBeenCalledWith({
      invitationId: invitation.invitationId,
      proof: invitation.proof,
    });
    fireEvent.click(screen.getByRole("button", { name: t.close }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: t.showCode }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: t.showCode }));
    expect(screen.getByText(invitation.code)).toBeTruthy();
  },
);

it("keeps the receipt after failed email and prevents leaving during a pending write", async () => {
  const { rerender } = render(view());
  await screen.findByRole("link", {
    name: en.accountInvitation.continueSignup,
  });
  state.pending = true;
  rerender(view());
  expect(
    screen.queryByRole("link", { name: en.accountInvitation.continueSignup }),
  ).toBeNull();
  const dialog = screen.getByRole("dialog");
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  state.pending = false;
  state.error = { message: "SIGNUP_MAIL_FAILED" };
  rerender(view());
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByText(invitation.code)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: en.accountInvitation.continueSignup }),
  ).toBeTruthy();
});

it("offers manual-verification recovery when the browser handoff fails", async () => {
  state.remember.mockRejectedValueOnce(Error("offline"));
  render(view());
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      en.accountInvitation.handoffRecovery,
    ),
  );
  expect(
    screen.getByRole("link", { name: en.accountInvitation.continueSignup }),
  ).toBeTruthy();
});
