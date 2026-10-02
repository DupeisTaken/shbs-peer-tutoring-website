// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { TutorMeetings } from "./tutor-meetings";
const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
  pending: false,
  error: "",
  success: false,
  excused: false,
  cancelError: "",
  canExcuse: true,
  onSuccess: async (): Promise<void> => undefined,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ tutor: { myMeetings: { invalidate: state.refresh } } }),
    tutor: {
      myMeetings: {
        useQuery: () => ({
          data: [
            {
              id: "meeting",
              title: "Synthetic meeting",
              date: new Date("2026-10-10T00:00:00Z"),
              excused: state.excused,
              canExcuse: state.canExcuse,
            },
          ],
        }),
      },
      excuseMeeting: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => {
          state.onSuccess = options.onSuccess;
          return {
            mutate: state.mutate,
            isPending: state.pending,
            isSuccess: state.success,
            error: state.error ? new Error(state.error) : null,
          };
        },
      },
      cancelMeetingExcuse: {
        useMutation: () => ({
          mutate: state.cancel,
          error: state.cancelError ? new Error(state.cancelError) : null,
        }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.pending = false;
  state.error = "";
  state.success = false;
  state.excused = false;
  state.cancelError = "";
  state.canExcuse = true;
});
const element = () => (
  <NextIntlClientProvider
    locale="en"
    timeZone="Asia/Shanghai"
    messages={messages}
  >
    <TutorMeetings />
  </NextIntlClientProvider>
);
const start = () => {
  const view = render(element());
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Exam conflict draft" },
  });
  return view;
};
it("cancel writes nothing; failed writes retain the reason and pending writes freeze it", async () => {
  let view = start();
  fireEvent.click(
    screen.getByRole("button", { name: messages.common.dismiss }),
  );
  expect(state.mutate).not.toHaveBeenCalled();
  view.unmount();
  view = start();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  );
  expect(state.mutate).toHaveBeenCalledWith({
    meetingId: "meeting",
    reason: "Exam conflict draft",
  });
  state.error = "Deadline changed. Try again.";
  view.rerender(element());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Exam conflict draft",
  );
  expect(screen.getByRole("alert").textContent).toContain(state.error);
  state.pending = true;
  view.rerender(element());
  expect(screen.getByRole<HTMLInputElement>("textbox").disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.common.dismiss,
    }).disabled,
  ).toBe(true);
  await act(async () => state.onSuccess());
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(state.refresh).toHaveBeenCalledOnce();
});
it("retains the server's meeting cutoff instead of offering a forbidden excuse", () => {
  state.canExcuse = false;
  render(element());
  expect(
    screen.queryByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  ).toBeNull();
  expect(screen.getByText(messages.tutor.meetings.tooLate)).toBeTruthy();
});

it("does not announce an earlier success beside a failed cancellation", () => {
  const view = start();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  );
  state.success = true;
  state.excused = true;
  view.rerender(element());
  expect(screen.getByRole("status").textContent).toBe(messages.workflows.saved);
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.cancelExcuse }),
  );
  state.cancelError = "Cancellation failed";
  view.rerender(element());
  expect(screen.getByRole("alert").textContent).toBe("Cancellation failed");
  expect(screen.queryByRole("status")).toBeNull();
});
