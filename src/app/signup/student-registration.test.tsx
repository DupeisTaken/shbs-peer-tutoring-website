/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { StudentRegistration } from "./student-registration";
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), verify: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: {
        continuationStatus: {
          reset: vi.fn().mockResolvedValue(undefined),
        },
      },
    }),
    tutee: { inspectSurvey: { useQuery: mocks.inspect } },
    accountInvitation: { fromSurvey: { useMutation: () => ({}) } },
  },
}));
vi.mock("./survey-verification", () => ({
  SurveyVerification: ({
    email,
    intentId,
  }: {
    email: string;
    intentId?: string;
  }) => (
    <p data-testid="mailbox-step">
      {email} / {intentId}
    </p>
  ),
}));
vi.mock("./survey-resend", () => ({ SurveyResend: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("an intent id and typed email reveal no submitted answers before mailbox proof", () => {
  mocks.inspect.mockReturnValue({
    data: { payload: { englishName: "Private original answers" } },
  });
  const mounted = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StudentRegistration
        token=""
        intentId="public-intent-id"
        signedInEmail="signed-in@example.test"
      />
    </NextIntlClientProvider>,
  );
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(screen.queryByText("Private original answers")).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("");
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.submit(mounted.container.querySelector("form")!);
  expect(screen.getByTestId("mailbox-step").textContent).toBe(
    "owner@example.test / public-intent-id",
  );
  expect(mocks.inspect).not.toHaveBeenCalled();
});
it("retains the legacy exact-token inspection path", () => {
  mocks.inspect.mockReturnValue({ isLoading: true });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StudentRegistration token={"a".repeat(64)} />
    </NextIntlClientProvider>,
  );
  expect(mocks.inspect).toHaveBeenCalledWith(
    { token: "a".repeat(64) },
    expect.objectContaining({ enabled: true }),
  );
});
