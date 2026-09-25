// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AccountUsernameEditor } from "./account-username-editor";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn(), refresh: vi.fn(), reset: vi.fn(), conflict: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ admin: { accounts: { invalidate: mocks.invalidate, fetch: async () => ({ rows: [{ userId: "head", username: "latesthead", profileVersion: 5 }] }) }, tutors: { invalidate: mocks.invalidate } }, account: { me: { invalidate: mocks.invalidate } } }),
  admin: { updateAccountUsername: { useMutation: (options: { onSuccess: () => Promise<void> }) => ({ mutate: (input: unknown) => { mocks.mutate(input); if (!mocks.conflict) void options.onSuccess(); }, isPending: false, reset: mocks.reset, error: mocks.conflict ? { message: "Profile changed", data: { code: "CONFLICT" } } : null }) } },
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.conflict = false; });

it("retains the username draft's original version when academic changes refresh props", async () => {
  const onSaved = vi.fn();
  const ui = (version: number) => <NextIntlClientProvider locale="en" messages={en}><AccountUsernameEditor userId="head" username="oldhead" profileVersion={version} onSaved={onSaved} /></NextIntlClientProvider>;
  const view = render(ui(3));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "drafthead" } });
  view.rerender(ui(4));
  fireEvent.click(screen.getByRole("button"));
  expect(mocks.mutate).toHaveBeenCalledWith({ userId: "head", username: "drafthead", expectedProfileVersion: 3 });
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
});

it("explicitly reloads the username and matching version after a conflict", async () => {
  mocks.conflict = true;
  render(<NextIntlClientProvider locale="en" messages={en}><AccountUsernameEditor userId="head" username="oldhead" profileVersion={3} onSaved={vi.fn()} /></NextIntlClientProvider>);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: en.accountProfile.reloadUsername }));
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("latesthead"));
  fireEvent.click(screen.getByRole("button", { name: en.accountProfile.saveUsername }));
  expect(mocks.mutate).toHaveBeenCalledWith({ userId: "head", username: "latesthead", expectedProfileVersion: 5 });
});
it.each(["en", "zh"])("saves a username and refreshes cached lists and the server header in %s", async (locale) => {
  const onSaved = vi.fn();
  render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}><AccountUsernameEditor userId="head" username="oldhead" profileVersion={3} onSaved={onSaved} /></NextIntlClientProvider>);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "NewHead" } });
  fireEvent.click(screen.getByRole("button"));
  expect(mocks.mutate).toHaveBeenCalledWith({ userId: "head", username: "NewHead", expectedProfileVersion: 3 });
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
