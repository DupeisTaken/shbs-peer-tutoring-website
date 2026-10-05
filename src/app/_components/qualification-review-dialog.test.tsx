// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { QualificationReview } from "./qualification-review";
import { ReadOnlyProvider } from "./read-only";

const mocks = vi.hoisted(() => ({
  role: "ADMIN",
  tutorId: "reviewer",
  revoked: false,
  decide: vi.fn(),
  changed: vi.fn(),
  invalidate: vi.fn(),
  fetch: vi.fn(),
}));
type Callbacks = {
  onSuccess: () => Promise<void>;
  onError: () => void;
  onSettled: () => void;
};
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () => ({
          data: {
            role: mocks.role,
            tutorId: mocks.tutorId,
            tutorAccessRevoked: mocks.revoked,
          },
        }),
      },
    },
    qualificationApplication: {
      decide: {
        useMutation: (callbacks: Callbacks) => {
          // Model asynchronous success/refetch separately from transport failure.
          const [isPending, setPending] = useState(false);
          const [error, setError] = useState<Error | null>(null);
          return {
            isPending,
            error,
            reset: () => setError(null),
            mutate: (input: unknown) => {
              setPending(true);
              setError(null);
              void (async () => {
                try {
                  await mocks.decide(input);
                  await callbacks.onSuccess();
                } catch (failure) {
                  setError(failure as Error);
                  callbacks.onError();
                } finally {
                  setPending(false);
                  callbacks.onSettled();
                }
              })();
            },
          };
        },
      },
    },
    useUtils: () => ({
      qualificationApplication: { mine: { invalidate: mocks.invalidate } },
      subjectAvailability: { options: { invalidate: mocks.invalidate } },
      admin: {
        tutors: { invalidate: mocks.invalidate },
        tutorApplications: { fetch: mocks.fetch },
      },
      tutorDetails: { get: { invalidate: mocks.invalidate } },
    }),
  },
}));
type App = React.ComponentProps<typeof QualificationReview>["app"];
const base: App = {
  id: "request",
  name: "Ada Chen",
  type: "ADDITIONAL_SUBJECT",
  status: "PENDING",
  subjectIntents: [{ subject: { name: "AP History" } }],
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  decisionComment: null,
  requestedTutorId: "applicant",
  qualificationReason: "Synthetic evidence",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "ADMIN";
  mocks.tutorId = "reviewer";
  mocks.revoked = false;
  mocks.decide.mockResolvedValue({ ok: true });
  mocks.changed.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue([base]);
});
afterEach(cleanup);
const element = (app = base, readOnly = false, locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
    <ReadOnlyProvider value={readOnly}>
      <QualificationReview app={app} onChanged={mocks.changed} />
    </ReadOnlyProvider>
  </NextIntlClientProvider>
);
const show = (app = base, readOnly = false) => render(element(app, readOnly));
function openReview() {
  const entry = screen.getByRole("button", {
    name: "Approve without Interview",
  });
  entry.focus();
  fireEvent.click(entry);
  return entry;
}
const writeNote = (value = "Evidence reviewed") =>
  fireEvent.change(screen.getByLabelText("Decision note"), {
    target: { value },
  });
const approve = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Approve qualification" }),
  );
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(["ADDITIONAL_SUBJECT", "HIGHER_LEVEL"] as const)(
  "starts %s closed, opens without writing, and preserves the note through cancel/reopen and Escape",
  (type) => {
    show({ ...base, type });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Decision note")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject request" })).toBeNull();
    const entry = openReview();
    const dialog = screen.getByRole("dialog", {
      name: "Review Qualification Request",
    });
    expect(within(dialog).getByText("Ada Chen")).toBeTruthy();
    expect(within(dialog).getByText(/AP History/)).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: "Reject request" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.changed).not.toHaveBeenCalled();
    writeNote();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(entry);
    openReview();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Evidence reviewed",
    );
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(entry);
    expect(mocks.decide).not.toHaveBeenCalled();
  },
);

