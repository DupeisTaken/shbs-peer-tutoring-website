/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { AdminAccountView } from "./admin-account-view";

const state = vi.hoisted(() => ({
  missing: "emails", error: null as null | { data?: { code?: string }; message: string }, scroll: vi.fn(),
}));
vi.mock("./session-view-state", async (original) => ({
  ...await original<typeof import("./session-view-state")>(), useSessionPageScroll: state.scroll,
}));
vi.mock("./account-settings", () => ({ AccountSettings: () => <input aria-label="Private password" defaultValue="" /> }));
vi.mock("~/trpc/react", () => {
  const query = (id: string) => ({ useQuery: () => ({
    data: state.missing === id ? undefined : {}, error: state.error,
    isSuccess: !state.error && state.missing !== id, isFetching: false,
  }) });
  return { api: { account: { me: query("me"), emailSettings: query("emails") },
    program: { features: query("features"), profilePolicy: query("policy") }, departure: { state: query("departure") } } };
});
const tree = () => <NextIntlClientProvider locale="en" messages={en}><AdminAccountView /></NextIntlClientProvider>;
beforeEach(() => { state.missing = "emails"; state.error = null; state.scroll.mockClear(); });
afterEach(cleanup);

it("waits for the actual account sections and holds a denial across cached transport failures", () => {
  const page = render(tree());
  expect(state.scroll).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false, enabled: true }));
  state.missing = "";
  page.rerender(tree());
  expect(state.scroll).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true, enabled: true }));
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  page.rerender(tree());
  expect(state.scroll).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  expect(screen.queryByRole("textbox")).toBeNull();
  state.error = { message: "Offline" };
  page.rerender(tree());
  expect(screen.queryByRole("textbox")).toBeNull();
  state.error = null;
  page.rerender(tree());
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("");
});
