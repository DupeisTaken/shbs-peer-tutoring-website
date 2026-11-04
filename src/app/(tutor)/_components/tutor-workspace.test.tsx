// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { TutorWorkspace, tutorWorkspacePanel } from "./tutor-workspace";
vi.mock("~/app/_components/focus-visible-context", () => ({
  focusVisibleContext: vi.fn(),
}));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
function show(locale: "en" | "zh") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <TutorWorkspace
        schedule={<p>Agenda fixture</p>}
        pairings={
          <label>
            Pairing draft
            <input />
          </label>
        }
        preferences={
          <label>
            Preference draft
            <input />
          </label>
        }
        history={<p>Owned history</p>}
      />
    </NextIntlClientProvider>,
  );
}
it.each(["en", "zh"] as const)(
  "retains independent drafts and hides inactive controls in %s",
  (locale) => {
    show(locale);
    const t = (locale === "en" ? en : zh).tutor.workspace;
    expect(screen.queryByLabelText("Pairing draft")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: t.pairings }));
    fireEvent.change(screen.getByLabelText("Pairing draft"), {
      target: { value: "Unsaved pairing" },
    });
    fireEvent.click(screen.getByRole("tab", { name: t.preferences }));
    expect(screen.queryByRole("textbox", { name: "Pairing draft" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Preference draft"), {
      target: { value: "Unsaved preference" },
    });
    fireEvent.click(screen.getByRole("tab", { name: t.pairings }));
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Pairing draft" })
        .value,
    ).toBe("Unsaved pairing");
    expect(window.location.hash).toBe("#tutor-pairings");
    act(() => {
      window.history.replaceState(null, "", "#tutor-preferences");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Preference draft",
      }).value,
    ).toBe("Unsaved preference");
  },
);
it("opens an explicit legacy target and leaves an open dialog in control", () => {
  window.history.replaceState(null, "", "/dashboard#tutor-history");
  show("en");
  expect(
    screen
      .getByRole("tab", { name: en.tutor.workspace.history })
      .getAttribute("aria-selected"),
  ).toBe("true");
  const dialog = document.createElement("dialog");
  dialog.open = true;
  document.body.append(dialog);
  act(() => {
    window.history.replaceState(null, "", "#tutor-pairings");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(
    screen
      .getByRole("tab", { name: en.tutor.workspace.history })
      .getAttribute("aria-selected"),
  ).toBe("true");
  dialog.remove();
  expect(tutorWorkspacePanel("#session-example")).toBe("schedule");
  expect(tutorWorkspacePanel("#qualification-requests")).toBe("preferences");
});
