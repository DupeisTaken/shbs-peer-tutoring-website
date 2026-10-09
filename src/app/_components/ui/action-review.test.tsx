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
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { useActionReview } from "./action-review";
import { queuedApprovalId } from "~/lib/approval-outcome";

const commit = vi.fn<() => Promise<unknown>>();
const refresh = vi.fn<() => Promise<unknown>>();
function Example() {
  const review = useActionReview();
  return (
    <>
      <button
        disabled={review.blocked("record-1")}
        onClick={() =>
          review.open({
            key: "record-1",
            title: "Delete record?",
            description: "The record will be permanently removed.",
            confirmLabel: "Delete record",
            details: <p>Exact record name</p>,
            commit,
            refresh,
            approvalId: queuedApprovalId,
          })
        }
      >
        Review record
      </button>
      {review.dialog}
    </>
  );
}
const show = (locale = "en") =>
  render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="UTC"
      messages={locale === "zh" ? zh : en}
    >
      <Example />
    </NextIntlClientProvider>,
  );
const open = () => {
  const button = screen.getByRole("button", { name: "Review record" });
  button.focus();
  fireEvent.click(button);
  return button;
};
beforeEach(() => {
  vi.resetAllMocks();
  commit.mockResolvedValue(undefined);
  refresh.mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);

it.each(["en", "zh"])(
  "reviews exact consequences and cancels without writes in %s",
  (locale) => {
    show(locale);
    const opener = open();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Exact record name")).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: locale === "zh" ? "取消" : "Cancel",
      }),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  },
);

it("Escape cancels without writes and Tab stays in the review", () => {
  show();
  const opener = open();
  const dialog = screen.getByRole("dialog");
  const confirm = screen.getByRole("button", { name: "Delete record" });
  confirm.focus();
  fireEvent.keyDown(confirm, { key: "Tab" });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" }),
  );
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(commit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(opener);
});

it("admits one same-turn mutation and prevents repeated Escape until it settles", async () => {
  let settle!: () => void;
  commit.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  show();
  open();
  const confirm = screen.getByRole("button", { name: "Delete record" });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  act(() => {
    confirm.click();
    cancel.click();
    confirm.click();
  });
  expect(commit).toHaveBeenCalledTimes(1);
  const dialog = screen.getByRole("dialog");
  for (let index = 0; index < 3; index++) {
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
  }
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  await act(async () => {
    settle();
  });
  expect(screen.getByRole("status").textContent).toBe(en.actionReview.applied);
  expect(screen.queryByRole("button", { name: "Delete record" })).toBeNull();
});

it("keeps the exact failed review and permits retry after a rejected mutation", async () => {
  commit.mockRejectedValueOnce(new Error("Synthetic conflict"));
  show();
  open();
  fireEvent.click(screen.getByRole("button", { name: "Delete record" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("Synthetic conflict");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete record" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(commit).toHaveBeenCalledTimes(2);
});

it("reports approval as queued and never refreshes or replays it", async () => {
  commit.mockRejectedValue(
    Object.assign(new Error("Queued"), { data: { approvalId: "request-1" } }),
  );
  show();
  open();
  fireEvent.click(screen.getByRole("button", { name: "Delete record" }));
  await screen.findByRole("status");
  expect(screen.getByRole("status").textContent).toContain(
    en.actionReview.queued,
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(
    screen.getByRole("link", { name: "View request" }).getAttribute("href"),
  ).toBe("/admin/approvals?request=request-1");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Review record" })
      .disabled,
  ).toBe(true);
});

it("keeps accepted writes locked through refresh and provides read-only recovery after Close", async () => {
  let fail!: (error: Error) => void;
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  show();
  open();
  fireEvent.click(screen.getByRole("button", { name: "Delete record" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  await act(async () => {
    fail(new Error("Offline"));
  });
  expect(screen.getByRole("status").textContent).toContain(
    en.actionReview.refreshFailed,
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      en.actionReview.applied,
    ),
  );
  expect(commit).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledTimes(2);
});
