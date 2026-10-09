// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { signupSettings } from "~/lib/signup-fields";
import { SignupForm } from "../signup/signup-form";
import { ViewerSignupFlow } from "../viewer-signup/viewer-signup-flow";

const mocks = vi.hoisted(() => ({
  verifyCaptcha: vi.fn(),
  survey: vi.fn(),
  start: vi.fn(),
  verifyEmail: vi.fn(),
  complete: vi.fn(),
  settings: {
    enabled: true,
    version: 1,
    ready: true,
    config: {
      provider: "aliyun-v2" as const,
      region: "cn" as const,
      prefix: "local",
      scenes: { tutee: "local-tutee", viewer: "local-viewer" },
    },
  },
}));

// The actual CAPTCHA hook, Challenge and both feature forms run together. Only
// service responses and the unrelated policy reader are replaced in this test.
function useFeatureMutation(
  work: (input: unknown) => Promise<unknown>,
  options?: {
    onSuccess: (data: { emailSent: boolean; invitationId?: string }) => void;
    onSettled?: () => void;
  },
) {
  const [isPending, setPending] = useState(false);
  const [isSuccess, setSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function mutateAsync(input: unknown) {
    setPending(true);
    setError(null);
    try {
      const data = ((await work(input)) ?? { emailSent: true }) as {
        emailSent: boolean;
        invitationId?: string;
      };
      options?.onSuccess(data);
      setSuccess(true);
      return data;
    } catch (failure) {
      setError(failure as Error);
      throw failure;
    } finally {
      setPending(false);
      options?.onSettled?.();
    }
  }
  return {
    mutateAsync,
    mutate: (input: unknown) => {
      void mutateAsync(input);
    },
    isPending,
    isSuccess,
    error,
    data: { emailSent: true },
    reset: () => {
      setError(null);
      setSuccess(false);
    },
  };
}
vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      captchaPublic: {
        useQuery: () => ({
          data: mocks.settings,
          refetch: async () => ({ data: mocks.settings }),
        }),
      },
      verifySignupCaptcha: {
        useMutation: () => ({ mutateAsync: mocks.verifyCaptcha }),
      },
      profilePolicy: {
        useQuery: () => ({
          data: {
            requireLatinNames: false,
            requireLatinLegalNames: false,
            offeredGrades: [9],
            currentSchoolYear: "26-27",
          },
        }),
      },
    },
    tutee: {
      signupOptions: {
        useQuery: () => ({
          isFetchedAfterMount: true,
          data: {
            subjects: [{ id: "math", name: "Math" }],
            slots: [],
            fields: signupSettings({
              tutee: {
                preferredContact: "hidden",
                availability: "hidden",
                signatureName: "hidden",
              },
            }).tutee,
          },
        }),
      },
      surveyPolicy: {
        useQuery: () => ({
          data: { revision: "policy-1", title: "Policy", body: "Local policy" },
        }),
      },
      submitSurvey: { useMutation: () => useFeatureMutation(mocks.survey) },
    },
    viewer: {
      start: {
        useMutation: (options: Parameters<typeof useFeatureMutation>[1]) =>
          useFeatureMutation(mocks.start, options),
      },
      verify: {
        useMutation: (options: Parameters<typeof useFeatureMutation>[1]) =>
          useFeatureMutation(mocks.verifyEmail, options),
      },
      complete: {
        useMutation: (options: Parameters<typeof useFeatureMutation>[1]) =>
          useFeatureMutation(mocks.complete, options),
      },
    },
  },
}));
vi.mock("./policy-agreement", () => ({
  PolicyAgreement: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label="Accept policy"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
}));
vi.mock("../signup/signin-access", () => ({ SigninAccess: () => null }));
vi.mock("../signup/survey-resend", () => ({ SurveyResend: () => null }));
// Email verification hands off to shared redemption; it must never create a
// Viewer-specific password stage or reuse the mailbox code as an invitation.
vi.mock("../register/invitation-redemption", () => ({
  InvitationRedemption: ({ invitationId }: { invitationId: string }) => (
    <div data-testid="recipient-invitation">{invitationId}</div>
  ),
}));

