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
  InterviewApprovalDialog,
  type InterviewApprovalEvidence,
} from "./interview-approval-dialog";

const record: InterviewApprovalEvidence = {
  id: "interview",
  name: "Sample Applicant",
  type: "INITIAL",
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  interviewCompletedAt: null,
  interviewDurationMin: null,
  panel: [
    { tutorId: "chair", name: "Admin Chair", attended: false },
    { tutorId: "one", name: "Panelist One", attended: false },
    { tutorId: "two", name: "Panelist Two", attended: false },
  ],
};
const commit = vi.fn(),
  refresh = vi.fn(),
  reload = vi.fn(),
  close = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  commit.mockResolvedValue({ ok: true });
  refresh.mockResolvedValue(undefined);
  reload.mockResolvedValue(record);
});
afterEach(cleanup);
const element = (
  evidence = record,
  canApprove = true,
  authorized = true,
  locale: "en" | "zh" = "en",
  canRetrySubmitted = false,
) => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "en" ? en : zh}
  >
    <InterviewApprovalDialog
      evidence={evidence}
      initialComment="Panel evidence reviewed"
      authorized={authorized}
      canApprove={canApprove}
      canRetrySubmitted={canRetrySubmitted}
      commit={commit}
      refresh={refresh}
      reload={reload}
      onClose={close}
    />
  </NextIntlClientProvider>
);
const editor = () => screen.getAllByRole("dialog")[0]!;
const confirmation = () => screen.getAllByRole("dialog").at(-1)!;
function fill() {
  fireEvent.change(
    within(editor()).getByLabelText(en.workflows.interviewComplete),
    { target: { value: "2026-09-01T10:00" } },
  );
  fireEvent.change(within(editor()).getByLabelText(en.workflows.duration), {
    target: { value: "45" },
  });
  fireEvent.click(within(editor()).getByLabelText("Admin Chair"));
  fireEvent.click(within(editor()).getByLabelText("Panelist One"));
}
const review = () =>
  fireEvent.click(
    within(editor()).getByRole("button", { name: en.interviewApproval.review }),
  );
const confirm = () =>
  fireEvent.click(
    within(confirmation()).getByRole("button", {
      name: en.interviewApproval.confirm,
    }),
  );
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("requires actual attendance, previews minutes as hours, and submits only selected attendees after confirmation", async () => {
  render(element());
  expect(screen.getByRole("dialog").textContent).toContain("Sample Applicant");
  for (const box of screen.getAllByRole<HTMLInputElement>("checkbox"))
    expect(box.checked).toBe(false);
  expect(commit).not.toHaveBeenCalled();
  fill();
  expect(
    screen.getByText("45 minutes = 0.75 hours per attendee."),
  ).toBeTruthy();
  review();
  expect(
    within(confirmation()).getByText(en.interviewApproval.effectsInitial),
  ).toBeTruthy();
  expect(within(confirmation()).getByText("Admin Chair")).toBeTruthy();
  expect(within(confirmation()).queryByText("Panelist Two")).toBeNull();
  expect(commit).not.toHaveBeenCalled();
  confirm();
  await waitFor(() =>
    expect(commit).toHaveBeenCalledExactlyOnceWith({
      comment: "Panel evidence reviewed",
      expectedUpdatedAt: record.updatedAt,
      completion: {
        completedAt: new Date("2026-09-01T02:00:00Z"),
        durationMin: 45,
        attendedTutorIds: ["chair", "one"],
      },
    }),
  );
  expect(await screen.findByText(en.interviewApproval.saved)).toBeTruthy();
});

it("rejects an empty attendance list and invalid duration without opening a confirmation or writing", () => {
  render(element());
  fireEvent.change(screen.getByLabelText(en.workflows.interviewComplete), {
    target: { value: "2026-09-01T10:00" },
  });
  fireEvent.change(screen.getByLabelText(en.workflows.duration), {
    target: { value: "45" },
  });
  fireEvent.submit(editor().querySelector("form")!);
  expect(screen.getByRole("alert").textContent).toContain(
    en.interviewReview.invalidEvidence,
  );
  fireEvent.click(screen.getByLabelText("Admin Chair"));
  for (const value of ["0", "481", "1.5"]) {
    fireEvent.change(screen.getByLabelText(en.workflows.duration), {
      target: { value },
    });
    fireEvent.submit(editor().querySelector("form")!);
  }
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(commit).not.toHaveBeenCalled();
});

