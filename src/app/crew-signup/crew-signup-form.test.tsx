// @vitest-environment jsdom
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
import { CrewSignupForm } from "./crew-signup-form";
import type * as SignupCaptcha from "~/app/_components/signup-captcha";

const state = vi.hoisted(() => ({
  apply: vi.fn(),
  request: vi.fn(),
  verify: vi.fn(),
  refresh: vi.fn(),
  captchaRun: vi.fn(),
  captchaAction: "",
  captchaEmail: "",
  captchaPending: false,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      profilePolicy: {
        useQuery: () => ({
          data: {
            requireLatinNames: false,
            offeredGrades: [1, 9, 12],
            currentSchoolYear: "26-27",
          },
          refetch: vi.fn(),
        }),
      },
    },
    crew: {
      submitApplication: { useMutation: () => ({ mutateAsync: state.apply }) },
      requestStatus: { useMutation: () => ({ mutateAsync: state.request }) },
      verifyApplication: { useMutation: () => ({ mutateAsync: state.verify }) },
      applicationStatus: {
        useMutation: () => ({ mutateAsync: state.refresh }),
      },
    },
  },
}));
vi.mock("~/app/_components/signup-captcha", async (original) => {
  const actual = await original<typeof SignupCaptcha>();
  return {
    ...actual,
    useSignupCaptcha: (action: string, email: string) => {
      state.captchaAction = action;
      state.captchaEmail = email;
      return {
        run: state.captchaRun,
        pending: state.captchaPending,
        panel: state.captchaPending ? (
          <button type="button">Complete CAPTCHA</button>
        ) : null,
      };
    },
  };
});
vi.mock("../register/invitation-receipt", () => ({
  InvitationReceipt: ({
    invitation,
  }: {
    invitation: { code: string; invitationId: string };
  }) => (
    <div data-testid="invitation-receipt">
      {invitation.invitationId}: {invitation.code}
    </div>
  ),
}));
const proof = "a".repeat(64);
const pending = { status: "PENDING", statusProof: proof };
const available = {
  status: "ACCEPTED",
  statusProof: proof,
  invitationState: "AVAILABLE",
  invitation: {
    invitationId: "crew-invite",
    code: "0IABC",
    email: "crew@example.test",
  },
};
function view(locale: "en" | "zh" = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      <CrewSignupForm />
    </NextIntlClientProvider>
  );
}
function input(selector: string, value: string) {
  fireEvent.change(document.querySelector(selector)!, { target: { value } });
}
function fillDraft() {
  input('[name="firstName"]', "Crew");
  input('[name="lastName"]', "Person");
  input('[name="preferredName"]', "Casey");
  input('[name="alternativeNames"]', "巡查同学");
  input("#crew-email", "Crew@Example.Test");
  input("#crew-grade", "9");
  input("#crew-contact", "Keep my contact");
  input("#crew-message", "Keep my application answers");
}
async function sent() {
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() =>
    expect(document.querySelector("#crew-code")).toBeTruthy(),
  );
}
async function verified(result: unknown = pending) {
  state.verify.mockResolvedValueOnce(result);
  input("#crew-code", "ABCD2");
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Application Status" }),
    ).toBeTruthy(),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  state.captchaPending = false;
  state.apply.mockResolvedValue({ ok: true });
  state.request.mockResolvedValue({ ok: true });
  state.verify.mockResolvedValue(pending);
  state.refresh.mockResolvedValue(pending);
  state.captchaRun.mockImplementation(
    async (work: (grant?: string) => Promise<unknown>) => work("captcha-grant"),
  );
});
afterEach(cleanup);

