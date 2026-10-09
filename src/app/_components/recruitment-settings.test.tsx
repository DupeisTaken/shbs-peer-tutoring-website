// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecruitmentSettings } from "./recruitment-settings";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn(), fetch: vi.fn(), error: null as null | { message: string; data: { approvalId: string } } }));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTimeZone: () => "Asia/Shanghai",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { currentPeriod: { invalidate: mocks.invalidate, fetch: mocks.fetch } },
      application: { options: { invalidate: mocks.invalidate } },
      tutee: { signupOptions: { invalidate: mocks.invalidate } },
    }),
    program: {
      setSignupWindow: { useMutation: () => ({ mutate: mocks.mutate, error: mocks.error }) },
    },
  },
}));
beforeEach(() => { vi.clearAllMocks(); mocks.error = null; });
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

it("keeps Coordinator recruitment fields read-only even for a direct form submit", () => {
  const { container } = render(<RecruitmentSettings termId="term" audience="tutor" window={window} canEdit={false} canApply={false} />);
  expect(screen.getByLabelText("enabled").closest("fieldset")?.disabled).toBe(true);
  fireEvent.submit(container.querySelector("form")!);
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("retains an Admin proposal draft without announcing a successful settings save", () => {
  mocks.error = { message: "Queued", data: { approvalId: "proposal-1" } };
  render(<RecruitmentSettings termId="term" audience="tutor" window={window} canEdit canApply={false} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://example.test/preview" } });
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("https://example.test/preview");
  expect(screen.getByRole("status").textContent).toBe("queuedBody");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "requestHead" })).toBeTruthy();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("keeps an Admin's recruitment draft across a changed live window and failed reload", async () => {
  mocks.error = { message: "Queued", data: { approvalId: "request" } };
  const view = render(<RecruitmentSettings termId="term" audience="tutor" window={window} canEdit canApply={false} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://example.test/draft" } });
  view.rerender(<RecruitmentSettings termId="new-term" audience="tutor" window={{ ...window, enabled: false, previewUrl: "https://example.test/live" }} canEdit canApply={false} />);
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("https://example.test/draft");
  expect(screen.getByRole("status").textContent).toBe("queuedBody");
  mocks.fetch.mockRejectedValueOnce(new Error("Reload failed"));
  fireEvent.click(screen.getByRole("button", { name: "reload" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Reload failed"));
  fireEvent.submit(view.container.querySelector("form")!);
  expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ expectedTermId: "term", previewUrl: "https://example.test/draft" }));
  mocks.fetch.mockResolvedValueOnce({ termId: "new-term", recruitment: { tutor: { ...window, enabled: false, previewUrl: "https://example.test/live" } } });
  fireEvent.click(screen.getByRole("button", { name: "reload" }));
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("https://example.test/live"));
  fireEvent.submit(view.container.querySelector("form")!);
  expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ expectedTermId: "new-term" }));
});
