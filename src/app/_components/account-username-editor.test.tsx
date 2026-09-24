// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AccountUsernameEditor } from "./account-username-editor";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ admin: { accounts: { invalidate: mocks.invalidate }, tutors: { invalidate: mocks.invalidate } }, account: { me: { invalidate: mocks.invalidate } } }),
  admin: { updateAccountUsername: { useMutation: (options: { onSuccess: () => Promise<void> }) => ({ mutate: (input: unknown) => { mocks.mutate(input); void options.onSuccess(); }, isPending: false }) } },
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
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
