/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
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
afterEach(cleanup);
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