it("keeps translated required/optional markers and the four-part identity/application groups", () => {
  render(view());
  expect(screen.getByLabelText(/First Name Required/)).toBeTruthy();
  expect(screen.getByLabelText(/Email Required/)).toBeTruthy();
  for (const field of ["Grade level", "Preferred contact", "Anything else?"])
    expect(screen.getByLabelText(field + " Optional")).toBeTruthy();
  expect(
    screen.getByRole("group", { name: "Identity and Contact" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("group", { name: "Application Details" }),
  ).toBeTruthy();
});

it("stages all four-part names and answers behind CAPTCHA without showing status before verification", async () => {
  render(view());
  fillDraft();
  await sent();
  expect(state.apply).toHaveBeenCalledWith({
    firstName: "Crew",
    lastName: "Person",
    preferredName: "Casey",
    alternativeNames: "巡查同学",
    name: "Crew Person",
    email: "crew@example.test",
    gradeLevel: 9,
    preferredContact: "Keep my contact",
    message: "Keep my application answers",
    captchaGrant: "captcha-grant",
  });
  expect(state.captchaRun).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Awaiting Admin Review")).toBeNull();
  expect(screen.queryByTestId("invitation-receipt")).toBeNull();
  expect(state.refresh).not.toHaveBeenCalled();
});

it("retains independent application and lookup drafts when switching modes", () => {
  render(view());
  fillDraft();
  fireEvent.click(
    screen.getByRole("tab", { name: "Check existing application" }),
  );
  expect(document.querySelector('[name="firstName"]')).toBeNull();
  input("#crew-email", "other@example.test");
  fireEvent.click(screen.getByRole("tab", { name: "New application" }));
  expect(
    document.querySelector<HTMLInputElement>('[name="alternativeNames"]')!
      .value,
  ).toBe("巡查同学");
  expect(
    document.querySelector<HTMLTextAreaElement>("#crew-message")!.value,
  ).toBe("Keep my application answers");
  expect(document.querySelector<HTMLInputElement>("#crew-email")!.value).toBe(
    "Crew@Example.Test",
  );
  fireEvent.click(
    screen.getByRole("tab", { name: "Check existing application" }),
  );
  expect(document.querySelector<HTMLInputElement>("#crew-email")!.value).toBe(
    "other@example.test",
  );
});

it("requires mailbox verification for an existing application using the status CAPTCHA action", async () => {
  render(view());
  fireEvent.click(
    screen.getByRole("tab", { name: "Check existing application" }),
  );
  input("#crew-email", "Crew@Example.Test");
  expect(state.captchaAction).toBe("crew.status");
  await sent();
  expect(state.request).toHaveBeenCalledWith({
    email: "crew@example.test",
    captchaGrant: "captcha-grant",
  });
  expect(state.apply).not.toHaveBeenCalled();
  expect(state.verify).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
  expect(screen.queryByText("Awaiting Admin Review")).toBeNull();
});

it("normalizes lowercase and pasted O/1 mailbox aliases with the shared five-character rule", async () => {
  render(view());
  fillDraft();
  await sent();
  fireEvent.paste(document.querySelector("#crew-code")!, {
    clipboardData: { getData: () => " o-1 ab c " },
  });
  expect(document.querySelector<HTMLInputElement>("#crew-code")!.value).toBe(
    "0IABC",
  );
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() =>
    expect(state.verify).toHaveBeenCalledWith({
      email: "crew@example.test",
      code: "0IABC",
    }),
  );
  expect(screen.getByText("Awaiting Admin Review")).toBeTruthy();
  expect(screen.getByText(en.public.applicationRetryNotice)).toBeTruthy();
});

it("refreshes status explicitly using the verified proof, then exposes the approved receipt", async () => {
  render(view());
  fillDraft();
  await sent();
  await verified();
  expect(state.refresh).not.toHaveBeenCalled();
  expect(screen.queryByTestId("invitation-receipt")).toBeNull();
  state.refresh.mockResolvedValueOnce(available);
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() =>
    expect(screen.getByTestId("invitation-receipt").textContent).toContain(
      "0IABC",
    ),
  );
  expect(state.refresh).toHaveBeenCalledTimes(1);
  expect(state.refresh).toHaveBeenCalledWith({
    email: "crew@example.test",
    statusProof: proof,
  });
});

for (const [status, invitationState, title, body] of [
  ["REJECTED", undefined, "Application Not Approved", "Contact the team"],
  ["NOT_FOUND", undefined, "No Application Found", "start a new application"],
  ["ACCEPTED", "USED", "Invitation Already Used", "Sign in"],
  ["ACCEPTED", "EXPIRED", "Invitation Expired", "request a new invitation"],
  ["ACCEPTED", "UNAVAILABLE", "Invitation Unavailable", "Contact the team"],
] as const) {
  it(
    "explains " + (invitationState ?? status) + " without displaying a receipt",
    async () => {
      render(view());
      fillDraft();
      await sent();
      await verified({
        status,
        statusProof: proof,
        invitationState,
        invitation: available.invitation,
      });
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getAllByText(new RegExp(body)).length).toBeGreaterThan(0);
      expect(screen.queryByTestId("invitation-receipt")).toBeNull();
      if (invitationState === "USED")
        expect(
          screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
        ).toBe("/signin");
    },
  );
}

