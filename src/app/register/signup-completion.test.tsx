/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import zh from "../../../messages/zh.json";
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
      reset: vi.fn(),
      isPending: isResend && mocks.resendPending,
      error:
        isResend && mocks.resendError
          ? { message: "Mail could not be delivered" }
          : null,
      mutateAsync: async (_input: object) => {
        if (!(isResend && mocks.resendError))
          options.onSuccess(
            "completionProof" in data
              ? { ...data, completionProof: mocks.proof }
              : data,
          );
      },
      mutate: (input: object) => {
        if (isComplete) {
          mocks.complete(input);
          if (mocks.completionResult) options.onSuccess(mocks.completionResult);
        } else if (!(isResend && mocks.resendError))
          options.onSuccess(
            "completionProof" in data
              ? { ...data, completionProof: mocks.proof }
              : data,
          );
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
beforeEach(() => {
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  mocks.proof = "a".repeat(64);
  cleanup();
  mocks.complete.mockClear();
  mocks.resendError = false;
  mocks.resendPending = false;
  mocks.completionResult = null;
});
const wrap = (viewer: boolean, locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "en" ? en : zh}
    timeZone="Asia/Shanghai"
  >
    {viewer ? <ViewerSignupFlow /> : <RegisterFlow />}
  </NextIntlClientProvider>
);
function fill(id: string, value: string) {
  const names: Record<string, string> = {
    "obs-name": "firstName",
    "reg-first": "firstName",
    "reg-last": "lastName",
    "reg-alt": "alternativeNames",
  };
  const field = names[id]
    ? document.querySelector('[name="' + names[id] + '"]')
    : document.getElementById(id);
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
it("keeps the affiliation example readable and associated with its input", () => {
  render(wrap(true));
  const affiliation = screen.getByLabelText(
    `${en.public.viewerSignup.fields.affiliation} ${en.signupFields.required}`,
  );
  const hint = document.getElementById(
    affiliation.getAttribute("aria-describedby") ?? "",
  );
  expect(hint?.textContent).toBe(
    en.public.viewerSignup.fields.affiliationPlaceholder,
  );
  expect(affiliation.getAttribute("placeholder")).toBeNull();
});

it("shows the viewer completion action after verification and matching passwords", () => {
  mocks.completionResult = {
    username: "visual",
    academicConfirmationRequired: false,
  };
  render(wrap(true));
  reachEmailCode(true);
  fill("obs-code", "FGHJK");
  submit();
  fill("obs-pass", "Password123!");
  fill("obs-confirm", "Password123!");
  submit();
  expect(screen.getByText(en.public.viewerSignup.doneTitle)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.public.viewerSignup.signIn })
      .getAttribute("href"),
  ).toBe("/signin");
});

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
    screen.getByLabelText(
      `${en.auth.register.step.profile.grade} ${en.signupFields.optional}`,
    ).tagName,
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

it.each([false, true])(
  "labels requirements through every registration step (viewer=%s)",
  (viewer) => {
    render(wrap(viewer));
    const assertLabels = () => {
      for (const label of document.querySelectorAll("form label.label"))
        expect(label.textContent).toMatch(/ (Required|Optional)$/);
    };
    assertLabels();
    reachEmailCode(viewer);
    assertLabels();
    fill(viewer ? "obs-code" : "reg-emailcode", "FGHJK");
    submit();
    assertLabels();
    if (!viewer) {
      expect(screen.getByLabelText("First Name Required")).toBeTruthy();
      for (const label of [
        "Last Name",
        "Preferred Name",
        "Name in Another Language",
        "Grade",
      ])
        expect(screen.getByLabelText(label + " Optional")).toBeTruthy();
    }
  },
);

vi.mock("~/app/_components/signup-captcha", () => ({
  useSignupCaptcha: () => ({
    run: (work: (grant?: string) => Promise<unknown>) => work(),
    panel: null,
    pending: false,
  }),
  CaptchaError: ({ error }: { error: { message: string } }) => (
    <>{error.message}</>
  ),
}));

