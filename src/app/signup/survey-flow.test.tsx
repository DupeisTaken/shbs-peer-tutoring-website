/** @vitest-environment jsdom */
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { SigninAccess } from "./signin-access";
import { StudentRegistration } from "./student-registration";
vi.mock("~/app/_actions/auth", () => ({ switchToStudentSignin: vi.fn() }));

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  needsAccount: true,
  success: false,
}));
vi.mock("~/trpc/react", () => ({
  api: {
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
            needsAccount: mocks.needsAccount,
          },
        }),
      },
      confirmSurvey: {
        useMutation: () => ({
          mutate: mocks.confirm,
          isSuccess: mocks.success,
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
  mocks.needsAccount = true;
  mocks.success = false;
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
it("requires a password only for a new account and never automatically consumes the link", () => {
  wrap(<StudentRegistration token={"a".repeat(64)} />);
  expect(
    screen
      .getByLabelText("Password (at Least 8 Characters)")
      .getAttribute("required"),
  ).not.toBeNull();
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("confirms an existing account request without sending a password", () => {
  mocks.needsAccount = false;
  wrap(<StudentRegistration token={"a".repeat(64)} />);
  expect(
    screen.queryByLabelText("Password (at Least 8 Characters)"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Confirm Request" }));
  expect(mocks.confirm).toHaveBeenCalledWith({ token: "a".repeat(64) });
});
it("places the sign-in button and QR on the completed-account confirmation", () => {
  mocks.success = true;
  wrap(<StudentRegistration token={"a".repeat(64)} />);
  expect(
    screen.getByRole("heading", { name: "Your Request Is Confirmed" }),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: "Save QR Code" })).toBeTruthy();
});
it("offers explicit switching on shared devices after confirmation", () => {
  mocks.success = true;
  wrap(
    <StudentRegistration
      token={"a".repeat(64)}
      signedInEmail="other@example.test"
    />,
  );
  expect(
    screen.getByRole("button", { name: "Switch Account and Sign In" }),
  ).toBeTruthy();
  expect(screen.getByText(/signed in as other@example.test/)).toBeTruthy();
});
it("links an already signed-in participant directly to their tutoring page", () => {
  mocks.success = true;
  wrap(
    <StudentRegistration
      token={"a".repeat(64)}
      signedInEmail="student@example.test"
    />,
  );
  expect(
    screen.getByRole("link", { name: "View My Tutoring" }).getAttribute("href"),
  ).toBe("/student");
});
