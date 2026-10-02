/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AttendanceCorrection } from "./attendance-correction";
import { TableDetails } from "./ui/summary-table";
import { ProfileDialog } from "./profile-dialog";

const state = vi.hoisted(() => ({
  pending: false,
  error: null as null | {
    message: string;
    data?: { approvalId?: string; code?: string };
  },
  version: new Date("2026-09-07"),
  comments: "Recorded comment",
  mutate: vi.fn(),
  reset: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  options: {} as { onSuccess: () => Promise<void>; onSettled: () => void },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        sessions: { invalidate: state.invalidate },
        auditLog: { invalidate: state.invalidate },
      },
      corrections: { attendance: { invalidate: state.invalidate } },
    }),
    admin: {
      rooms: {
        useQuery: () => ({
          data: [{ id: "room", name: "Room A" }],
          isLoading: false,
        }),
      },
    },
    corrections: {
      attendance: {
        useQuery: () => ({
          data: [
            {
              id: "session",
              mergeGroupId: null,
              updatedAt: state.version,
              date: new Date("2026-09-07"),
              startMin: 930,
              endMin: 990,
              tutorStatus: "PRESENT",
              tutorAbsentReason: null,
              online: false,
              actualRoomId: "room",
              tutees: [
                {
                  tuteeId: "student",
                  status: "PRESENT",
                  absenceReason: null,
                  tutee: { englishName: "Student Name" },
                },
              ],
              comments: state.comments,
              ratingPreparedness: 4,
              ratingParticipation: 4,
              ratingUnderstanding: 4,
              ratingBehavior: 4,
              ratingProgress: 4,
            },
          ],
          refetch: state.refetch,
        }),
      },
      correctAttendance: {
        useMutation: (options: typeof state.options) => {
          state.options = options;
          return {
            mutate: state.mutate,
            reset: state.reset,
            isPending: state.pending,
            error: state.error,
          };
        },
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.pending = false;
  state.error = null;
  state.version = new Date("2026-09-07");
  state.comments = "Recorded comment";
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

it("retains the actual inline attendance draft and version through a failed write", () => {
  const inline = () => (
    <NextIntlClientProvider locale="en" messages={en}>
      <AttendanceCorrection id="session" />
    </NextIntlClientProvider>
  );
  const view = render(inline());
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.corrections.reason,
  });
  fireEvent.change(reason, { target: { value: "Inline attendance draft" } });
  const originalVersion = state.version;
  fireEvent.submit(reason.closest("form")!);
  state.pending = true;
  view.rerender(inline());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(reason.matches(":disabled")).toBe(true);
  expect(fireEvent.click(screen.getByText(en.corrections.editAttendance))).toBe(
    false,
  );
  state.pending = false;
  state.version = new Date("2026-09-08");
  state.error = { message: "Save failed" };
  state.options.onSettled();
  view.rerender(inline());
  expect(reason.value).toBe("Inline attendance draft");
  expect(screen.getByRole("alert").textContent).toBe("Save failed");
  fireEvent.submit(reason.closest("form")!);
  expect(state.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      reason: "Inline attendance draft",
      expectedUpdatedAt: originalVersion,
    }),
  );
});

function page(locale: "en" | "zh" = "en", ancestorPending?: boolean) {
  const correction = (
    <TableDetails title="Session details">
      <AttendanceCorrection id="session" />
    </TableDetails>
  );
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      {ancestorPending === undefined ? (
        correction
      ) : (
        <ProfileDialog
          title="Parent"
          pending={ancestorPending}
          onClose={vi.fn()}
        >
          {correction}
        </ProfileDialog>
      )}
    </NextIntlClientProvider>
  );
}

