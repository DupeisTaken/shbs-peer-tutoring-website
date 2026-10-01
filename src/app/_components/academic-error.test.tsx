/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AcademicError } from "./academic-error";

afterEach(cleanup);
it.each([false, true])("localizes the lifecycle guard and directs self-service to Account Settings (Chinese=%s)", chinese => {
  const messages = chinese ? zh : en;
  render(<NextIntlClientProvider locale={chinese ? "zh" : "en"} messages={messages}><AcademicError message="ACADEMIC_CONFIRMATION_REQUIRED" selfService /></NextIntlClientProvider>);
  expect(screen.getByText(messages.academics.confirmationRequired)).toBeTruthy();
  expect(screen.getByRole("link", { name: messages.academics.review }).getAttribute("href")).toBe("/my-account");
});
it("does not direct staff to edit their own academics for another account's guard", () => {
  render(<NextIntlClientProvider locale="en" messages={en}><AcademicError message="ACADEMIC_CONFIRMATION_REQUIRED" /></NextIntlClientProvider>);
  expect(screen.queryByRole("link")).toBeNull();
});