let callbacks: Promise<unknown>[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
  mocks.verifyCaptcha.mockReset().mockResolvedValue({ grant: "a".repeat(64) });
  for (const mutation of [
    mocks.survey,
    mocks.start,
    mocks.verifyEmail,
    mocks.complete,
  ])
    mutation.mockReset().mockResolvedValue(undefined);
  callbacks = [];
  // A local SDK fixture binds the real Verify button. Native click() obeys a
  // disabled fieldset, unlike invoking captchaVerifyCallback directly.
  window.initAliyunCaptcha = (options) => {
    const button = document.querySelector<HTMLButtonElement>(options.button)!;
    const verify = () => {
      callbacks.push(options.captchaVerifyCallback("local-sdk-proof"));
    };
    button.addEventListener("click", verify);
    options.getInstance({
      destroy: () => button.removeEventListener("click", verify),
    });
  };
});
afterEach(() => {
  cleanup();
  delete window.initAliyunCaptcha;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
type Locale = "en" | "zh";
const copy = (locale: Locale) => (locale === "en" ? en : zh);
function show(viewer: boolean, locale: Locale) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={copy(locale)}
      timeZone="Asia/Shanghai"
    >
      {viewer ? <ViewerSignupFlow /> : <SignupForm />}
    </NextIntlClientProvider>,
  );
}
function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  fireEvent.change(input, { target: { value } });
  return input;
}
async function click(button: HTMLElement) {
  await act(async () => {
    button.click();
  });
}
function featureSubmit() {
  fireEvent.submit(document.querySelector("form")!);
}
async function stage(button: HTMLElement, locale: Locale) {
  // Two same-tick submit/resend clicks must stage only one intent.
  await act(async () => {
    button.click();
    button.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  const verify = screen.getByRole<HTMLButtonElement>("button", {
    name: copy(locale).captcha.verify,
  });
  const cancel = screen.getByRole<HTMLButtonElement>("button", {
    name: copy(locale).captcha.cancel,
  });
  expect(verify.closest("fieldset:disabled")).toBeNull();
  expect(verify.matches(":disabled")).toBe(false);
  expect(cancel.matches(":disabled")).toBe(false);
  verify.focus();
  expect(document.activeElement).toBe(verify);
  cancel.focus();
  expect(document.activeElement).toBe(cancel);
  return { verify, cancel };
}
async function finish(verify: HTMLButtonElement) {
  await act(async () => {
    verify.click();
    await Promise.all(callbacks);
  });
}
function fillIdentity(viewer: boolean) {
  const name = fill('[name="firstName"]', "Retained");
  if (viewer) {
    fill("#obs-aff", "Family");
    fill("#obs-email", "viewer@example.test");
  } else {
    fill('input[type="email"]', "tutee@example.test");
    fireEvent.change(
      screen
        .getAllByRole("combobox")
        .find((select) => select.querySelector('option[value="math"]'))!,
      { target: { value: "math" } },
    );
    fireEvent.click(screen.getByLabelText("Accept policy"));
  }
  return name;
}

it.each<Locale>(["en", "zh"])(
  "keeps tutee Verify/Cancel usable, retains failures and submits a grant once (%s)",
  async (locale) => {
    show(false, locale);
    const name = fillIdentity(false),
      submit = screen.getByRole("button", {
        name: copy(locale).public.signup.submit,
      });
    let widget = await stage(submit, locale);
    expect(name.matches(":disabled")).toBe(true);
    featureSubmit();
    expect(mocks.survey).not.toHaveBeenCalled();
    await click(widget.cancel);
    expect(name.value).toBe("Retained");
    expect(name.matches(":disabled")).toBe(false);
    widget = await stage(submit, locale);
    mocks.verifyCaptcha.mockRejectedValueOnce(new Error("CAPTCHA_REJECTED"));
    await finish(widget.verify);
    expect(screen.getByRole("alert").textContent).toBe(
      copy(locale).captcha.rejected,
    );
    expect(name.value).toBe("Retained");
    expect(mocks.survey).not.toHaveBeenCalled();
    await click(
      screen.getByRole("button", {
        name: copy(locale).captcha.retry,
      }),
    );
    widget = await stage(submit, locale);
    let release!: () => void;
    mocks.survey.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      widget.verify.click();
      widget.verify.click();
    });
    expect(mocks.verifyCaptcha).toHaveBeenCalledTimes(2); // rejected proof plus one accepted proof
    expect(mocks.survey).toHaveBeenCalledTimes(1);
    expect(mocks.survey).toHaveBeenLastCalledWith(
      expect.objectContaining({
        captchaGrant: "a".repeat(64),
        email: "tutee@example.test",
        firstName: "Retained",
      }),
    );
    expect(name.matches(":disabled")).toBe(true);
    expect(widget.cancel.matches(":disabled")).toBe(true);
    featureSubmit();
    expect(mocks.survey).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await Promise.all(callbacks);
    });
    expect(
      screen.getByRole("heading", { name: copy(locale).survey.savedTitle }),
    ).toBeTruthy();
    expect(document.querySelector('script[src*="aliyunCaptcha"]')).toBeNull();
  },
);

