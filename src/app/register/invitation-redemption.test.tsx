/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { InvitationRedemption } from "./invitation-redemption";
const mocks = vi.hoisted(() => ({
  inspect:
    vi.fn<
      (input: { invitationId: string; proof?: string }) => Promise<unknown>
    >(),
  complete: vi.fn(),
  verify: vi.fn(),
  invalidate: vi.fn(),
  login: vi.fn(),
  verified: undefined as undefined | ((result: { proof: string }) => void),
  verificationSettled: undefined as undefined | (() => void),
  completed: undefined as undefined | (() => void),
}));
vi.mock("./actions", () => ({
  invitationSignIn: mocks.login,
  switchInvitationAccount: vi.fn(),
}));
vi.mock("~/app/_components/profile-policy", () => ({
  useProfilePolicy: () => ({ offeredGrades: [10], isLoading: false }),
  ProfilePolicyLoadError: () => null,
  OfferedGradeSelect: () => null,
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => ({
        studentWorkflow: { continuationStatus: { reset: mocks.invalidate } },
      }),
      accountInvitation: {
        review: {
          useMutation: () =>
            useMutation({
              mutationFn: (input: { invitationId: string; proof?: string }) =>
                mocks.inspect(input),
            }),
        },
        verify: {
          useMutation: (options: {
            onSuccess: (result: { proof: string }) => void;
            onSettled: () => void;
          }) => {
            mocks.verified = options.onSuccess;
            mocks.verificationSettled = options.onSettled;
            return { mutate: mocks.verify };
          },
        },
        complete: {
          useMutation: (options: { onSuccess: () => void }) => {
            mocks.completed = options.onSuccess;
            return { mutate: mocks.complete };
          },
        },
      },
    },
  };
});
let client: QueryClient;
function TestInvitationRedemption(
  props: ComponentProps<typeof InvitationRedemption>,
) {
  return (
    <QueryClientProvider client={client}>
      <InvitationRedemption {...props} />
    </QueryClientProvider>
  );
}
const staged = {
  id: "request",
  expectedVersion: 2,
  originalPriority: new Date("2026-10-01T10:00:00Z"),
  answers: {
    englishName: "Request-local Display",
    firstName: "Posted",
    lastName: "Answers",
    preferredName: "Posted preferred",
    alternativeNames: "Posted aliases",
    preferredLatinName: "PostedLatin",
    email: "canonical@example.test",
    gradeLevel: "10",
    phone: "5550100",
    preferredContact: "Posted contact",
    firstChoiceId: "math",
    secondChoiceId: "science",
    slotIds: ["monday"],
    signatureName: "Posted signature",
    agreed: true as const,
    policyRevision: "saved-policy",
  },
  policySnapshot: [
    {
      locale: "en",
      title: "Exact saved consent",
      body: "The immutable consent text.",
      version: "1",
    },
  ],
  subjects: [
    { id: "math", name: "Retired Mathematics" },
    { id: "science", name: "Science" },
  ],
  slots: [
    {
      id: "monday",
      label: "After school",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  ],
};
const info = {
  kind: "TUTEE",
  existing: true,
  completed: false,
  email: "canonical@example.test",
  name: "Canonical Account",
  firstName: "Canonical",
  lastName: "Account",
  preferredName: "Canonical preferred",
  alternativeNames: "Canonical aliases",
  gradeLevel: 11,
  requiresSignIn: false,
  needsPassword: false,
  acceptedIdentity: true,
  completionProof: "memory-only-proof",
  signupRequest: staged,
};
const view = () => (
  <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
    <TestInvitationRedemption invitationId="invitation" signedIn />
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no layout scrolling; focus behavior uses the browser API.
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mocks.inspect.mockResolvedValue(info);
  mocks.login.mockResolvedValue({ signedIn: true, completedLogin: false });
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});
it("shows reusable sign-in access only after completed tutee account review", async () => {
  mocks.inspect.mockResolvedValue({ ...info, completed: true });
  render(view());
  expect(
    await screen.findByRole("region", { name: en.survey.signinAccess }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.accountInvitation.accept }),
  ).toBeNull();
  expect(mocks.complete).not.toHaveBeenCalled();
});
it("shows exact staged answers and consent separately from canonical account identity before acceptance", async () => {
  render(view());
  const review = await screen.findByRole("region", {
    name: en.signupEditing.replacementReview,
  });
  for (const value of [
    "Request-local Display",
    "Posted preferred",
    "Posted aliases",
    "PostedLatin",
    "Posted contact",
    "5550100",
    "Retired Mathematics",
    "Posted signature",
    "The immutable consent text.",
  ])
    expect(within(review).getByText(value)).toBeTruthy();
  expect(
    within(review).getByText(
      `${en.signupEditing.policyRevision}: saved-policy`,
    ),
  ).toBeTruthy();
  expect(screen.getByText("Canonical Account")).toBeTruthy();
  expect(screen.getByText(/Original priority retained:/)).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: /password/i })).toBeNull();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: en.survey.stepReview }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("region", { name: en.survey.signinAccess }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.accountInvitation.accept })
      .closest("form")!,
  );
  expect(mocks.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      firstName: "Canonical",
      lastName: "Account",
      gradeLevel: 11,
      reviewed: true,
    }),
  );
  expect(mocks.complete.mock.calls[0]?.[0]).not.toHaveProperty("password");
});
it("never renders source answers before a proof-authorized inspection", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TestInvitationRedemption invitationId="invitation" />
    </NextIntlClientProvider>,
  );
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(screen.queryByText("Posted signature")).toBeNull();
  expect(screen.queryByText("Request-local Display")).toBeNull();
  expect(mocks.complete).not.toHaveBeenCalled();
});
it("preserves legacy invitation review when there is no staged replacement", async () => {
  mocks.inspect.mockResolvedValue({ ...info, signupRequest: undefined });
  render(view());
  await screen.findByText("Canonical Account");
  expect(
    screen.queryByRole("region", { name: en.signupEditing.replacementReview }),
  ).toBeNull();
  expect(screen.getByText("Canonical Account")).toBeTruthy();
});

