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
import { EmailDetails } from "./email-details";
import { ReadOnlyProvider } from "./read-only";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  setup: vi.fn(),
  mounted: vi.fn(),
  copy: vi.fn(),
  history: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    student: { acceptanceRecords: { useQuery: mocks.history } },
    admin: {
      sendAccountVerification: {
        useMutation: () => {
          mocks.mounted();
          return { mutate: mocks.verify };
        },
      },
      sendTutorSetup: { useMutation: () => ({ mutate: mocks.setup }) },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy },
  });
  mocks.copy.mockResolvedValue(undefined);
  mocks.history.mockReturnValue({
    data: { current: [], rows: [], more: false },
  });
});
afterEach(cleanup);
it("moves the full academic record into User Details without needing an email or login", () => {
  show({ email: null, showPolicyHistory: true, academic: {
    status: "REPORTED", gradeLevel: 10, rawGrade: null, schoolYear: "26-27",
    expectedGraduationYear: 2029, confirmedAt: null, needsConfirmation: true,
  } });
  expect(screen.queryByText("Grade 10")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "User details" }));
  expect(screen.getByRole("heading", { name: "Academic Details" })).toBeTruthy();
  expect(screen.getByText("Grade 10")).toBeTruthy();
  expect(screen.getByText("School year 26-27")).toBeTruthy();
  expect(screen.getByText("Expected graduation: 2029")).toBeTruthy();
  expect(screen.getByText(en.academics.needsConfirmation)).toBeTruthy();
});
it("opens policy history by account ID even when email is missing, without cross-user carryover", () => {
  const view = show({
    email: null,
    userId: "first-user",
    showPolicyHistory: true,
  });
  expect(mocks.history).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "User details" }));
  expect(
    screen.getByRole("dialog", { name: "User details · Alice" }),
  ).toBeTruthy();
  expect(screen.getByText("No email")).toBeTruthy();
  expect(mocks.history).toHaveBeenLastCalledWith({
    userId: "first-user",
    page: 0,
  });
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <EmailDetails
        email={null}
        name="Bob"
        userId="second-user"
        showPolicyHistory
      />
    </NextIntlClientProvider>,
  );
  expect(mocks.history).toHaveBeenLastCalledWith({
    userId: "second-user",
    page: 0,
  });
});
const address = "a.very.long.email.address.for.a.person@example.test";
it("labels masked observer contact details as private without exposing email controls", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ReadOnlyProvider value={true}>
        <EmailDetails
          email={address}
          name="Alice"
          userId="hidden-user"
          showPolicyHistory
        />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("Private contact details")).toBeTruthy();
  expect(screen.queryByText(address)).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(mocks.mounted).not.toHaveBeenCalled();
  expect(mocks.history).not.toHaveBeenCalled();
});
const show = (props: Partial<Parameters<typeof EmailDetails>[0]> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EmailDetails email={address} name="Alice" {...props} />
    </NextIntlClientProvider>,
  );

it("keeps long emails and mutation observers out of the closed roster cell, opens a labelled dialog and closes it", () => {
  show();
  expect(screen.queryByText(address)).toBeNull();
  expect(mocks.mounted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Show email" }));
  expect(screen.getByRole("dialog", { name: "Email · Alice" })).toBeTruthy();
  expect(screen.getByText(address)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.verify).not.toHaveBeenCalled();
});

it("copies the exact address and handles missing or synchronously denied clipboard APIs", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Show email" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy email" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Email copied."),
  );
  expect(mocks.copy).toHaveBeenCalledWith(address);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  fireEvent.click(screen.getByRole("button", { name: "Copy email" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Select the email",
    ),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: () => {
        throw new Error("Denied");
      },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Copy email" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("only sends verification on click and sends the account ID instead of a client-chosen address", () => {
  show({ linked: true, userId: "person-id", canSendSetup: true });
  fireEvent.click(screen.getByRole("button", { name: "Show email" }));
  expect(mocks.verify).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification & setup link" }),
  );
  expect(mocks.verify).toHaveBeenCalledWith({ userId: "person-id" });
  expect(mocks.setup).not.toHaveBeenCalled();
});

it("does not create links or send verification for an unlinked tutor contact", () => {
  show({ tutorId: "unlinked-tutor", canSendSetup: true });
  fireEvent.click(screen.getByRole("button", { name: "Show email" }));
  expect(screen.getByText("Account setup required")).toBeTruthy();
  expect(
    screen
      .getByRole("link", {
        name: "Manage account invitations in Users & Roles.",
      })
      .getAttribute("href"),
  ).toBe("/admin/users");
  expect(
    screen.queryByRole("button", { name: "Send verification & setup link" }),
  ).toBeNull();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.setup).not.toHaveBeenCalled();
});

it("treats historical contact addresses neutrally and hides verification for verified/read-only identities", () => {
  show({ contactOnly: true, canSendSetup: true, userId: "person-id" });
  fireEvent.click(screen.getByRole("button", { name: "Show email" }));
  expect(
    screen.getByText("Contact address recorded with this entry"),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Send verification & setup link" }),
  ).toBeNull();
  cleanup();
  show({
    linked: true,
    userId: "person-id",
    verifiedAt: new Date(),
    canSendSetup: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Show email" }));
  expect(screen.getByText("Email verified")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Send verification & setup link" }),
  ).toBeNull();
});
