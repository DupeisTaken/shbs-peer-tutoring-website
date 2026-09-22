// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ me: { role: "TUTOR", canTranslate: true } }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/trpc/react", () => ({
  api: { account: { me: { useQuery: () => ({ data: state.me }) } } },
}));
vi.mock("./translation-strings", () => ({
  TranslationStrings: () => <div>string-editor</div>,
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
afterEach(cleanup);
it.each(["ADMIN", "HEAD", "COORDINATOR"])(
  "defaults to review without mounting text editors for unassigned %s",
  (role) => {
    state.me = { role, canTranslate: false };
    render(<TranslationEditor />);
    expect(screen.getByText("draft-review")).toBeTruthy();
    expect(screen.queryByText("string-editor")).toBeNull();
    expect(screen.queryByRole("button", { name: "website" })).toBeNull();
  },
);
it.each(["ADMIN", "HEAD"])(
  "lets unassigned %s manage languages independently",
  (role) => {
    state.me = { role, canTranslate: false };
    render(<TranslationEditor />);
    fireEvent.click(screen.getByRole("button", { name: "languagesHeading" }));
    expect(screen.getByText("language-management")).toBeTruthy();
    expect(screen.queryByText("string-editor")).toBeNull();
    expect(screen.queryByText("website-editor")).toBeNull();
    expect(screen.queryByText("add-language")).toBeNull();
  },
);
it("does not expose language administration to an unassigned coordinator", () => {
  state.me = { role: "COORDINATOR", canTranslate: false };
  render(<TranslationEditor />);
  expect(screen.queryByRole("button", { name: "languagesHeading" })).toBeNull();
});
it("keeps adding languages available to assigned translators", () => {
  state.me = { role: "TUTOR", canTranslate: true };
  render(<TranslationEditor />);
  fireEvent.click(screen.getByRole("button", { name: "languagesHeading" }));
  expect(screen.getByText("add-language")).toBeTruthy();
});
it("removes language administration after management rank is revoked", () => {
  state.me = { role: "ADMIN", canTranslate: false };
  const { rerender } = render(<TranslationEditor />);
  fireEvent.click(screen.getByRole("button", { name: "languagesHeading" }));
  state.me = { role: "COORDINATOR", canTranslate: false };
  rerender(<TranslationEditor />);
  expect(screen.queryByText("language-management")).toBeNull();
  expect(screen.getByText("draft-review")).toBeTruthy();
});
it("keeps all three workflows in one assigned translator editor", () => {
  state.me = { role: "TUTOR", canTranslate: true };
  render(<TranslationEditor />);
  expect(screen.getByText("string-editor")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "website" }));
  expect(screen.getByText("website-editor")).toBeTruthy();
  expect(screen.queryByText("string-editor")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "review" }));
  expect(screen.getByText("draft-review")).toBeTruthy();
});
it("honors the review deep link and removes editing after assignment revocation", () => {
  state.me = { role: "ADMIN", canTranslate: true };
  const { rerender } = render(<TranslationEditor initialView="review" />);
  expect(screen.getByText("draft-review")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "strings" }));
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