it("discards cached continuation eligibility only after generic mailbox verification succeeds", async () => {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TestInvitationRedemption invitationId="invitation" />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText(/^Email verification code/), {
    target: { value: "ABC123" },
  });
  fireEvent.change(
    screen.getByLabelText(new RegExp(`^${en.accountInvitation.email}`)),
    {
      target: { value: "canonical@example.test" },
    },
  );
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.accountInvitation.verify })
      .closest("form")!,
  );
  expect(mocks.invalidate).not.toHaveBeenCalled();
  act(() => mocks.verificationSettled!());
  expect(screen.getByDisplayValue("ABC123")).toBeTruthy();
  expect(mocks.invalidate).not.toHaveBeenCalled();
  await act(async () => mocks.verified!({ proof: "verified-proof" }));
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  expect(mocks.login).toHaveBeenCalledWith({
    invitationId: "invitation",
    proof: "verified-proof",
  });
  expect(screen.getByText("Canonical Account")).toBeTruthy();
});

it.each(["TUTEE", "CREW"])(
  "refreshes continuation after completed %s review only when needed",
  async (kind) => {
    mocks.inspect.mockResolvedValue({ ...info, kind });
    render(view());
    await screen.findByText("Canonical Account");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(
      screen
        .getByRole("button", { name: en.accountInvitation.accept })
        .closest("form")!,
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
    await act(async () => mocks.completed!());
    expect(mocks.invalidate).toHaveBeenCalledTimes(kind === "TUTEE" ? 1 : 0);
    expect(mocks.login).toHaveBeenCalledWith({
      invitationId: "invitation",
      proof: info.completionProof,
    });
  },
);

it("retains successful proof and session recovery when continuation refresh fails", async () => {
  mocks.invalidate.mockRejectedValue(new Error("Read failed"));
  mocks.login.mockResolvedValue({ signedIn: false, completedLogin: false });
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TestInvitationRedemption invitationId="invitation" />
    </NextIntlClientProvider>,
  );
  await act(async () => mocks.verified!({ proof: "verified-proof" }));
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  expect(screen.getByText("Canonical Account")).toBeTruthy();
  expect(mocks.inspect).toHaveBeenCalledWith({
    invitationId: "invitation",
    proof: "verified-proof",
  });
});

it("keeps verification blocked while the authorized initial review is pending", async () => {
  let resolve!: (value: typeof info) => void;
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise<typeof info>((yes) => {
        resolve = yes;
      }),
  );
  const rendered = render(view());
  const verify = screen.getByRole<HTMLButtonElement>("button", {
    name: en.accountInvitation.verify,
  });
  await waitFor(() => expect(verify.matches(":disabled")).toBe(true));
  rendered.rerender(view());
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  fireEvent.submit(verify.closest("form")!);
  expect(mocks.verify).not.toHaveBeenCalled();
  await act(async () => resolve(info));
  await screen.findByText("Canonical Account");
  expect(screen.getByRole("checkbox").matches(":disabled")).toBe(false);
});

it("does not attach a late review to a different invitation or a reopened flow", async () => {
  let resolveOld!: (value: typeof info) => void;
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise<typeof info>((yes) => {
        resolveOld = yes;
      }),
  );
  const invitationView = (invitationId: string) => (
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <TestInvitationRedemption invitationId={invitationId} signedIn />
    </NextIntlClientProvider>
  );
  const rendered = render(invitationView("old-invitation"));
  await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(1));
  mocks.inspect.mockResolvedValue({ ...info, name: "Current Account" });
  rendered.rerender(invitationView("current-invitation"));
  await screen.findByText("Current Account");
  await act(async () => resolveOld({ ...info, name: "Late private identity" }));
  expect(screen.queryByText("Late private identity")).toBeNull();
  expect(screen.getByText("Current Account")).toBeTruthy();
  rendered.unmount();
  render(invitationView("old-invitation"));
  await screen.findByText("Current Account");
  expect(screen.queryByText("Late private identity")).toBeNull();
  expect(mocks.complete).not.toHaveBeenCalled();
});
