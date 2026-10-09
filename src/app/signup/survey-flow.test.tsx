/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { SigninAccess } from "./signin-access";
import { StudentRegistration } from "./student-registration";
vi.mock("~/app/_actions/auth", () => ({ switchToStudentSignin: vi.fn() }));

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  pending: false,
  data: undefined as undefined | { invitationId: string },
  error: null as null | { message: string },
  settled: undefined as undefined | (() => void),
  period: { kind: "quarter", label: "2026–27 Q3" },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    accountInvitation: {
      fromSurvey: {
        useMutation: (options: { onSettled: () => void }) => {
          mocks.settled = options.onSettled;
          return {
            mutate: mocks.confirm,
            isPending: mocks.pending,
            data: mocks.data,
            error: mocks.error,
          };
        },
      },
    },
    tutee: {
      inspectSurvey: {
        useQuery: () => ({
          data: {
            email: "student@example.test",
            name: "Student One",
            subjects: ["Mathematics"],
            preferredContact: "student@example.test",
            slots: [
              {
                id: "slot",
                dayOfWeek: 1,
                startMin: 960,
                endMin: 1020,
                label: "After School",
              },
            ],
            submittedAt: new Date("2026-09-08T00:00:00Z"),
            needsAccount: true,
            period: mocks.period,
          },
        }),
      },
      resendSurvey: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
const wrap = (child: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      {child}
    </NextIntlClientProvider>,
  );
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.pending = false;
  mocks.data = undefined;
  mocks.error = null;
  mocks.period = { kind: "quarter", label: "2026–27 Q3" };
});
it("keeps the semester label during review", () => {
  mocks.period = { kind: "semester", label: "2026–27 S2" };

  wrap(<StudentRegistration token={"a".repeat(64)} />);
  expect(screen.getByText("Semester · 2026–27 S2")).toBeTruthy();
  expect(screen.queryByText(/Quarter ·/)).toBeNull();
});
it("offers a sign-in button, readable link, and downloadable QR without exposing verification tokens", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  wrap(<SigninAccess />);
  expect(
    screen.getByRole("link", { name: "Go to Sign In" }).getAttribute("href"),
  ).toBe("/signin");
  expect(
    screen.getByRole("link", { name: "Save QR Code" }).getAttribute("download"),
  ).toBe("student-signin.png");
  expect(screen.getByRole("img").getAttribute("src")).toBe("/api/signin-qr");
  fireEvent.click(screen.getByRole("button", { name: "Copy Sign-In Link" }));
  await screen.findByRole("button", { name: "Link Copied" });
  expect(writeText).toHaveBeenCalledWith(
    new URL("/signin", window.location.origin).href,
  );
});
it("keeps a readable link if clipboard access fails", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(Error("Denied")) },
  });
  wrap(<SigninAccess />);
  fireEvent.click(screen.getByRole("button", { name: "Copy Sign-In Link" }));
  expect(await screen.findByRole("status")).toBeTruthy();
});
it("never automatically consumes the link and explicitly emails a distinct invitation", () => {
  const { container } = wrap(<StudentRegistration token={"a".repeat(64)} />);
  expect(container.querySelector("input[type=password]")).toBeNull();
  expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.submit(container.querySelector("form")!);
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  expect(mocks.confirm).toHaveBeenCalledWith({ token: "a".repeat(64) });
});
it("keeps the request review mounted after failure and freezes pending confirmation", () => {
  const { container, rerender } = wrap(
    <StudentRegistration token={"a".repeat(64)} />,
  );
  mocks.pending = true;
  rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <StudentRegistration token={"a".repeat(64)} />
    </NextIntlClientProvider>,
  );
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  expect(screen.getByText("Student One")).toBeTruthy();
  mocks.pending = false;
  mocks.error = { message: "INVITATION_INVALID" };
  act(() => mocks.settled!());
  rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <StudentRegistration token={"a".repeat(64)} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByText("Student One")).toBeTruthy();
});
it("enters shared redemption with the exact invitation and signed-in state", () => {
  mocks.data = { invitationId: "tutee-invitation" };
  wrap(
    <StudentRegistration
      token={"a".repeat(64)}
      signedInEmail="student@example.test"
    />,
  );
  expect(
    screen.getByText("Shared invitation tutee-invitation signed in"),
  ).toBeTruthy();
});
vi.mock("../register/invitation-redemption", () => ({
  InvitationRedemption: ({
    invitationId,
    signedIn,
  }: {
    invitationId: string;
    signedIn: boolean;
  }) => (
    <p>
      Shared invitation {invitationId} {signedIn ? "signed in" : "signed out"}
    </p>
  ),
}));

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