it.each(["en", "zh"] as const)(
  "keeps the %s correction and version through a failed and queued write",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const view = render(page(locale));
    const opener = screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: Session details`,
    });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    const reason = within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
      name: messages.corrections.reason,
    });
    const comments = within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
      name: messages.corrections.comments,
    });
    fireEvent.change(reason, {
      target: { value: "Retain my correction reason" },
    });
    fireEvent.change(comments, { target: { value: "Edited comment" } });
    const form = reason.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(state.mutate).toHaveBeenCalledTimes(1);
    const original = state.version;
    expect(state.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedUpdatedAt: original,
        reason: "Retain my correction reason",
        comments: "Edited comment",
        actualRoomId: "room",
        tutees: [
          { tuteeId: "student", status: "PRESENT", absenceReason: null },
        ],
      }),
    );
    state.pending = true;
    view.rerender(page(locale));
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(reason.matches(":disabled")).toBe(true);
    expect(comments.matches(":disabled")).toBe(true);
    expect(
      fireEvent.click(
        within(dialog).getByText(messages.corrections.editAttendance),
      ),
    ).toBe(false);
    for (let i = 0; i < 3; i++) {
      expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    }
    fireEvent.submit(form);
    expect(state.mutate).toHaveBeenCalledTimes(1);
    state.pending = false;
    state.error = { message: "Correction failed" };
    state.version = new Date("2026-09-08");
    state.comments = "Background update";
    state.options.onSettled();
    view.rerender(page(locale));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(reason.value).toBe("Retain my correction reason");
    expect(comments.value).toBe("Edited comment");
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "Correction failed",
    );
    fireEvent.submit(form);
    expect(state.mutate).toHaveBeenCalledTimes(2);
    expect(state.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUpdatedAt: original }),
    );
    state.error = {
      message: "Approval required",
      data: { approvalId: "approval" },
    };
    state.options.onSettled();
    view.rerender(page(locale));
    expect(within(dialog).getByRole("status").textContent).toBe(
      messages.approvals.queuedBody,
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(reason.value).toBe("Retain my correction reason");
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(dialog.getAttribute("aria-busy")).toBe("false");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: messages.tablePatterns.close,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  },
);

it("collapses only after an applied correction has synchronized and settled", async () => {
  const view = render(page());
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.tablePatterns.details}: Session details`,
    }),
  );
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.corrections.reason,
  });
  fireEvent.change(reason, { target: { value: "Correction reason" } });
  fireEvent.submit(reason.closest("form")!);
  state.pending = true;
  view.rerender(page());
  await act(() => state.options.onSuccess());
  expect(state.invalidate).toHaveBeenCalledTimes(3);
  expect(reason.closest("details")?.open).toBe(true);
  state.pending = false;
  state.options.onSettled();
  view.rerender(page());
  expect(reason.closest("details")?.open ?? false).toBe(false);
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
});

it("blocks direct submission while an ancestor writes and releases without latching", () => {
  const view = render(page("en", false));
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.tablePatterns.details}: Session details`,
    }),
  );
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.corrections.reason,
  });
  fireEvent.change(reason, { target: { value: "Draft" } });
  view.rerender(page("en", true));
  fireEvent.submit(reason.closest("form")!);
  expect(state.mutate).not.toHaveBeenCalled();
  expect(reason.matches(":disabled")).toBe(true);
  view.rerender(page("en", false));
  expect(reason.matches(":disabled")).toBe(false);
  fireEvent.submit(reason.closest("form")!);
  expect(state.mutate).toHaveBeenCalledOnce();
});

it("replaces a conflicting draft only after explicit successful reload, even at the same version", async () => {
  const view = render(page());
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.tablePatterns.details}: Session details`,
    }),
  );
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.corrections.reason,
  });
  const comments = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.corrections.comments,
  });
  fireEvent.change(reason, { target: { value: "Draft reason" } });
  fireEvent.change(comments, { target: { value: "Draft comment" } });
  state.error = { message: "Conflict", data: { code: "CONFLICT" } };
  view.rerender(page());
  state.refetch.mockResolvedValue({ isSuccess: false, data: undefined });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.academics.reload }));
  });
  expect(reason.value).toBe("Draft reason");
  expect(comments.value).toBe("Draft comment");
  expect(state.reset).not.toHaveBeenCalled();
  state.refetch.mockResolvedValue({
    isSuccess: true,
    data: [
      {
        id: "session",
        mergeGroupId: null,
        updatedAt: state.version,
        date: new Date("2026-09-07"),
        startMin: 930,
        endMin: 990,
        tutorStatus: "PRESENT",
        tutorAbsentReason: null,
        online: false,
        actualRoomId: "room",
        tutees: [],
        comments: "Reloaded comment",
        ratingPreparedness: 4,
        ratingParticipation: 4,
        ratingUnderstanding: 4,
        ratingBehavior: 4,
        ratingProgress: 4,
      },
    ],
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.academics.reload }));
  });
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: en.corrections.reason,
    }).value,
  ).toBe("");
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: en.corrections.comments,
    }).value,
  ).toBe("Reloaded comment");
  expect(state.reset).toHaveBeenCalledOnce();
});

it("blocks direct save during an explicit reload without treating the read as a write", async () => {
  state.error = { message: "Conflict", data: { code: "CONFLICT" } };
  let release!: (result: { isSuccess: boolean }) => void;
  state.refetch.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  render(page());
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.tablePatterns.details}: Session details`,
    }),
  );
  const dialog = screen.getByRole("dialog");
  const reason = within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
    name: en.corrections.reason,
  });
  fireEvent.change(reason, { target: { value: "Retained" } });
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.academics.reload }),
  );
  expect(reason.matches(":disabled")).toBe(true);
  fireEvent.submit(reason.closest("form")!);
  expect(state.mutate).not.toHaveBeenCalled();
  expect(dialog.getAttribute("aria-busy")).toBe("false");
  expect(
    within(dialog)
      .getByRole<HTMLButtonElement>("button", { name: en.tablePatterns.close })
      .matches(":disabled"),
  ).toBe(false);
  await act(async () => {
    release({ isSuccess: false });
  });
  expect(reason.matches(":disabled")).toBe(false);
  expect(reason.value).toBe("Retained");
  fireEvent.submit(reason.closest("form")!);
  expect(state.mutate).toHaveBeenCalledOnce();
});
