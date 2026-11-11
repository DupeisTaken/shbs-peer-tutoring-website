/** @vitest-environment jsdom */
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { ActionReviewRecipe } from "./action-review-recipe";
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("shows a request receipt without claiming the eventual change was applied", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ActionReviewRecipe />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.settings.optOutBtn }),
  );
  const confirm = within(
    screen.getByRole("dialog"),
  ).getByRole<HTMLButtonElement>("button", {
    name: messages.tutor.settings.optOutBtn,
  });
  expect(confirm.disabled).toBe(true);
  expect(confirm.className).toContain("btn-danger");
  act(() => {
    now = 3_000;
    fireEvent.focus(window);
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: messages.tutor.settings.optOutBtn,
    }),
  );
  await screen.findByText(messages.tutor.settings.optOutSubmitted);
  expect(screen.queryByText(messages.actionReview.applied)).toBeNull();
});
it("conceals revoked example evidence and permits a fresh review after restored access", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ActionReviewRecipe />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Open access revocation example" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Simulate revoked access",
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(messages.actionReview.galleryRecord)).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Open access revocation example",
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Restore example access" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Open access revocation example" }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(
      messages.actionReview.galleryRecord,
    ),
  ).toBeTruthy();
});
