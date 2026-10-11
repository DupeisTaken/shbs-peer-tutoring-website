// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  RequestInvalidity,
  type InvalidityInput,
  type InvalidityRecord,
} from "./request-invalidity";

const initial: InvalidityRecord = {
  id: "request-1",
  isInvalid: false,
  invalidReason: null,
  invalidatedAt: null,
  invalidatedByName: null,
  invalidityVersion: 0,
};
const flagged: InvalidityRecord = {
  ...initial,
  isInvalid: true,
  invalidReason: "Duplicate of the verified submission.",
  invalidatedAt: new Date("2026-10-10T08:00:00Z"),
  invalidatedByName: "Alex Admin",
  invalidityVersion: 1,
};
const commit = vi.fn<(input: InvalidityInput) => Promise<unknown>>();
const refresh = vi.fn<() => Promise<InvalidityRecord>>();
const ui = (
  record = initial,
  options: { locale?: string; coordinator?: boolean; canFlag?: boolean } = {},
) => (
  <NextIntlClientProvider
    locale={options.locale ?? "en"}
    messages={options.locale === "zh" ? zh : en}
    timeZone="Asia/Shanghai"
  >
    <RequestInvalidity
      record={record}
      name="Taylor Student"
      canFlag={options.canFlag ?? true}
      coordinator={options.coordinator}
      onCommit={commit}
      onRefresh={refresh}
    />
  </NextIntlClientProvider>
);
const open = (flagged = false) => {
  const trigger = screen.getByRole("button", {
    name: flagged ? "Review invalid flag" : "Flag invalid",
  });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};
const write = (reason: string) =>
  fireEvent.change(screen.getByRole("textbox"), { target: { value: reason } });
const submit = (name = "Flag invalid") =>
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  commit.mockResolvedValue({ ok: true });
  refresh.mockResolvedValue(flagged);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);

it("requires a nonblank reason and submits only the trimmed reason with its captured version", async () => {
  render(ui());
  const trigger = open();
  write("   ");
  expect(
    within(screen.getByRole("dialog")).getByRole<HTMLButtonElement>("button", {
      name: "Flag invalid",
    }).disabled,
  ).toBe(true);
  submit();
  expect(commit).not.toHaveBeenCalled();
  write("  Duplicate submission.  ");
  submit();
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(commit).toHaveBeenCalledExactlyOnceWith({
    id: initial.id,
    invalid: true,
    reason: "Duplicate submission.",
    expectedInvalidityVersion: 0,
  });
  await screen.findByText(en.requestInvalidity.saved);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(trigger);
});

it("blocks duplicate same-tick writes and repeated Escape while the write is pending", async () => {
  let complete!: (value: unknown) => void;
  commit.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(ui());
  open();
  write("Invalid request.");
  const button = within(screen.getByRole("dialog")).getByRole("button", {
    name: "Flag invalid",
  });
  act(() => {
    button.click();
    button.click();
  });
  expect(commit).toHaveBeenCalledOnce();
  const dialog = screen.getByRole("dialog");
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () => complete({ ok: true }));
  expect(screen.getByText(en.requestInvalidity.saved)).toBeTruthy();
});

it("shows the original reason, actor and time and requires a new reason when clearing", async () => {
  render(ui(flagged));
  open(true);
  expect(screen.getByText(flagged.invalidReason!)).toBeTruthy();
  expect(screen.getByText(/Flagged by Alex Admin/).textContent).toContain(
    "2026",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Clear invalid flag",
    }).disabled,
  ).toBe(true);
  write("Verified as a separate valid request.");
  submit("Clear invalid flag");
  await waitFor(() =>
    expect(commit).toHaveBeenCalledWith({
      id: initial.id,
      invalid: false,
      reason: "Verified as a separate valid request.",
      expectedInvalidityVersion: 1,
    }),
  );
});

it("retains the original draft and version through errors, background updates and cancel/reopen", async () => {
  commit.mockRejectedValue(new Error("The request changed."));
  const view = render(ui());
  open();
  write("My original reason.");
  submit();
  await screen.findByText("The request changed.");
  view.rerender(ui(flagged));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  open(true);
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "My original reason.",
  );
  submit();
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  expect(commit.mock.calls[1]?.[0].expectedInvalidityVersion).toBe(0);
  refresh.mockRejectedValueOnce(new Error("Read unavailable."));
  fireEvent.click(screen.getByRole("button", { name: "Reload request" }));
  await screen.findByText("Read unavailable.");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "My original reason.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Reload request" }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(""),
  );
  write("Now clearing the latest flag.");
  submit("Clear invalid flag");
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(3));
  expect(commit.mock.calls[2]?.[0]).toEqual({
    id: initial.id,
    invalid: false,
    reason: "Now clearing the latest flag.",
    expectedInvalidityVersion: 1,
  });
});

it("keeps saved refresh recovery reachable after Close and never resubmits the saved write", async () => {
  refresh.mockRejectedValueOnce(new Error("Offline"));
  render(ui());
  open();
  write("Invalid request.");
  submit();
  await screen.findByText(en.requestInvalidity.refreshFailed);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  await screen.findByText(en.requestInvalidity.saved);
  expect(commit).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("keeps coordinator proposals distinct from applied flags and can adopt a later approved version", async () => {
  commit.mockRejectedValue({ data: { approvalId: "approval-1" } });
  const view = render(ui(initial, { coordinator: true }));
  open();
  write("Duplicate for staff review.");
  submit("Request invalid flag");
  await screen.findByText(en.requestInvalidity.queued);
  expect(
    screen
      .getByRole("link", { name: "View approval request" })
      .getAttribute("href"),
  ).toBe("/admin/approvals?request=approval-1");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  view.rerender(ui(flagged, { coordinator: true }));
  open(true);
  expect(
    screen.getByRole("button", { name: "Request flag removal" }),
  ).toBeTruthy();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
});

it("never mounts private reasons or actions without edit authority", () => {
  render(ui(flagged, { canFlag: false }));
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText(flagged.invalidReason!)).toBeNull();
  expect(commit).not.toHaveBeenCalled();
});

it("translates the review and preserves a long Chinese reason", () => {
  render(ui(flagged, { locale: "zh" }));
  fireEvent.click(
    screen.getByRole("button", { name: zh.requestInvalidity.review }),
  );
  const reason = "已与学生核实，应保留此独立申请。".repeat(20);
  write(reason);
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(reason);
  expect(
    screen.getByRole("button", { name: zh.requestInvalidity.clear }),
  ).toBeTruthy();
});
