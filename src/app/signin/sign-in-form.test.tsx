// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mockAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ signInAction: mockAction }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
import { SignInForm } from "./sign-in-form";
afterEach(cleanup);

it("carries the original link through password, code error, and different-account navigation", async () => {
  const destination = "/admin/approvals?request=one#details";
  mockAction
    .mockResolvedValueOnce({
      step: "code",
      userId: "synthetic",
      email: "s***@example.test",
    })
    .mockResolvedValueOnce({
      step: "code",
      userId: "synthetic",
      email: "s***@example.test",
      error: "Invalid code",
    });
  const { container } = render(<SignInForm callbackUrl={destination} />);
  expect(
    container.querySelector<HTMLInputElement>("[name=callbackUrl]")?.value,
  ).toBe(destination);
  fireEvent.submit(container.querySelector("form")!);
  await screen.findByText("twoFactor.title");
  expect(
    container.querySelector<HTMLInputElement>("[name=callbackUrl]")?.value,
  ).toBe(destination);
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Invalid code"),
  );
  expect(
    container.querySelector<HTMLInputElement>("[name=callbackUrl]")?.value,
  ).toBe(destination);
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    `/signin?callbackUrl=${encodeURIComponent(destination)}`,
  );
});

it.each([
  ["typed", "00-12", "0012"],
  ["typed", "ab1od", "AB10D"],
  ["pasted", " 00-12 ", "0012"],
])("enables email verification for %s normalized code %s", async (method, raw, expected) => {
  mockAction.mockReset();
  mockAction.mockResolvedValueOnce({
    step: "code",
    userId: "synthetic",
    email: "s***@example.test",
  });
  const { container } = render(<SignInForm />);
  fireEvent.submit(container.querySelector("form")!);
  await screen.findByText("twoFactor.title");
  const input = screen.getByRole<HTMLInputElement>("textbox");
  const verify = screen.getByRole<HTMLButtonElement>("button", {
    name: "twoFactor.verify",
  });
  expect(verify.disabled).toBe(true);
  if (method === "pasted")
    fireEvent.paste(input, { clipboardData: { getData: () => raw } });
  else
    fireEvent.change(input, { target: { value: raw } });
  expect(input.value).toBe(expected);
  expect(verify.disabled).toBe(false);
  fireEvent.change(input, { target: { value: "00" } });
  expect(verify.disabled).toBe(true);
});
