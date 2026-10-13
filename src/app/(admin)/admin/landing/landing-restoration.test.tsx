/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import LandingAdminPage from "./landing-editor";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";

const state = vi.hoisted(() => ({ news: undefined as unknown[] | undefined,
  error: null as null | { message: string; data?: { code?: string } }, scroll: vi.fn(), mutate: vi.fn() }));
vi.mock("~/app/_components/session-view-state", async (original) => ({
  ...await original<typeof import("~/app/_components/session-view-state")>(), useSessionPageScroll: state.scroll,
}));
vi.mock("~/app/_components/ui/action-review", () => ({ useActionReview: () => ({ dialog: null, blocked: () => false, open: vi.fn() }) }));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
vi.mock("~/trpc/react", () => {
  const home = new Proxy({}, { get: (_target, name) => ({
    useQuery: () => ({ data: name === "news" ? state.news : [], error: name === "news" ? state.error : null,
      isLoading: name === "news" && !state.news, isSuccess: name !== "news" || !!state.news && !state.error, isFetching: false }),
    useMutation: () => ({ mutate: state.mutate, isPending: false }), invalidate: vi.fn(),
  }) });
  return { api: { home, useUtils: () => ({ home }), i18n: { languages: { useQuery: () => ({ data: [{ code: "en", label: "English" }], isSuccess: true }) } } } };
});
const tree = () => <SessionViewProvider identity="head" pathname="/admin/landing" verified>
  <NextIntlClientProvider locale="en" messages={en}><LandingAdminPage /></NextIntlClientProvider>
</SessionViewProvider>;
beforeEach(() => { window.sessionStorage.clear(); state.news = undefined; state.error = null; state.scroll.mockClear(); state.mutate.mockClear(); });
afterEach(cleanup);

it("mounts a remembered lazy tab and waits for its own read instead of the image library", () => {
  writeViewState(window.sessionStorage, viewStateKey("head", "/admin/landing", "landing.tab.v1", ""), "news");
  const page = render(tree());
  expect(screen.getByRole("tab", { name: en.admin.landing.tabs.news }).getAttribute("aria-selected")).toBe("true");
  expect(state.scroll).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false }));
  state.news = [];
  page.rerender(tree());
  expect(state.scroll).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true, enabled: true }));
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText(en.admin.landing.news.new.titlePlaceholder), { target: { value: "Unsaved private news title" } });
  expect(JSON.stringify(window.sessionStorage)).not.toContain("Unsaved private news title");
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  page.rerender(tree());
  expect(state.scroll).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  expect(screen.queryByPlaceholderText(en.admin.landing.news.new.titlePlaceholder)).toBeNull();
  state.error = { message: "Offline" };
  page.rerender(tree());
  expect(state.scroll).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
});
