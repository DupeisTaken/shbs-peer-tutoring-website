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
