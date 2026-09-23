// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";

const send = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ completeOnboardingAction: send }));
import { OnboardingForm } from "./onboarding-form";
beforeEach(() => { send.mockReset().mockResolvedValue({ sent: true }); });
afterEach(cleanup);

it.each(["en", "zh"])("explains mailbox proof and sends only the setup request in %s", async (locale) => {
  const messages = locale === "en" ? en : zh;
  render(<NextIntlClientProvider locale={locale} messages={messages}><OnboardingForm defaultEmail="owner@example.test" /></NextIntlClientProvider>);
  expect(screen.getByText(messages.auth.onboarding.proofRequired)).toBeTruthy();
  const address = screen.getByLabelText<HTMLInputElement>(messages.auth.onboarding.fields.email);
  expect(address.readOnly).toBe(true);
  expect(address.value).toBe("owner@example.test");
  expect(document.querySelector('input[type="password"]')).toBeNull();
  fireEvent.submit(screen.getByRole("button", { name: messages.auth.onboarding.sendLink }).closest("form")!);
  expect((await screen.findByRole("status")).textContent).toBe(messages.auth.onboarding.linkSent);
  expect(send).toHaveBeenCalledOnce();
});

it("explains delivery failure and leaves a retry action available", async () => {
  send.mockResolvedValue({ sent: false });
  render(<NextIntlClientProvider locale="en" messages={en}><OnboardingForm defaultEmail="owner@example.test" /></NextIntlClientProvider>);
  fireEvent.submit(screen.getByRole("button", { name: en.auth.onboarding.sendLink }).closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toBe(en.auth.onboarding.linkFailed);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: en.auth.onboarding.sendLink }).disabled).toBe(false);
});