it("cancels the confirmation without discarding the draft and returns it on closing the editor", () => {
  render(element());
  fill();
  review();
  fireEvent.click(
    within(confirmation()).getByRole("button", {
      name: en.actionReview.cancel,
    }),
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen.getByLabelText<HTMLInputElement>(en.workflows.duration).value,
  ).toBe("45");
  fireEvent.click(
    within(editor()).getByRole("button", { name: en.common.cancel }),
  );
  expect(close).toHaveBeenCalledWith(
    expect.objectContaining({
      evidence: record,
      duration: "45",
      attended: ["chair", "one"],
      comment: "Panel evidence reviewed",
    }),
  );
  expect(commit).not.toHaveBeenCalled();
});

it("guards same-turn duplicate awards and pending dismissal, then retries failed synchronization with reads only", async () => {
  const write = deferred(),
    read = deferred();
  commit.mockReturnValueOnce(write.promise);
  refresh.mockImplementationOnce(async () => {
    await read.promise;
    throw new Error("Read offline");
  });
  render(element());
  fill();
  review();
  const yes = within(confirmation()).getByRole("button", {
    name: en.interviewApproval.confirm,
  });
  act(() => {
    yes.click();
    yes.click();
  });
  expect(commit).toHaveBeenCalledTimes(1);
  fireEvent(confirmation(), new Event("cancel", { cancelable: true }));
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  await act(async () => write.resolve());
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  await act(async () => read.resolve());
  await screen.findByText(en.actionReview.refreshFailed);
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.close }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.retry }));
  await screen.findByText(en.actionReview.applied);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(commit).toHaveBeenCalledTimes(1);
});

it("preserves failed evidence and version across refresh, and replaces the draft only after a successful explicit reload", async () => {
  commit.mockRejectedValue(new Error("Evidence changed"));
  const view = render(element());
  fill();
  review();
  confirm();
  await screen.findByText("Evidence changed");
  const changed = { ...record, updatedAt: new Date("2026-09-02T00:00:00Z") };
  view.rerender(element(changed));
  fireEvent.click(
    within(confirmation()).getByRole("button", {
      name: en.actionReview.cancel,
    }),
  );
  expect(
    screen.getByLabelText<HTMLInputElement>(en.workflows.duration).value,
  ).toBe("45");
  review();
  confirm();
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  expect(commit.mock.calls[1]?.[0]).toMatchObject({
    expectedUpdatedAt: record.updatedAt,
  });
  await screen.findByText("Evidence changed");
  fireEvent.click(
    within(confirmation()).getByRole("button", {
      name: en.actionReview.cancel,
    }),
  );
  reload.mockRejectedValueOnce(new Error("Reload offline"));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewApproval.reload }),
  );
  await screen.findByText("Reload offline");
  expect(
    screen.getByLabelText<HTMLInputElement>(en.workflows.duration).value,
  ).toBe("45");
  reload.mockResolvedValueOnce(changed);
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewApproval.reload }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(
        en.qualificationRequests.decisionNote,
      ).value,
    ).toBe(""),
  );
  fill();
  fireEvent.change(
    screen.getByLabelText(en.qualificationRequests.decisionNote),
    { target: { value: "Fresh evidence" } },
  );
  review();
  confirm();
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(3));
  expect(commit.mock.calls[2]?.[0]).toMatchObject({
    expectedUpdatedAt: changed.updatedAt,
  });
});

