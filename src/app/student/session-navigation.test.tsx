/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TuteeNavigation } from "./navigation";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
const route = vi.hoisted(() => ({ query: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/student",
  useSearchParams: () => new URLSearchParams(route.query),
  useRouter: () => ({ replace: route.replace }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
beforeEach(() => {
  window.sessionStorage.clear();
  route.query = "";
  route.replace.mockClear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);
const key = viewStateKey("tutee", "/student", "student-view-v1", "");
const view = (verified = true) => (
  <SessionViewProvider identity="tutee" pathname="/student" verified={verified}>
    <TuteeNavigation />
  </SessionViewProvider>
);
it("recalls a bare workspace return only after verifying the current identity", () => {
  writeViewState(window.sessionStorage, key, "attendance");
  const first = render(view(false));
  expect(route.replace).not.toHaveBeenCalled();
  first.rerender(view());
  expect(route.replace).toHaveBeenCalledWith("/student?view=attendance", {
    scroll: false,
  });
});
it.each(["account", "unknown"])(
  "lets explicit %s destination override a remembered selection",
  (destination) => {
    writeViewState(window.sessionStorage, key, "attendance");
    route.query = "view=" + destination;
    render(view());
    expect(route.replace).not.toHaveBeenCalled();
    const expected = destination === "unknown" ? "dashboard" : "account";
    expect(
      screen.getByRole("link", { name: expected }).getAttribute("aria-current"),
    ).toBe("page");
    expect(window.sessionStorage.getItem(key)).toBe(JSON.stringify(expected));
  },
);
it("keeps an explicit hash destination instead of recalling the previous view", () => {
  writeViewState(window.sessionStorage, key, "attendance");
  window.history.replaceState(null, "", "#request-history");
  render(view());
  expect(route.replace).not.toHaveBeenCalled();
});
