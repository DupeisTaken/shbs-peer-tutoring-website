/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { RegisterFlow } from "./register-flow";
import { ViewerSignupFlow } from "../viewer-signup/viewer-signup-flow";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  resendError: false,
  resendPending: false,
  proof: "a".repeat(64),
  completionResult: null as null | {
    username: string;
    academicConfirmationRequired: boolean;
  },
}));
vi.mock("~/trpc/react", () => {
  const mutation = (data: object, isResend = false, isComplete = false) => ({
    useMutation: (options: { onSuccess: (data: object) => void }) => ({
      isPending: isResend && mocks.resendPending,
      error:
        isResend && mocks.resendError
          ? { message: "Mail could not be delivered" }
          : null,
      mutate: (input: object) => {
        if (isComplete) {
          mocks.complete(input);
          if (mocks.completionResult) options.onSuccess(mocks.completionResult);
        } else if (!(isResend && mocks.resendError)) options.onSuccess(data);
      },
    }),
  });
  return {
    api: {
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: {
              requireLatinNames: false,
              offeredGrades: [1, 9, 12],
              currentSchoolYear: "26-27",
            },
            refetch: async () => ({ data: {} }),
          }),
        },
      },
      registration: {
        check: mutation({
          kind: "TUTOR",
          boundEmail: "person@example.test",
          emailVerified: true,
        }),
        sendEmailCode: mutation({}, true),
        verifyEmail: mutation({ completionProof: mocks.proof }),
        complete: mutation({}, false, true),
      },
      viewer: {
        start: mutation({}, true),
        verify: mutation({ completionProof: mocks.proof }),
        complete: mutation({}, false, true),
      },
    },
  };
});
afterEach(() => {
  cleanup();
  mocks.complete.mockClear();
  mocks.resendError = false;
  mocks.resendPending = false;
  mocks.completionResult = null;
});
const wrap = (viewer: boolean) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
    {viewer ? <ViewerSignupFlow /> : <RegisterFlow />}
  </NextIntlClientProvider>
);
function fill(id: string, value: string) {
  const field = document.getElementById(id);
  if (!field) throw Error(`Missing field ${id}`);
  fireEvent.change(field, { target: { value } });
}
function submit() {
  const form = document.querySelector("form");
  if (!form) throw Error("Missing form");
  fireEvent.submit(form);
}
function reachEmailCode(viewer: boolean) {
  if (viewer) {
    fill("obs-name", "Person");
    fill("obs-aff", "Family");
    fill("obs-email", "person@example.test");
    submit();
  } else {
    fill("reg-code", "ABCDE");
    submit();
    // A shared verifiedAt flag must no longer skip the current browser's email proof.
    expect(document.getElementById("reg-email")).not.toBeNull();
    submit();
  }
}
it("uses offered grades and the current program year without sending a client-selected year", () => {
  render(wrap(false));
  reachEmailCode(false);
  fill("reg-emailcode", "FGHJK");
  submit();
  fill("reg-first", "Person");
  fill("reg-last", "One");
  fill("reg-pass", "Password123!");
  fill("reg-confirm", "Password123!");
  fill("reg-grade", "1");
  expect(
    screen.getByLabelText(en.auth.register.step.profile.grade).tagName,
  ).toBe("SELECT");
  expect(
    screen.queryByRole("textbox", { name: en.academics.schoolYear }),
  ).toBeNull();
  expect(
    screen.getByText("Uses the current program school year: 26-27."),
  ).toBeTruthy();
  submit();
  expect(mocks.complete).toHaveBeenCalledWith(
    expect.objectContaining({ gradeLevel: 1 }),
  );
  expect(mocks.complete.mock.calls[0]?.[0]).not.toHaveProperty(
    "gradeSchoolYear",
  );
});

it.each([false, true])(
  "passes verifier proof and requires matching password confirmation (viewer=%s)",
  (viewer) => {
    const rendered = render(wrap(viewer));
    reachEmailCode(viewer);
    fill(viewer ? "obs-code" : "reg-emailcode", "FGHJK");
    submit();
    if (!viewer) {
      fill("reg-first", "Person");
      fill("reg-last", "One");
    }
    fill(viewer ? "obs-pass" : "reg-pass", "Password123!");
    submit();
    expect(mocks.complete).not.toHaveBeenCalled();
    fill(viewer ? "obs-confirm" : "reg-confirm", "DifferentPassword!");
    submit();
    expect(mocks.complete).not.toHaveBeenCalled();
    fill(viewer ? "obs-confirm" : "reg-confirm", "Password123!");
    submit();
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        completionProof: mocks.proof,
        password: "Password123!",
      }),
    );
    mocks.complete.mockClear();
    mocks.resendPending = true;
    rendered.rerender(wrap(viewer));
    submit();
    expect(mocks.complete).not.toHaveBeenCalled();
    mocks.resendError = true;
    rendered.rerender(wrap(viewer));
    expect(screen.getByText("Mail could not be delivered")).toBeTruthy();
  },
);
it.each([false, true])(
  "shows resend failures beside the email-code form (viewer=%s)",
  (viewer) => {
    const rendered = render(wrap(viewer));
    reachEmailCode(viewer);
    mocks.resendError = true;
    rendered.rerender(wrap(viewer));
    expect(screen.getByText("Mail could not be delivered")).toBeTruthy();
  },
);

it.each([true, false])(
  "registration completion explains pending academic review: %s",
  (academicConfirmationRequired) => {
    mocks.completionResult = {
      username: "stablecustom",
      academicConfirmationRequired,
    };
    render(wrap(false));
    reachEmailCode(false);
    fill("reg-emailcode", "FGHJK");
    submit();
    fill("reg-first", "Person");
    fill("reg-last", "One");
    fill("reg-pass", "Password123!");
    fill("reg-confirm", "Password123!");
    submit();
    expect(screen.getByText(en.auth.register.done.title)).toBeTruthy();
    expect(screen.queryByRole("status") !== null).toBe(
      academicConfirmationRequired,
    );
    if (academicConfirmationRequired) {
      expect(screen.getByRole("status").textContent).toContain(
        en.academics.confirmationRequired,
      );
      expect(
        screen
          .getByRole("link", { name: en.academics.review })
          .getAttribute("href"),
      ).toBe("/my-account");
    }
  },
);