it("reuses exact recorded completion including seconds and attendance without offering an hour correction", async () => {
  const recorded = {
    ...record,
    interviewCompletedAt: new Date("2026-09-01T02:00:37.456Z"),
    interviewDurationMin: 45,
    panel: record.panel.map((person) => ({
      ...person,
      attended: person.tutorId === "chair",
    })),
  };
  render(element(recorded));
  expect(
    screen.getByLabelText<HTMLInputElement>(en.workflows.interviewComplete)
      .disabled,
  ).toBe(true);
  expect(
    screen.getByLabelText<HTMLInputElement>(en.workflows.duration).disabled,
  ).toBe(true);
  expect(
    screen.getByLabelText<HTMLInputElement>("Admin Chair").closest("fieldset")
      ?.disabled,
  ).toBe(true);
  expect(screen.getByText(en.interviewApproval.recorded)).toBeTruthy();
  review();
  confirm();
  await waitFor(() =>
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        completion: {
          completedAt: recorded.interviewCompletedAt,
          durationMin: 45,
          attendedTutorIds: ["chair"],
        },
      }),
    ),
  );
});

it("replays only the exact submitted payload after a lost response and an accepted background update", async () => {
  commit.mockRejectedValueOnce(new Error("Response lost"));
  const view = render(element());
  fill();
  review();
  confirm();
  await screen.findByText("Response lost");
  const submitted = commit.mock.calls[0]?.[0] as unknown;
  fireEvent.click(
    within(confirmation()).getByRole("button", {
      name: en.actionReview.cancel,
    }),
  );
  fireEvent.change(screen.getByLabelText(en.workflows.duration), {
    target: { value: "60" },
  });
  fireEvent.click(screen.getByLabelText("Panelist Two"));
  fireEvent.change(
    screen.getByLabelText(en.qualificationRequests.decisionNote),
    { target: { value: "Later unsent edit" } },
  );
  view.rerender(
    element(
      { ...record, updatedAt: new Date("2026-09-02T00:00:00Z") },
      false,
      true,
      "en",
      true,
    ),
  );
  expect(
    screen
      .getByLabelText(en.qualificationRequests.decisionNote)
      .closest("fieldset")?.disabled,
  ).toBe(true);
  expect(
    screen.getByLabelText<HTMLInputElement>(en.workflows.duration).value,
  ).toBe("45");
  expect(screen.getByLabelText<HTMLInputElement>("Panelist Two").checked).toBe(
    false,
  );
  review();
  expect(within(confirmation()).queryByText("Panelist Two")).toBeNull();
  expect(
    within(confirmation()).getByText("Panel evidence reviewed"),
  ).toBeTruthy();
  confirm();
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  expect(commit.mock.calls[1]?.[0]).toBe(submitted);
  expect(reload).not.toHaveBeenCalled();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it("never offers accepted-record replay before any submission", () => {
  render(element(record, false, true, "en", true));
  fill();
  fireEvent.submit(editor().querySelector("form")!);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(commit).not.toHaveBeenCalled();
});

it("withholds confirmation until voting is complete and hides private evidence when authority is revoked", () => {
  const view = render(element(record, false));
  fill();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.interviewApproval.review,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(editor().querySelector("form")!);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  view.rerender(element(record, true, false));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(commit).not.toHaveBeenCalled();
});

it("describes qualification effects without a registration-code grant and renders Chinese fields", () => {
  render(element({ ...record, type: "HIGHER_LEVEL" }, true, true, "zh"));
  fireEvent.change(screen.getByLabelText(zh.workflows.interviewComplete), {
    target: { value: "2026-09-01T10:00" },
  });
  fireEvent.change(screen.getByLabelText(zh.workflows.duration), {
    target: { value: "30" },
  });
  fireEvent.click(screen.getByLabelText("Admin Chair"));
  fireEvent.click(
    screen.getByRole("button", { name: zh.interviewApproval.review }),
  );
  expect(
    within(confirmation()).getByText(zh.interviewApproval.effectsQualification),
  ).toBeTruthy();
  expect(
    within(confirmation()).getByRole("button", {
      name: zh.interviewApproval.confirm,
    }),
  ).toBeTruthy();
});