it("retains the cached review status after refresh failure while removing a stale receipt", async () => {
  render(view());
  fillDraft();
  await sent();
  await verified(available);
  expect(screen.getByTestId("invitation-receipt")).toBeTruthy();
  state.refresh.mockRejectedValueOnce(new Error("SIGNUP_MAIL_FAILED"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByText("Application Approved")).toBeTruthy();
  expect(screen.queryByTestId("invitation-receipt")).toBeNull();
  state.refresh.mockResolvedValueOnce(available);
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() =>
    expect(screen.getByTestId("invitation-receipt")).toBeTruthy(),
  );
});

it("recovers an expired proof through another mailbox verification instead of refreshing stale credentials", async () => {
  render(view());
  fillDraft();
  await sent();
  await verified(available);
  state.refresh.mockRejectedValueOnce(new Error("SIGNUP_CREW_INVALID"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      en.public.crewSignup.invalidCode,
    ),
  );
  expect(screen.queryByRole("button", { name: "Refresh status" })).toBeNull();
  expect(screen.queryByTestId("invitation-receipt")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Send a new verification code" }),
  );
  await waitFor(() =>
    expect(document.querySelector("#crew-code")).toBeTruthy(),
  );
  expect(state.request).toHaveBeenCalledWith({
    email: "crew@example.test",
    captchaGrant: "captcha-grant",
    resend: true,
  });
  expect(state.apply).toHaveBeenCalledTimes(1);
});

it("a failed resend invalidates the old receipt/proof and retains cached status for recovery", async () => {
  render(view());
  fillDraft();
  await sent();
  await verified(available);
  state.request.mockRejectedValueOnce(new Error("SIGNUP_MAIL_FAILED"));
  fireEvent.click(
    screen.getByRole("button", { name: "Send a new verification code" }),
  );
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByText("Application Approved")).toBeTruthy();
  expect(screen.queryByTestId("invitation-receipt")).toBeNull();
  expect(screen.queryByRole("button", { name: "Refresh status" })).toBeNull();
});

it("failed delivery and invalid verification preserve the draft and code for explicit recovery", async () => {
  render(view());
  fillDraft();
  state.apply.mockRejectedValueOnce(new Error("SIGNUP_MAIL_FAILED"));
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(
    document.querySelector<HTMLTextAreaElement>("#crew-message")!.value,
  ).toBe("Keep my application answers");
  await sent();
  input("#crew-code", "abcde");
  state.verify.mockRejectedValueOnce(new Error("SIGNUP_CREW_INVALID"));
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      en.public.crewSignup.invalidCode,
    ),
  );
  expect(document.querySelector<HTMLInputElement>("#crew-code")!.value).toBe(
    "ABCDE",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Back to application options" }),
  );
  expect(
    document.querySelector<HTMLInputElement>('[name="preferredName"]')!.value,
  ).toBe("Casey");
  expect(document.querySelector<HTMLInputElement>("#crew-email")!.value).toBe(
    "Crew@Example.Test",
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("prevents same-tick duplicate submission and freezes drafts while a write is pending", async () => {
  let resolve!: (value: { ok: boolean }) => void;
  state.apply.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(view());
  fillDraft();
  const form = document.querySelector("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(state.apply).toHaveBeenCalledTimes(1);
  expect(document.querySelector("#crew-email")!.matches(":disabled")).toBe(
    true,
  );
  expect(
    screen
      .getByRole("tab", { name: "Check existing application" })
      .matches(":disabled"),
  ).toBe(true);
  await act(async () => resolve({ ok: true }));
  expect(document.querySelector("#crew-code")).toBeTruthy();
});

it("keeps the CAPTCHA panel interactive while application fields are frozen", () => {
  state.captchaPending = true;
  render(view());
  expect(document.querySelector("#crew-email")!.matches(":disabled")).toBe(
    true,
  );
  expect(
    screen
      .getByRole("button", { name: "Complete CAPTCHA" })
      .matches(":disabled"),
  ).toBe(false);
});

it("localizes crew-disabled guidance and email verification in Chinese", async () => {
  render(view("zh"));
  fillDraft();
  state.apply.mockRejectedValueOnce(new Error("CREW_DISABLED"));
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      zh.public.crewSignup.disabled,
    ),
  );
  await sent();
  expect(screen.getByRole("heading", { name: "验证邮箱" })).toBeTruthy();
  expect(screen.getByText(zh.public.crewSignup.verifyHint)).toBeTruthy();
});
