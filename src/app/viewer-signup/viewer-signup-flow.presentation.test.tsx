/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { ViewerSignupFlow } from "./viewer-signup-flow";
const state = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn() }));
vi.mock("~/app/_components/signup-captcha", () => ({
  useSignupCaptcha: () => ({ run: vi.fn(), pending: false, panel: null }),
  CaptchaError: () => null,
}));
vi.mock("~/trpc/react", async () => ({
  api: {
    program: {
      ...(
        await import("~/test/name-field-policy-fixtures")
      ).nameFieldPolicyQueries({
        firstName: "hidden",
        lastName: "hidden",
        preferredName: "hidden",
        alternativeNames: "hidden",
      }),
      profilePolicy: { useQuery: () => ({ data: {} }) },
    },
    viewer: {
      start: { useMutation: () => ({ mutate: state.start, reset: vi.fn() }) },
      verify: { useMutation: () => ({ mutate: state.verify, reset: vi.fn() }) },
    },
  },
}));
afterEach(cleanup);
it("omits all-Hidden Viewer names and Latin help while retaining required affiliation/email", () => {
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ViewerSignupFlow />
    </NextIntlClientProvider>,
  );
  expect(view.container.querySelector('input[name="firstName"]')).toBeNull();
  expect(screen.queryByText(en.profilePolicy.nameHint)).toBeNull();
  expect(
    view.container.querySelector<HTMLInputElement>("#obs-aff")?.required,
  ).toBe(true);
  expect(
    view.container.querySelector<HTMLInputElement>("#obs-email")?.required,
  ).toBe(true);
  expect(state.start).not.toHaveBeenCalled();
});
