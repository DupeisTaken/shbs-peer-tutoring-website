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
import en from "../../../messages/en.json";
import { SurveyVerification } from "./survey-verification";
const state = vi.hoisted(() => ({
  verify: vi.fn(),
  resend: vi.fn(),
  captcha: vi.fn(),
  pending: false,
  captchaPending: false,
  settled: undefined as (() => void) | undefined,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    accountInvitation: {
      verifySurvey: {
        useMutation: (options: { onSettled: () => void }) => {
          state.settled = options.onSettled;
          return { mutate: state.verify, isPending: state.pending, data: null };
        },
      },
    },
    tutee: {
      resendSurvey: {
        useMutation: () => ({ mutateAsync: state.resend, isPending: false }),
      },
    },
  },
}));
vi.mock("~/app/_components/signup-captcha", () => ({
  useSignupCaptcha: () => ({
    run: state.captcha,
    pending: state.captchaPending,
    panel: <button type="button">CAPTCHA control</button>,
  }),
  CaptchaError: () => null,
}));
vi.mock("../register/invitation-receipt", () => ({
  InvitationReceipt: () => null,
}));
const view = () => (
  <NextIntlClientProvider locale="en" messages={en}>
    <SurveyVerification email="verified@example.test" />
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  state.pending = false;
  state.captchaPending = false;
  state.captcha.mockImplementation((work: () => Promise<unknown>) => work());
  state.resend.mockResolvedValue({ emailSent: true });
});
afterEach(cleanup);
it("blocks resends throughout a held verification and retains the code for retry", () => {
  const { container, rerender } = render(view());
  fireEvent.change(screen.getByLabelText(/^Email verification code/), {
    target: { value: "ABC123" },
  });
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.click(screen.getByRole("button", { name: en.survey.resend }));
  expect(state.verify).toHaveBeenCalledOnce();
  expect(state.captcha).not.toHaveBeenCalled();
  state.pending = true;
  rerender(view());
  expect(
    screen
      .getByRole<HTMLButtonElement>("button", { name: en.survey.resend })
      .matches(":disabled"),
  ).toBe(true);
  state.pending = false;
  state.settled!();
  rerender(view());
  expect(screen.getByDisplayValue("ABC123")).toBeTruthy();
  fireEvent.submit(container.querySelector("form")!);
  expect(state.verify).toHaveBeenCalledTimes(2);
});
it("blocks verification during resend admission and keeps CAPTCHA outside disabled fields", async () => {
  let finish!: (value: unknown) => void;
  state.resend.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { container, rerender } = render(view());
  fireEvent.click(screen.getByRole("button", { name: en.survey.resend }));
  fireEvent.submit(container.querySelector("form")!);
  expect(state.verify).not.toHaveBeenCalled();
  expect(state.resend).toHaveBeenCalledOnce();
  state.captchaPending = true;
  rerender(view());
  expect(
    screen
      .getByRole<HTMLButtonElement>("button", {
        name: en.accountInvitation.verify,
      })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole<HTMLButtonElement>("button", { name: "CAPTCHA control" })
      .matches(":disabled"),
  ).toBe(false);
  await act(async () => finish({ emailSent: true }));
});
