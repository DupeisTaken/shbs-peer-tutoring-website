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
import zh from "../../../messages/zh.json";
import { SurveyVerification } from "./survey-verification";
const state = vi.hoisted(() => ({
  verify: vi.fn(),
  resend: vi.fn(),
  captcha: vi.fn(),
  pending: false,
  captchaPending: false,
  resendData: undefined as undefined | { emailSent: boolean },
  error: null as null | { message: string },
  settled: undefined as (() => void) | undefined,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    accountInvitation: {
      verifySurvey: {
        useMutation: (options: { onSettled: () => void }) => {
          state.settled = options.onSettled;
          return {
            mutate: state.verify,
            isPending: state.pending,
            data: null,
            error: state.error,
          };
        },
      },
    },
    tutee: {
      resendSurvey: {
        useMutation: () => ({
          mutateAsync: state.resend,
          isPending: false,
          data: state.resendData,
        }),
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
const view = (intentId?: string) => (
  <NextIntlClientProvider locale="en" messages={en}>
    <SurveyVerification email="verified@example.test" intentId={intentId} />
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  state.pending = false;
  state.captchaPending = false;
  state.resendData = undefined;
  state.error = null;
  state.captcha.mockImplementation((work: () => Promise<unknown>) => work());
  state.resend.mockResolvedValue({ emailSent: true });
});
afterEach(cleanup);
it.each(["0012", "ABC123"])(
  "binds verification code %s and resend to the exact submission intent",
  async (code) => {
    const mounted = render(view("specific-intent"));
    fireEvent.change(screen.getByLabelText(/^Email verification code/), {
      target: { value: code },
    });
    fireEvent.submit(mounted.container.querySelector("form")!);
    expect(state.verify).toHaveBeenCalledWith({
      email: "verified@example.test",
      code,
      intentId: "specific-intent",
    });
    state.settled!();
    fireEvent.click(screen.getByRole("button", { name: en.survey.resend }));
    await act(() => Promise.resolve());
    expect(state.resend).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "verified@example.test",
        intentId: "specific-intent",
      }),
    );
  },
);
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
        name: en.survey.verifyContinue,
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

it.each(["en", "zh"] as const)(
  "makes the %s unfinished step and failed delivery visible, then recovers in place",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const content = () => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <SurveyVerification
          email="student@example.test"
          intentId="exact-intent"
          emailSent={false}
          focusOnMount
        />
      </NextIntlClientProvider>
    );
    const { rerender } = render(content());
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: messages.survey.savedTitle }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      messages.survey.mailFailed,
    );
    expect(
      screen.getByRole("button", { name: messages.survey.verifyContinue }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: messages.survey.signIn }),
    ).toBeNull();
    const input = screen.getByLabelText(new RegExp(messages.codes.emailLabel));
    fireEvent.change(input, { target: { value: "0012" } });
    state.error = { message: "INVITATION_INVALID" };
    rerender(content());
    expect(screen.getByText(messages.survey.verificationRecovery)).toBeTruthy();
    expect(screen.getByDisplayValue("0012")).toBe(input);
    state.error = null;
    state.resendData = { emailSent: true };
    rerender(content());
    expect(screen.queryByText(messages.survey.mailFailed)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(messages.survey.resent);
    expect(state.verify).not.toHaveBeenCalled();
  },
);
