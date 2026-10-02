// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  missing: false,
  failed: false,
  retry: vi.fn(),
  me: { role: "TUTOR", canTranslate: true },
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () => ({
          data: state.missing ? undefined : state.me,
          error: state.failed ? { message: "Refresh failed" } : null,
          refetch: state.retry,
        }),
      },
    },
  },
}));
vi.mock("./translation-strings", () => ({
  TranslationStrings: () => (
    <div>
      string-editor
      <input aria-label="Translation draft" defaultValue="" />
    </div>
  ),
}));
vi.mock("./translation-composer", () => ({
  TranslationComposer: () => <div>website-editor</div>,
}));
vi.mock("./translation-review", () => ({
  TranslationReview: () => <div>draft-review</div>,
}));
vi.mock("./languages-panel", () => ({
  LanguagesPanel: ({ canAdd }: { canAdd: boolean }) => (
    <div>language-management{canAdd && <span>add-language</span>}</div>
  ),
}));
import { TranslationEditor } from "./translation-editor";
afterEach(() => {
  cleanup();
  state.failed = false;
  state.missing = false;
  vi.clearAllMocks();
});
it("offers retry after an initial access query failure without mounting editors", () => {
  state.missing = true;
  state.failed = true;
  render(<TranslationEditor />);
  expect(screen.getByRole("alert").textContent).toContain("Refresh failed");
  expect(screen.queryByText("string-editor")).toBeNull();
  expect(screen.queryByText("draft-review")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(state.retry).toHaveBeenCalledOnce();
});
it.each(["ADMIN", "HEAD", "COORDINATOR"])(
  "defaults to review without mounting text editors for unassigned %s",
  (role) => {
    state.me = { role, canTranslate: false };
    render(<TranslationEditor />);
    expect(screen.getByText("draft-review")).toBeTruthy();
    expect(screen.queryByText("string-editor")).toBeNull();
    expect(screen.queryByRole("tab", { name: "website" })).toBeNull();
  },
);
it.each(["ADMIN", "HEAD"])(
  "lets unassigned %s manage languages independently",
  (role) => {
    state.me = { role, canTranslate: false };
    render(<TranslationEditor />);
    fireEvent.click(screen.getByRole("tab", { name: "languagesHeading" }));
    expect(screen.getByText("language-management")).toBeTruthy();
    expect(screen.queryByText("string-editor")).toBeNull();
    expect(screen.queryByText("website-editor")).toBeNull();
    expect(screen.queryByText("add-language")).toBeNull();
  },
);
it("does not expose language administration to an unassigned coordinator", () => {
  state.me = { role: "COORDINATOR", canTranslate: false };
  render(<TranslationEditor />);
  expect(screen.queryByRole("tab", { name: "languagesHeading" })).toBeNull();
});
it("keeps adding languages available to assigned translators", () => {
  state.me = { role: "TUTOR", canTranslate: true };
  render(<TranslationEditor />);
  fireEvent.click(screen.getByRole("tab", { name: "languagesHeading" }));
  expect(screen.getByText("add-language")).toBeTruthy();
});
it("removes language administration after management rank is revoked", () => {
  state.me = { role: "ADMIN", canTranslate: false };
  const { rerender } = render(<TranslationEditor />);
  fireEvent.click(screen.getByRole("tab", { name: "languagesHeading" }));
  state.me = { role: "COORDINATOR", canTranslate: false };
  rerender(<TranslationEditor />);
  expect(screen.queryByText("language-management")).toBeNull();
  expect(screen.getByText("draft-review")).toBeTruthy();
});
it("keeps all three workflows in one assigned translator editor", () => {
  state.me = { role: "TUTOR", canTranslate: true };
  render(<TranslationEditor />);
  expect(screen.getByText("string-editor")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "website" }));
  expect(screen.getByText("website-editor")).toBeTruthy();
  expect(screen.getByText("string-editor").style.display).toBe("none");
  fireEvent.click(screen.getByRole("tab", { name: "review" }));
  expect(screen.getByText("draft-review")).toBeTruthy();
});
it("honors the review deep link and removes editing after assignment revocation", () => {
  state.me = { role: "ADMIN", canTranslate: true };
  const { rerender } = render(<TranslationEditor initialView="review" />);
  expect(screen.getByText("draft-review")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "strings" }));
  state.me = { role: "ADMIN", canTranslate: false };
  rerender(<TranslationEditor initialView="review" />);
  expect(screen.queryByText("string-editor")).toBeNull();
  expect(screen.getByText("draft-review")).toBeTruthy();
});
it.each(["TUTOR", "STUDENT", "VIEWER"])("denies unassigned %s", (role) => {
  state.me = { role, canTranslate: false };
  render(<TranslationEditor />);
  expect(screen.getByRole("alert").textContent).toBe("noAccess");
});

it("retains a visited editor draft and leaves arrow navigation manually activated", () => {
  state.me = { role: "ADMIN", canTranslate: true };
  render(<TranslationEditor />);
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Translation draft",
  });
  fireEvent.change(draft, { target: { value: "Unsaved translation" } });
  const strings = screen.getByRole("tab", { name: "strings" });
  const website = screen.getByRole("tab", { name: "website" });
  strings.focus();
  fireEvent.keyDown(strings, { key: "ArrowRight" });
  expect(document.activeElement).toBe(website);
  expect(strings.getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByText("website-editor")).toBeNull();
  fireEvent.click(website);
  expect(
    screen.queryByRole("textbox", { name: "Translation draft" }),
  ).toBeNull();
  fireEvent.click(strings);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Translation draft" })
      .value,
  ).toBe("Unsaved translation");
});

it("retains but disables drafts during cached access failures, and removes them on revocation", () => {
  state.me = { role: "ADMIN", canTranslate: true };
  const view = render(<TranslationEditor />);
  fireEvent.change(screen.getByRole("textbox", { name: "Translation draft" }), {
    target: { value: "Keep through retry" },
  });
  state.failed = true;
  view.rerender(<TranslationEditor />);
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Translation draft",
  });
  expect(draft.value).toBe("Keep through retry");
  expect(draft.matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(state.retry).toHaveBeenCalledOnce();
  state.failed = false;
  view.rerender(<TranslationEditor />);
  expect(draft.value).toBe("Keep through retry");
  expect(draft.matches(":disabled")).toBe(false);
  state.me = { role: "ADMIN", canTranslate: false };
  view.rerender(<TranslationEditor />);
  expect(screen.queryByLabelText("Translation draft")).toBeNull();
  state.me = { role: "ADMIN", canTranslate: true };
  view.rerender(<TranslationEditor />);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Translation draft" })
      .value,
  ).toBe("");
});