it.each([false, true])(
  "keeps profile drafts across identity editing but requires a new proof (viewer=%s)",
  (viewer) => {
    render(wrap(viewer));
    reachEmailCode(viewer);
    fill(viewer ? "obs-code" : "reg-emailcode", "FGHJK");
    submit();
    if (!viewer) {
      fill("reg-first", "Draft name");
      fill("reg-last", "Family");
    }
    fill(viewer ? "obs-pass" : "reg-pass", "Password123!");
    fill(viewer ? "obs-confirm" : "reg-confirm", "Password123!");
    fireEvent.click(
      screen.getByRole("button", {
        name: viewer
          ? en.registrationFlow.editIdentity
          : en.registrationFlow.editEmail,
      }),
    );
    expect(
      screen.queryByLabelText(
        viewer
          ? en.public.viewerSignup.fields.password
          : en.auth.register.step.profile.password,
      ),
    ).toBeNull();
    if (viewer) {
      expect(
        (document.getElementById("obs-aff") as HTMLInputElement).value,
      ).toBe("Family");
      fill("obs-email", "changed@example.test");
    } else {
      expect(
        (document.getElementById("reg-email") as HTMLInputElement).readOnly,
      ).toBe(true);
    }
    submit();
    expect(mocks.complete).not.toHaveBeenCalled();
    mocks.proof = "b".repeat(64);
    fill(viewer ? "obs-code" : "reg-emailcode", "NEW12");
    submit();
    expect(
      (
        document.getElementById(
          viewer ? "obs-pass" : "reg-pass",
        ) as HTMLInputElement
      ).value,
    ).toBe("Password123!");
    if (!viewer)
      expect(
        document.querySelector<HTMLInputElement>('[name="firstName"]')!.value,
      ).toBe("Draft name");
    submit();
    expect(mocks.complete).toHaveBeenLastCalledWith(
      expect.objectContaining({
        completionProof: "b".repeat(64),
        ...(viewer ? { email: "changed@example.test" } : {}),
      }),
    );
  },
);
it.each(["en", "zh"] as const)(
  "announces numbered progress and focuses the next heading in %s",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    render(wrap(false, locale));
    const progress = screen.getByRole("list", {
      name: copy.registrationFlow.progressTitle,
    });
    expect(progress.children).toHaveLength(5);
    expect(
      progress.querySelector('[aria-current="step"]')?.textContent,
    ).toContain(copy.registrationFlow.invitationTitle);
    fill("reg-code", "ABCDE");
    submit();
    const heading = screen.getByRole("heading", {
      name: copy.registrationFlow.emailTitle,
    });
    expect(document.activeElement).toBe(heading);
    fireEvent.click(
      screen.getByRole("button", { name: copy.registrationFlow.back }),
    );
    expect(
      (document.getElementById("reg-code") as HTMLInputElement).value,
    ).toBe("ABCDE");
    expect(document.activeElement).toBe(
      screen.getByRole("heading", {
        name: copy.registrationFlow.invitationTitle,
      }),
    );
  },
);
it("rechecking the same invitation retains drafts; a different invitation clears them", () => {
  render(wrap(false));
  reachEmailCode(false);
  fill("reg-emailcode", "FGHJK");
  submit();
  fill("reg-first", "Retained name");
  fill("reg-pass", "Password123!");
  fireEvent.click(
    screen.getByRole("button", { name: en.registrationFlow.editInvitation }),
  );
  submit();
  submit();
  fill("reg-emailcode", "FGHJK");
  submit();
  expect(
    document.querySelector<HTMLInputElement>('[name="firstName"]')!.value,
  ).toBe("Retained name");
  fireEvent.click(
    screen.getByRole("button", { name: en.registrationFlow.editInvitation }),
  );
  fill("reg-code", "OTHER");
  submit();
  submit();
  fill("reg-emailcode", "FGHJK");
  submit();
  expect((document.getElementById("reg-pass") as HTMLInputElement).value).toBe(
    "",
  );
  expect(
    document.querySelector<HTMLInputElement>('[name="firstName"]')!.value,
  ).toBe("");
});
