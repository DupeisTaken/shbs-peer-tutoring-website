/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import LandingAdminPage from "./landing-editor";
import type * as SessionViewState from "~/app/_components/session-view-state";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";

const state = vi.hoisted(() => {
  const records: Record<string, unknown[]> = {};
  return {
  write: vi.fn<(name: string, input: unknown) => Promise<unknown>>(),
  read: vi.fn<(name: string) => Promise<{ data?: unknown[]; error?: unknown }>>(),
  records, news: undefined as unknown[] | undefined,
  error: null as null | { message: string; data?: { code?: string } }, scroll: vi.fn(), mutate: vi.fn() };
});
vi.mock("~/app/_components/session-view-state", async (original) => ({
  ...await original<typeof SessionViewState>(), useSessionPageScroll: state.scroll,
}));
vi.mock("~/app/_components/ui/action-review", () => ({ useActionReview: () => ({ dialog: null, blocked: () => false, open: vi.fn() }) }));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
vi.mock("~/trpc/react", () => {
  const home = new Proxy({}, { get: (_target, name) => ({
    useQuery: () => ({ data: name === "news" ? state.news : state.records[String(name)] ?? [], error: name === "news" ? state.error : null,
      isLoading: name === "news" && !state.news, isSuccess: name !== "news" || !!state.news && !state.error, isFetching: false, refetch: () => state.read(String(name)) }),
    useMutation: () => ({ mutate: state.mutate, mutateAsync: (input: unknown) => { state.mutate(input); return state.write(String(name), input); }, isPending: false }), invalidate: vi.fn(),
  }) });
  return { api: { home, useUtils: () => ({ home }), i18n: { languages: { useQuery: () => ({ data: [{ code: "en", label: "English" }], isSuccess: true }) } } } };
});
const tree = () => <SessionViewProvider identity="head" pathname="/admin/landing" verified>
  <NextIntlClientProvider locale="en" messages={en}><LandingAdminPage /></NextIntlClientProvider>
</SessionViewProvider>;
beforeEach(() => { window.sessionStorage.clear(); state.news = undefined; state.records = {}; state.error = null; state.scroll.mockClear(); state.mutate.mockClear(); state.write.mockReset().mockResolvedValue({ ok: true }); state.read.mockReset().mockImplementation(async (name) => ({ data: state.records[name] ?? [] })); });
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

it.each(["pages", "sections"] as const)("preserves a dirty %s slug through refresh and commits only its normalized blur value", async (tab) => {
  const record = (id: string, slug: string) => ({
    id, slug, title: { en: "Synthetic page" }, published: true, showInNav: false,
    navOrder: 0, sortOrder: 0, openByDefault: false, mode: "PAGE", translations: [],
    createdByName: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  });
  state.records[tab] = [record("first", "original")];
  const page = render(tree());
  fireEvent.click(screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }));
  const input = screen.getByDisplayValue<HTMLInputElement>("original");
  const helper = document.getElementById(input.getAttribute("aria-describedby")!);
  expect(helper?.textContent).toBe(en.saveBoundary.blur);
  fireEvent.change(input, { target: { value: "  My Draft URL! " } });
  expect(state.mutate).not.toHaveBeenCalled();
  state.records[tab] = [record("first", "background-change")];
  page.rerender(tree());
  expect(input.value).toBe("  My Draft URL! ");
  fireEvent.blur(input);
  expect(input.value).toBe("my-draft-url");
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith({ id: "first", slug: "my-draft-url" });
  state.records[tab] = [record("first", "my-draft-url")];
  await act(async () => { await Promise.resolve(); });
  page.rerender(tree());
  state.records[tab] = [record("first", "later-server-value")];
  page.rerender(tree());
  expect(input.value).toBe("later-server-value");
  fireEvent.change(input, { target: { value: "Uncommitted old record" } });
  state.records[tab] = [record("second", "second-record")];
  page.rerender(tree());
  expect(screen.getByDisplayValue("second-record")).toBeTruthy();
  expect(screen.queryByDisplayValue("Uncommitted old record")).toBeNull();
  expect(state.mutate).toHaveBeenCalledTimes(1);
});


