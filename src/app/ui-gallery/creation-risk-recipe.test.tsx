/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { CreationRiskRecipe } from "./creation-risk-recipe";
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(cleanup);
it("hands focus through the gate and retains the editor draft while requiring fresh acknowledgment", () => {
  const copy = messages.admin.creationRisk;
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CreationRiskRecipe />
    </NextIntlClientProvider>,
  );
  const opener = screen.getByRole("button", { name: copy.galleryOpen });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: copy.continue }));
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: copy.galleryDraft,
  });
  expect(document.activeElement).toBe(draft);
  fireEvent.change(draft, { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: copy.galleryClose }));
  expect(document.activeElement).toBe(opener);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "tutor" },
  });
  fireEvent.click(opener);
  expect(screen.getByRole("dialog", { name: copy.tutor.title })).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: copy.continue }));
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Keep this draft",
  );
});
