/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { SaveNotifications } from "./save-notifications";
import { createQueryClient, isAdminSaveMutation } from "~/trpc/query-client";
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("waits for the server result before announcing success", async () => {
  window.history.replaceState(null, "", "/admin/time-slots");
  render(<SaveNotifications />, { wrapper });
  const client = createQueryClient();
  let complete!: () => void;
  const mutation = client.getMutationCache().build(client, {
    mutationKey: [["admin", "updateTimeSlot"]],
    mutationFn: () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = mutation.execute(undefined);
    await Promise.resolve();
  });
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => {
    complete();
    await pending;
  });
  expect(screen.getByRole("status").textContent).toContain("Changes saved");
  client.clear();
});
it("keeps errors until dismissed and clears success when approval is queued", () => {
  vi.useFakeTimers();
  render(<SaveNotifications />, { wrapper });
  act(() => {
    window.dispatchEvent(
      new CustomEvent("admin-save-result", {
        detail: { kind: "error", message: "Server unavailable" },
      }),
    );
  });
  act(() => {
    vi.advanceTimersByTime(10000);
  });
  expect(screen.getByRole("alert").textContent).toContain("Server unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).toBeNull();
  act(() => {
    window.dispatchEvent(
      new CustomEvent("admin-save-result", { detail: { kind: "success" } }),
    );
    window.dispatchEvent(
      new CustomEvent("approval-queued", { detail: "request-1" }),
    );
  });
  expect(screen.queryByRole("status")).toBeNull();
});
it("excludes preparation tickets and includes program and editor writes", () => {
  expect(isAdminSaveMutation([["studentWorkflow", "prepareAction"]])).toBe(
    false,
  );
  expect(isAdminSaveMutation([["program", "setSettings"]])).toBe(true);
  expect(isAdminSaveMutation([["admin", "updateTutor"]])).toBe(true);
  expect(isAdminSaveMutation([["notification", "markRead"]])).toBe(false);
});
