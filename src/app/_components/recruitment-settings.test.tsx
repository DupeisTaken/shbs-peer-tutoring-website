// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecruitmentSettings } from "./recruitment-settings";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn() }));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTimeZone: () => "Asia/Shanghai",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { currentPeriod: { invalidate: mocks.invalidate } },
      application: { options: { invalidate: mocks.invalidate } },
      tutee: { signupOptions: { invalidate: mocks.invalidate } },
    }),
    program: {
      setSignupWindow: { useMutation: () => ({ mutate: mocks.mutate }) },
    },
  },
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
const window = {
  enabled: true,
  opensAt: null,
  closesAt: null,
  previewUrl: null,
};
it.each(["tutor", "tutee"] as const)(
  "saves independent %s controls in the program timezone without requiring an external sheet",
  (audience) => {
    const { container } = render(
      <RecruitmentSettings termId="term" audience={audience} window={window} />,
    );
    fireEvent.click(
      screen.getByLabelText("start", { selector: 'input[type="checkbox"]' }),
    );
    fireEvent.click(
      screen.getByLabelText("end", { selector: 'input[type="checkbox"]' }),
    );
    fireEvent.change(
      screen.getByLabelText(/^start/, {
        selector: 'input[type="datetime-local"]',
      }),
      { target: { value: "2026-09-23T09:00" } },
    );
    fireEvent.change(
      screen.getByLabelText(/^end/, {
        selector: 'input[type="datetime-local"]',
      }),
      { target: { value: "2026-09-24T17:00" } },
    );
    fireEvent.click(screen.getByLabelText("enabled"));
    fireEvent.submit(container.querySelector("form")!);
    expect(mocks.mutate).toHaveBeenCalledWith({
      audience,
      expectedTermId: "term",
      enabled: false,
      opensAt: new Date("2026-09-23T01:00:00Z"),
      closesAt: new Date("2026-09-24T09:00:00Z"),
      previewUrl: null,
    });
    // Disabling a bound clears it in the submitted configuration, even if its draft still has a value.
    fireEvent.click(
      screen.getByLabelText("start", { selector: 'input[type="checkbox"]' }),
    );
    fireEvent.click(
      screen.getByLabelText("end", { selector: 'input[type="checkbox"]' }),
    );
    fireEvent.submit(container.querySelector("form")!);
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ opensAt: null, closesAt: null }),
    );
  },
);
it("rejects reversed dates before sending a save", () => {
  const { container } = render(
    <RecruitmentSettings
      termId="term"
      audience="tutor"
      window={{
        ...window,
        opensAt: new Date("2026-10-01"),
        closesAt: new Date("2026-09-01"),
      }}
    />,
  );
  fireEvent.submit(container.querySelector("form")!);
  expect(screen.getByRole("alert").textContent).toBe("invalidOrder");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