it.each(["pages", "sections"] as const)("uses the canonical %s slug only from the accepted write's fresh read", async (tab) => {
  const record = (slug: string) => ({
    id: "collision", slug, title: { en: "Synthetic collision page" }, published: true,
    showInNav: false, navOrder: 0, sortOrder: 0, openByDefault: false, mode: "PAGE",
    translations: [], createdByName: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  });
  state.records[tab] = [record("original")];
  state.read.mockRejectedValue(new Error("Fresh read failed"));
  const page = render(tree());
  fireEvent.click(screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }));
  const input = screen.getByDisplayValue<HTMLInputElement>("original");
  fireEvent.change(input, { target: { value: "example" } });
  await act(async () => { fireEvent.blur(input); fireEvent.blur(input); });
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith({ id: "collision", slug: "example" });
  expect(state.read).toHaveBeenCalledExactlyOnceWith(tab);
  // An arbitrary cache update is not acknowledgement, even when text matches.
  state.records[tab] = [record("example")];
  page.rerender(tree());
  fireEvent.blur(input);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: en.uiPatterns.retry })).toBeTruthy();
  state.read.mockResolvedValue({ data: [record("example-2")] });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry })); });
  // The canonical receipt arrives before the parent query prop catches up.
  expect(input.value).toBe("example-2");
  fireEvent.blur(input);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  state.records[tab] = [record("example-2")];
  page.rerender(tree());
  expect(input.value).toBe("example-2");
  expect(screen.getByRole("link", { name: /View page/ }).getAttribute("href")).toBe("/p/example-2");
  fireEvent.blur(input);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["pages", "sections"] as const)("preserves a newer same-text %s edit while the earlier slug read completes", async (tab) => {
  const record = (slug: string) => ({
    id: "race", slug, title: { en: "Synthetic race page" }, published: true,
    showInNav: false, navOrder: 0, sortOrder: 0, openByDefault: false, mode: "PAGE",
    translations: [], createdByName: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  });
  let finishRead!: (result: { data: unknown[] }) => void;
  state.read.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  state.records[tab] = [record("original")];
  const page = render(tree());
  fireEvent.click(screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }));
  const input = screen.getByDisplayValue<HTMLInputElement>("original");
  fireEvent.change(input, { target: { value: "example" } });
  await act(async () => { fireEvent.blur(input); });
  fireEvent.change(input, { target: { value: "newer" } });
  fireEvent.change(input, { target: { value: "example" } });
  state.records[tab] = [record("example-2")];
  page.rerender(tree());
  await act(async () => { finishRead({ data: state.records[tab]! }); });
  expect(input.value).toBe("example");
  expect(state.mutate).toHaveBeenCalledTimes(1);
  state.records[tab] = [record("example-3")];
  await act(async () => { fireEvent.blur(input); });
  page.rerender(tree());
  expect(state.mutate).toHaveBeenCalledTimes(2);
  expect(input.value).toBe("example-3");
});


it.each(["pages", "sections"] as const)("retains a rejected %s slug write as an editable draft", async (tab) => {
  state.records[tab] = [{
    id: "rejected", slug: "original", title: { en: "Synthetic rejected page" }, published: true,
    showInNav: false, navOrder: 0, sortOrder: 0, openByDefault: false, mode: "PAGE",
    translations: [], createdByName: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  }];
  state.write.mockRejectedValue(new Error("Synthetic write rejection"));
  render(tree());
  fireEvent.click(screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }));
  const input = screen.getByDisplayValue<HTMLInputElement>("original");
  fireEvent.change(input, { target: { value: "Retry my draft" } });
  await act(async () => { fireEvent.blur(input); });
  expect(input.value).toBe("retry-my-draft");
  expect(state.read).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: en.uiPatterns.retry })).toBeNull();
  await act(async () => { fireEvent.blur(input); });
  expect(state.mutate).toHaveBeenCalledTimes(2);
});
