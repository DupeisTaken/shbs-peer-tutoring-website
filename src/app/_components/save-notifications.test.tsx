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
import { NotificationViewport, SaveNotifications } from "./save-notifications";
import { ApprovalNotice } from "./approval-notice";
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

it("retains failed saves across later successes and deduplicates repeated errors", () => {
  vi.useFakeTimers();
  render(<SaveNotifications />, { wrapper });
  act(() => {
    for (let i = 0; i < 2; i++)
      window.dispatchEvent(
        new CustomEvent("admin-save-result", {
          detail: { kind: "error", message: "Name could not be saved" },
        }),
      );
    window.dispatchEvent(
      new CustomEvent("admin-save-result", { detail: { kind: "success" } }),
    );
  });
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain("Changes saved");
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain(
    "Name could not be saved",
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps a queued approval and a later direct save in the same non-overlapping viewport", () => {
  render(
    <NotificationViewport>
      <ApprovalNotice />
      <SaveNotifications />
    </NotificationViewport>,
    { wrapper },
  );
  act(() => {
    window.dispatchEvent(
      new CustomEvent("approval-queued", { detail: "proposal-2" }),
    );
    window.dispatchEvent(
      new CustomEvent("admin-save-result", { detail: { kind: "success" } }),
    );
  });
  const notices = screen.getAllByRole("status");
  expect(notices).toHaveLength(2);
  expect(notices[0]?.parentElement).toBe(notices[1]?.parentElement);
  expect(
    screen.getByRole("link", { name: "View Request" }).getAttribute("href"),
  ).toContain("proposal-2");
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
