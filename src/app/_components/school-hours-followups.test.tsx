// @vitest-environment jsdom
import {
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
import { SchoolHoursFollowups } from "./school-hours-followups";
const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    schoolHours: {
      scheduleFollowup: {
        useMutation: () => ({ mutateAsync: mocks.schedule }),
      },
      cancelFollowup: { useMutation: () => ({ mutateAsync: mocks.cancel }) },
    },
  },
}));
const base = {
  id: "report",
  timeZone: "Asia/Shanghai",
  linkVersion: 1,
  recipients: ["office@example.test"],
  followups: [],
  canManage: true,
  refresh: mocks.refresh,
};
function view(
  props: Partial<Parameters<typeof SchoolHoursFollowups>[0]> = {},
  locale = "en",
) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <SchoolHoursFollowups {...base} {...props} />
    </NextIntlClientProvider>
  );
}
function open() {
  fireEvent.change(screen.getByLabelText(en.schoolHoursFollowup.sendAt), {
    target: { value: "2099-11-12T09:30" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHoursFollowup.reviewSchedule }),
  );
  return screen.getByRole("dialog");
}
beforeEach(() => {
  mocks.schedule.mockReset().mockResolvedValue({ count: 1 });
  mocks.cancel.mockReset().mockResolvedValue({ cancelled: 1 });
  mocks.refresh.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
it("reviews exact recipients and timezone; cancel performs no write", () => {
  render(view());
  const dialog = open();
  expect(within(dialog).getByText("office@example.test")).toBeTruthy();
  expect(dialog.textContent).toContain("Asia/Shanghai");
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.common.cancel }),
  );
  expect(mocks.schedule).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText<HTMLInputElement>(en.schoolHoursFollowup.sendAt)
      .value,
  ).toBe("2099-11-12T09:30");
});
it("keeps rejected drafts and retries the same intent once despite double activation", async () => {
  mocks.schedule.mockRejectedValueOnce(new Error("synthetic failure"));
  render(view());
  const dialog = open();
  const confirm = within(dialog).getByRole("button", {
    name: en.schoolHoursFollowup.schedule,
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await screen.findByText(en.schoolHoursFollowup.writeFailed);
  expect(mocks.schedule).toHaveBeenCalledTimes(1);
  const first = mocks.schedule.mock.calls[0]![0] as unknown;
  expect(
    screen.getByLabelText<HTMLInputElement>(en.schoolHoursFollowup.sendAt)
      .value,
  ).toBe("2099-11-12T09:30");
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: en.schoolHoursFollowup.schedule,
    }),
  );
  await waitFor(() => expect(mocks.schedule).toHaveBeenCalledTimes(2));
  expect(mocks.schedule.mock.calls[1]![0]).toEqual(first);
});
it("accepted write with failed refresh offers read-only recovery", async () => {
  mocks.refresh.mockRejectedValueOnce(new Error("synthetic read failure"));
  render(view());
  const dialog = open();
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: en.schoolHoursFollowup.schedule,
    }),
  );
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  const retry = await within(dialog).findByRole("button", {
    name: en.actionReview.retry,
  });
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
  expect(mocks.schedule).toHaveBeenCalledTimes(1);
});
it("rejects past time without a write and hides editor from readers", () => {
  const rendered = render(view());
  fireEvent.change(screen.getByLabelText(en.schoolHoursFollowup.sendAt), {
    target: { value: "2020-01-01T09:30" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHoursFollowup.reviewSchedule }),
  );
  expect(screen.getByText(en.schoolHoursFollowup.invalidTime)).toBeTruthy();
  expect(mocks.schedule).not.toHaveBeenCalled();
  rendered.rerender(view({ canManage: false }));
  expect(screen.queryByLabelText(en.schoolHoursFollowup.sendAt)).toBeNull();
});
it("retains cancellation when issuing new mail is unavailable, with named review", async () => {
  const batch = {
    batchId: "3e44a42d-6b47-4f94-8121-75eb06dd915b",
    scheduledFor: new Date("2099-11-12T01:30:00Z"),
    deliveries: [
      {
        id: "mail",
        recipient: "office@example.test",
        status: "PENDING",
        attempts: 0,
        lastError: null,
        availableAt: new Date("2099-11-12T01:30:00Z"),
      },
    ],
  };
  render(view({ canSchedule: false, followups: [batch] }));
  expect(screen.queryByLabelText(en.schoolHoursFollowup.sendAt)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHoursFollowup.cancel }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.schoolHoursFollowup.cancel }),
  );
  await waitFor(() =>
    expect(mocks.cancel).toHaveBeenCalledWith({
      id: "report",
      batchId: batch.batchId,
    }),
  );
});
it("renders Chinese controls and cancellation status", () => {
  render(view({}, "zh"));
  expect(screen.getByLabelText(zh.schoolHoursFollowup.sendAt)).toBeTruthy();
  expect(screen.getByText(zh.schoolHoursFollowup.empty)).toBeTruthy();
});