it.each(["ADMIN", "HEAD"])(
  "allows %s to approve and refresh only after a nonblank note",
  async (role) => {
    mocks.role = role;
    show();
    openReview();
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Approve qualification",
    });
    expect(button.disabled).toBe(true);
    writeNote(" \n ");
    expect(button.disabled).toBe(true);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").required).toBe(
      true,
    );
    writeNote();
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.decide).toHaveBeenCalledExactlyOnceWith({
      id: base.id,
      accept: true,
      comment: "Evidence reviewed",
      expectedUpdatedAt: base.updatedAt,
    });
    expect(mocks.changed).toHaveBeenCalledWith(true);
    expect(mocks.invalidate).toHaveBeenCalledTimes(4);
    expect(screen.getByText("Decision saved.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Approve without Interview" }),
    ).toBeNull();
  },
);

it("lets the assigned chair reject after an interview with the existing endpoint and required note", async () => {
  show({
    ...base,
    type: "HIGHER_LEVEL",
    status: "INTERVIEW",
    interviewers: [{ isHead: true, tutor: { id: "reviewer" } }],
  });
  const reject = screen.getByRole<HTMLButtonElement>("button", {
    name: "Reject request",
  });
  expect(reject.disabled).toBe(true);
  writeNote(" \n ");
  expect(reject.disabled).toBe(true);
  writeNote("More evidence needed");
  fireEvent.click(reject);
  await waitFor(() => expect(mocks.changed).toHaveBeenCalledWith(true));
  expect(mocks.decide).toHaveBeenCalledExactlyOnceWith({
    id: base.id,
    accept: false,
    comment: "More evidence needed",
    expectedUpdatedAt: base.updatedAt,
  });
});

