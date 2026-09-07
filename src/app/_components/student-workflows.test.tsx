// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PolicyConsent } from "./policy-consent";
const mocks = vi.hoisted(() => ({
  policy: vi.fn(),
  accept: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    student: {
      policy: { useQuery: mocks.policy },
      acceptPolicy: {
        useMutation: () => ({ mutate: mocks.accept, isPending: false }),
      },

    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.policy.mockReturnValue({
    data: {
      accepted: false,
      revision: "current-revision",
      documents: [{ locale: "en", title: "Policy", body: "Read these rules." }],
    },
    refetch: mocks.refetch,
  });
});
afterEach(cleanup);
it("unaccepted policy keeps enrollment controls behind explicit consent", () => {
  render(
    <PolicyConsent slug="tutee-policy">
      <button>Enroll Now</button>
    </PolicyConsent>,
  );
  expect(screen.queryByText("Enroll Now")).toBeNull();
  expect(screen.getByText("Read these rules.")).toBeTruthy();
});
it("consent submits the displayed revision and the entered signature", () => {
  render(<PolicyConsent slug="tutee-policy" />);
  fireEvent.change(screen.getByRole("textbox", { name: "signature" }), {
    target: { value: "Student Tester" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "accept" }).closest("form")!,
  );
  expect(mocks.accept).toHaveBeenCalledWith({
    slug: "tutee-policy",
    revision: "current-revision",
    signature: "Student Tester",
  });
});
it("accepted consent reveals enrollment without another signature", () => {
  mocks.policy.mockReturnValue({
    data: { accepted: true, revision: "current-revision", documents: [] },
  });
  render(
    <PolicyConsent slug="tutee-policy">
      <button>Enroll Now</button>
    </PolicyConsent>,
  );
  expect(screen.getByText("Enroll Now")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("a missing policy shows the server error without opening enrollment", () => {
  mocks.policy.mockReturnValue({
    error: { message: "Publish a policy first." },
  });
  render(
    <PolicyConsent slug="tutee-policy">
      <button>Enroll Now</button>
    </PolicyConsent>,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Publish a policy first.",
  );
  expect(screen.queryByText("Enroll Now")).toBeNull();
});