it.each(["details", "code"] as const)(
  "keeps Viewer %s challenge operable through cancellation, rejection and retry",
  async (step) => {
    const locale: Locale = step === "code" ? "zh" : "en";
    show(true, locale);
    const name = fillIdentity(true);
    let trigger = screen.getByRole("button", {
      name: copy(locale).public.viewerSignup.sendCode,
    });
    if (step !== "details") {
      await finish((await stage(trigger, locale)).verify);
      fill("#obs-code", "ABCDE");
      trigger = screen.getByRole("button", {
        name: copy(locale).public.viewerSignup.resend,
      });
    }
    const draft =
      step === "details"
        ? name
        : document.querySelector<HTMLInputElement>("#obs-code")!;
    const value = draft.value,
      startedBefore = mocks.start.mock.calls.length,
      verifiedBefore = mocks.verifyEmail.mock.calls.length;
    let widget = await stage(trigger, locale);
    expect(draft.matches(":disabled")).toBe(true);
    featureSubmit();
    expect(mocks.start).toHaveBeenCalledTimes(startedBefore);
    expect(mocks.verifyEmail).toHaveBeenCalledTimes(verifiedBefore);
    expect(mocks.complete).not.toHaveBeenCalled();
    await click(widget.cancel);
    expect(draft.value).toBe(value);
    expect(draft.matches(":disabled")).toBe(false);
    widget = await stage(trigger, locale);
    mocks.verifyCaptcha.mockRejectedValueOnce(new Error("CAPTCHA_REJECTED"));
    await finish(widget.verify);
    expect(screen.getByRole("alert").textContent).toBe(
      copy(locale).captcha.rejected,
    );
    expect(draft.value).toBe(value);
    expect(mocks.start).toHaveBeenCalledTimes(startedBefore);
    await click(
      screen.getByRole("button", {
        name: copy(locale).captcha.retry,
      }),
    );
    widget = await stage(trigger, locale);
    let release!: () => void;
    mocks.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      widget.verify.click();
      widget.verify.click();
    });
    expect(mocks.start).toHaveBeenCalledTimes(startedBefore + 1);
    expect(draft.matches(":disabled")).toBe(true);
    expect(widget.cancel.matches(":disabled")).toBe(true);
    await act(async () => {
      release();
      await Promise.all(callbacks);
    });
    expect(
      screen.getByRole("heading", {
        name: copy(locale).registrationFlow.verifyTitle,
      }),
    ).toBeTruthy();
    expect(document.querySelector<HTMLInputElement>("#obs-code")!.value).toBe(
      "",
    );
    expect(mocks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        firstName: "Retained",
        email: "viewer@example.test",
        captchaGrant: "a".repeat(64),
      }),
    );
  },
);

it.each<Locale>(["en", "zh"])(
  "hands verified Viewer identity to a distinct recipient invitation (%s)",
  async (locale) => {
    show(true, locale);
    fillIdentity(true);
    await finish(
      (
        await stage(
          screen.getByRole("button", {
            name: copy(locale).public.viewerSignup.sendCode,
          }),
          locale,
        )
      ).verify,
    );
    fill("#obs-code", "ABCDE");
    let release!: () => void;
    mocks.verifyEmail.mockImplementationOnce(
      () =>
        new Promise<{ invitationId: string }>((resolve) => {
          release = () =>
            resolve({ invitationId: "separate-recipient-invitation" });
        }),
    );
    await act(async () => {
      featureSubmit();
      featureSubmit();
    });
    expect(mocks.verifyEmail).toHaveBeenCalledTimes(1);
    expect(mocks.verifyEmail).toHaveBeenCalledWith({
      email: "viewer@example.test",
      code: "ABCDE",
    });
    expect(document.querySelector("#obs-code")!.matches(":disabled")).toBe(
      true,
    );
    await act(async () => {
      release();
    });
    expect(screen.getByTestId("recipient-invitation").textContent).toBe(
      "separate-recipient-invitation",
    );
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector("#obs-code")).toBeNull();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  },
);

it.each([false, true])(
  "retains the draft when the feature request fails after a CAPTCHA grant (viewer=%s)",
  async (viewer) => {
    show(viewer, "en");
    const name = fillIdentity(viewer);
    (viewer ? mocks.start : mocks.survey).mockRejectedValueOnce(
      new Error("Local submission failed"),
    );
    const submit = screen.getByRole("button", {
      name: viewer ? en.public.viewerSignup.sendCode : en.public.signup.submit,
    });
    const widget = await stage(submit, "en");
    await finish(widget.verify);
    expect(name.value).toBe("Retained");
    expect(name.matches(":disabled")).toBe(false);
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.textContent === "Local submission failed"),
    ).toBe(true);
    await click(screen.getByRole("button", { name: en.captcha.retry }));
    await finish((await stage(submit, "en")).verify);
    expect(viewer ? mocks.start : mocks.survey).toHaveBeenCalledTimes(2);
  },
);