it("hides self-review, including a revoked tutor badge", () => {
  mocks.tutorId = "applicant";
  mocks.revoked = true;
  show();
  expect(screen.queryByRole("button")).toBeNull();
});
it("honors read-only management access even for a stale staff role", () => {
  show(base, true);
  expect(screen.queryByRole("button")).toBeNull();
});
it.each(["ACCEPTED", "REJECTED", "RECALLED"])(
  "keeps %s evidence with no review controls",
  (status) => {
    show({ ...base, status });
    expect(screen.getByText("Synthetic evidence")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  },
);
it("excludes initial applications", () => {
  show({ ...base, type: "INITIAL" });
  expect(screen.queryByRole("button")).toBeNull();
});
it.each(["PENDING", "INTERVIEW"])(
  "never offers direct entry when a panel exists (%s)",
  (status) => {
    show({
      ...base,
      status,
      interviewers: [{ isHead: true, tutor: { id: "another-chair" } }],
    });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  },
);
it("retains the authorized chair's inline panel decision workflow", async () => {
  show({
    ...base,
    status: "INTERVIEW",
    interviewers: [{ isHead: true, tutor: { id: "reviewer" } }],
  });
  expect(
    screen.queryByRole("button", { name: "Approve without Interview" }),
  ).toBeNull();
  expect(screen.getByText(/after every panelist has voted/)).toBeTruthy();
  writeNote();
  approve();
  await waitFor(() => expect(mocks.changed).toHaveBeenCalledWith(true));
  expect(mocks.decide).toHaveBeenCalledTimes(1);
});
it("does not expose the chair controls with revoked tutor access", () => {
  mocks.revoked = true;
  show({
    ...base,
    status: "INTERVIEW",
    interviewers: [{ isHead: true, tutor: { id: "reviewer" } }],
  });
  expect(screen.queryByRole("button")).toBeNull();
});

it("blocks duplicate approvals, note changes and dismissal while writing and refreshing", async () => {
  const write = deferred(),
    refresh = deferred();
  mocks.decide.mockReturnValue(write.promise);
  mocks.changed.mockReturnValue(refresh.promise);
  show();
  openReview();
  writeNote();
  const yes = screen.getByRole("button", { name: "Approve qualification" });
  act(() => {
    yes.click();
    yes.click();
  });
  expect(mocks.decide).toHaveBeenCalledTimes(1);
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").disabled).toBe(true);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => write.resolve());
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  await act(async () => refresh.resolve());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("blocks opposite interview decisions in the same tick", async () => {
  const write = deferred();
  mocks.decide.mockReturnValue(write.promise);
  show({
    ...base,
    status: "INTERVIEW",
    interviewers: [{ isHead: true, tutor: { id: "reviewer" } }],
  });
  writeNote();
  const yes = screen.getByRole("button", { name: "Approve qualification" });
  const no = screen.getByRole("button", { name: "Reject request" });
  act(() => {
    no.click();
    yes.click();
    no.click();
  });
  expect(mocks.decide).toHaveBeenCalledExactlyOnceWith({
    id: base.id,
    accept: false,
    comment: "Evidence reviewed",
    expectedUpdatedAt: base.updatedAt,
  });
  await act(async () => write.resolve());
});

it("preserves the failed draft/version through background refresh and retry; explicit reload replaces it only after a successful read", async () => {
  mocks.decide.mockRejectedValue(
    new Error("Request changed. Reload before deciding."),
  );
  const view = show();
  openReview();
  writeNote();
  approve();
  await screen.findByText("Request changed. Reload before deciding.");
  const updatedAt = new Date("2026-09-02T00:00:00Z");
  view.rerender(element({ ...base, updatedAt }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  openReview();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Evidence reviewed",
  );
  approve();
  await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(2));
  expect(mocks.decide.mock.calls[1]?.[0]).toMatchObject({
    expectedUpdatedAt: base.updatedAt,
  });
  await waitFor(() =>
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").disabled).toBe(
      false,
    ),
  );
  mocks.fetch.mockRejectedValueOnce(new Error("Reload failed"));
  fireEvent.click(screen.getByRole("button", { name: "Reload review" }));
  await screen.findByText("Reload failed");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Evidence reviewed",
  );
  mocks.fetch.mockResolvedValueOnce([{ ...base, updatedAt }]);
  fireEvent.click(screen.getByRole("button", { name: "Reload review" }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(""),
  );
  writeNote("Reviewed latest evidence");
  approve();
  await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(3));
  expect(mocks.decide.mock.calls[2]?.[0]).toMatchObject({
    expectedUpdatedAt: updatedAt,
    comment: "Reviewed latest evidence",
  });
  await screen.findByText("Request changed. Reload before deciding.");
});

it("retains a failed note and allows a successful write retry", async () => {
  mocks.decide.mockRejectedValueOnce(new Error("Connection lost"));
  show();
  openReview();
  writeNote();
  approve();
  await screen.findByText("Connection lost");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Evidence reviewed",
  );
  approve();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.decide).toHaveBeenCalledTimes(2);
});

it("recovers a committed decision's failed refresh without repeating the write, even after closing the dialog", async () => {
  mocks.changed.mockRejectedValueOnce(new Error("Application refresh failed"));
  show();
  openReview();
  writeNote();
  approve();
  await screen.findByText("Application refresh failed");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").disabled).toBe(true);
  expect(
    screen.queryByRole("button", { name: "Approve qualification" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject request" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByText("Decision saved.")).toBeTruthy());
  expect(mocks.decide).toHaveBeenCalledTimes(1);
  expect(mocks.changed).toHaveBeenCalledTimes(2);
});

it("removes open direct-review controls when another reviewer assigns a panel", () => {
  const view = show();
  openReview();
  writeNote();
  view.rerender(
    element({
      ...base,
      status: "INTERVIEW",
      interviewers: [{ isHead: true, tutor: { id: "other" } }],
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(mocks.decide).not.toHaveBeenCalled();
});
it("renders the shared prompt and actions in Chinese", () => {
  render(element(base, false, "zh"));
  fireEvent.click(
    screen.getByRole("button", {
      name: zh.qualificationRequests.approveWithoutInterview,
    }),
  );
  expect(
    screen.getByRole("dialog", { name: zh.qualificationRequests.reviewTitle }),
  ).toBeTruthy();
  expect(
    screen.getByLabelText(zh.qualificationRequests.decisionNote),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: zh.qualificationRequests.approve }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: zh.qualificationRequests.reject }),
  ).toBeNull();
});
