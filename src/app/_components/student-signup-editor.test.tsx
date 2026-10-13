/** @vitest-environment jsdom */
import { useEffect } from "react";
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { StudentSignupEditor } from "./student-signup-editor";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  options: vi.fn(),
  save: vi.fn(),
  headSave: vi.fn(),
  appeal: vi.fn(),
  refresh: vi.fn(),
  catalog: vi.fn(),
  grades: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["owned-signup"] }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: {
        mine: { invalidate: mocks.list },
        adminRequests: { invalidate: mocks.list },
      },
      admin: {
        tutees: { invalidate: mocks.list },
        pairings: { invalidate: mocks.list },
      },
    }),
    studentWorkflow: {
      signup: { useQuery: mocks.query },
      managedSignup: { useQuery: mocks.query },
      editSignup: {
        useMutation: () => ({ mutateAsync: mocks.save, isPending: false }),
      },
      headEditSignup: {
        useMutation: () => ({ mutateAsync: mocks.headSave, isPending: false }),
      },
      appealOwnedSignup: {
        useMutation: () => ({ mutateAsync: mocks.appeal, isPending: false }),
      },
    },
    tutee: { signupOptions: { useQuery: mocks.options } },
    program: {
      profilePolicy: {
        useQuery: () => ({
          data: { offeredGrades: [9, 10, 11, 12] },
          refetch: mocks.grades,
        }),
      },
    },
  },
}));
vi.mock("./profile-dialog", () => ({
  ProfileDialog: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));
vi.mock("./timed-action-dialog", () => ({
  TimedActionDialog: ({
    onConfirm,
    onCancel,
    busy,
    message,
  }: {
    onConfirm: (ticket: string) => void;
    onCancel: () => void;
    busy: boolean;
    message: string;
  }) => (
    <div role="dialog" aria-label="Management review">
      <p>{message}</p>
      <button disabled={busy} onClick={() => onConfirm("signed-ticket")}>
        Confirm management review
      </button>
      <button disabled={busy} onClick={onCancel}>
        Cancel management review
      </button>
    </div>
  ),
}));
vi.mock("./person-name-fields", () => ({
  ConfiguredPersonNameFields: ({
    value,
    onChange,
    onPolicyAvailabilityChange,
  }: {
    value: {
      firstName: string;
      lastName: string;
      preferredName: string;
      alternativeNames: string;
    };
    onChange: (next: typeof value) => void;
    onPolicyAvailabilityChange: (ready: boolean) => void;
  }) => {
    useEffect(
      () => onPolicyAvailabilityChange(true),
      [onPolicyAvailabilityChange],
    );
    return (
      <label>
        Request name
        <input
          value={value.firstName}
          onChange={(event) =>
            onChange({ ...value, firstName: event.target.value })
          }
        />
      </label>
    );
  },
}));
const source = (version = 0) => ({
  id: "request",
  version,
  editable: true,
  email: "owner@example.test",
  state: "OPEN",
  submittedAt: new Date("2026-10-01"),
  answers: {
    firstName: "Original",
    lastName: "Name",
    englishName: "Original Name",
    preferredContact: "Original contact",
    firstChoiceId: "math",
    secondChoiceId: "science",
    slotIds: ["monday"],
  },
  originalSignature: "Original signature",
  originalPolicyRevision: "original-policy",
  assignedSubjectIds: [] as string[],
  assignmentsUnresolved: false,
  subjectEditingBlocked: false,
  persistedSubjects: [
    { id: "math", name: "Mathematics", active: true },
    { id: "science", name: "Science", active: true },
  ],
  persistedSlots: [],
  isInvalid: false,
  invalidityVersion: 0,
  canAppeal: false,
  appeal: null as {
    id: string;
    reason: string;
    state: "PENDING" | "ACCEPTED" | "REJECTED";
    createdAt: Date;
  } | null,
});
const catalog = {
  subjects: [
    { id: "math", name: "Mathematics" },
    { id: "science", name: "Science" },
  ],
  slots: [
    { id: "monday", dayOfWeek: 1, startMin: 900, endMin: 960 },
    { id: "tuesday", dayOfWeek: 2, startMin: 900, endMin: 960 },
  ],
};
let current = source();
const view = (managed = false) => (
  <QueryClientProvider client={new QueryClient()}>
    <NextIntlClientProvider locale="en" messages={en}>
      <StudentSignupEditor
        managed={managed}
        requestId="request"
        onClose={vi.fn()}
      />
    </NextIntlClientProvider>
  </QueryClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  current = source();
  mocks.query.mockImplementation(() => ({
    data: current,
    isSuccess: true,
    refetch: mocks.refresh,
  }));
  mocks.options.mockReturnValue({ data: catalog, refetch: mocks.catalog });
  mocks.refresh.mockImplementation(async () => ({ data: current }));
  mocks.catalog.mockResolvedValue({ data: catalog });
  mocks.grades.mockResolvedValue({ data: { offeredGrades: [9, 10, 11, 12] } });
  mocks.list.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ ok: true, version: 1 });
  mocks.headSave.mockResolvedValue({ ok: true, version: 1 });
  mocks.appeal.mockResolvedValue({ ok: true, appealId: "appeal" });
});
afterEach(cleanup);

it("retains an owned appeal reason across a stale review; reload adopts only its review version", async () => {
  current = {
    ...source(),
    isInvalid: true,
    canAppeal: true,
    invalidityVersion: 2,
  };
  const mounted = render(view());
  fireEvent.change(
    screen.getByLabelText(/Why should this request be accepted/),
    { target: { value: "This is a genuine request" } },
  );
  fireEvent.change(screen.getByLabelText("Request name"), {
    target: { value: "Unsaved signup draft" },
  });
  current = { ...current, invalidityVersion: 3 };
  mounted.rerender(view());
  expect(screen.getByDisplayValue("This is a genuine request")).toBeTruthy();
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.signupAppeal.submit })
      .closest("form")!,
  );
  expect(mocks.appeal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: en.signupAppeal.reload }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.signupAppeal.submit })
      .closest("form")!,
  );
  await waitFor(() =>
    expect(mocks.appeal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "request",
        expectedInvalidityVersion: 3,
        reason: "This is a genuine request",
      }),
    ),
  );
  expect(screen.getByDisplayValue("Unsaved signup draft")).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("recovers only reads after an accepted owned appeal and keeps its reason out of URLs", async () => {
  current = {
    ...source(),
    isInvalid: true,
    canAppeal: true,
    invalidityVersion: 2,
  };
  mocks.refresh.mockResolvedValueOnce({ error: new Error("Offline") });
  render(view());
  fireEvent.change(
    screen.getByLabelText(/Why should this request be accepted/),
    { target: { value: "Please review" } },
  );
  const form = screen
    .getByRole("button", { name: en.signupAppeal.submit })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByText(en.signupAppeal.submitted);
  expect(mocks.appeal).toHaveBeenCalledOnce();
  current = {
    ...current,
    canAppeal: false,
    appeal: {
      id: "appeal",
      reason: "Please review",
      state: "PENDING",
      createdAt: new Date(),
    },
  };
  fireEvent.click(screen.getByRole("button", { name: en.signupAppeal.retry }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
  expect(mocks.appeal).toHaveBeenCalledOnce();
  expect(window.location.search).not.toContain("Please");
});

it("retains the failed draft and version through a background change; only a successful explicit Reload adopts it", async () => {
  mocks.save.mockRejectedValue(new Error("Conflict"));
  const mounted = render(view());
  fireEvent.change(screen.getByLabelText("Request name"), {
    target: { value: "Retained" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.signupEditing.save })
      .closest("form")!,
  );
  await screen.findByText("Conflict");
  expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
    expectedVersion: 0,
    answers: { firstName: "Retained" },
  });
  current = {
    ...source(2),
    answers: { ...source(2).answers, firstName: "Server" },
  };
  mounted.rerender(view());
  expect(screen.getByDisplayValue("Retained")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: en.signupEditing.save })
      .hasAttribute("disabled"),
  ).toBe(true);
  mocks.catalog.mockResolvedValueOnce({
    error: new Error("Offline"),
    data: catalog,
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.signupEditing.reload }),
  );
  await screen.findByText(en.signupEditing.reloadFailed);
  expect(screen.getByDisplayValue("Retained")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.signupEditing.reload }),
  );
  await screen.findByDisplayValue("Server");
});
it("keeps an accepted save read-only after refresh fails; recovery reads and then permits another versioned edit", async () => {
  mocks.refresh.mockResolvedValueOnce({
    error: new Error("Offline"),
    data: source(1),
  });
  render(view());
  fireEvent.change(screen.getByLabelText("Request name"), {
    target: { value: "Saved" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.signupEditing.save })
      .closest("form")!,
  );
  await screen.findByText(en.signupEditing.savedRefresh);
  expect(
    screen
      .getByRole("button", { name: en.signupEditing.save })
      .hasAttribute("disabled"),
  ).toBe(true);
  current = {
    ...source(1),
    answers: { ...source(1).answers, firstName: "Saved" },
  };
  fireEvent.click(
    screen.getByRole("button", { name: en.signupEditing.retryRefresh }),
  );
  await screen.findByText(en.signupEditing.saved);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Request name"), {
    target: { value: "Second" },
  });
  current = {
    ...source(2),
    answers: { ...source(2).answers, firstName: "Second" },
  };
  mocks.save.mockResolvedValueOnce({ ok: true, version: 2 });
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.signupEditing.save })
      .closest("form")!,
  );
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]?.[0]).toMatchObject({ expectedVersion: 1 });
});
it("admits one same-tick save and keeps exact failed-write retries bound to the original key and answers", async () => {
  let reject!: (error: Error) => void;
  mocks.save.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  render(view());
  const form = screen
    .getByRole("button", { name: en.signupEditing.save })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.save).toHaveBeenCalledOnce();
  const first: unknown = mocks.save.mock.calls[0]?.[0];
  await act(async () => reject(new Error("Response lost")));
  mocks.save.mockRejectedValueOnce(new Error("Retry failed"));
  fireEvent.submit(form);
  await screen.findByText("Retry failed");
  expect(mocks.save.mock.calls[1]?.[0]).toEqual(first);
});
it("shows and locks inactive assigned subjects and preserves original email/signature evidence", () => {
  current = {
    ...source(),
    assignedSubjectIds: ["math"],
    persistedSubjects: [
      { id: "math", name: "Retired Mathematics", active: false },
      { id: "science", name: "Science", active: true },
    ],
  };
  mocks.options.mockReturnValue({
    data: { ...catalog, subjects: [{ id: "science", name: "Science" }] },
    refetch: mocks.catalog,
  });
  render(view());
  const first = screen.getByLabelText(/Subject — First Choice/);
  expect(first.hasAttribute("disabled")).toBe(true);
  expect(
    within(first).getByRole("option", { name: "Retired Mathematics" }),
  ).toBeTruthy();
  expect(
    screen.getByDisplayValue("owner@example.test").hasAttribute("readonly"),
  ).toBe(true);
  expect(screen.getByText("Original signature")).toBeTruthy();
  expect(screen.getByText("original-policy")).toBeTruthy();
});
it("does not resurrect retained private answers after denial is followed by a transport failure", async () => {
  const mounted = render(view());
  expect(screen.getByDisplayValue("Original")).toBeTruthy();
  mocks.query.mockReturnValue({
    data: current,
    error: { data: { code: "FORBIDDEN" } },
    refetch: mocks.refresh,
  });
  mounted.rerender(view());
  expect(screen.queryByDisplayValue("Original")).toBeNull();
  mocks.query.mockReturnValue({
    data: current,
    error: { data: { code: "INTERNAL_SERVER_ERROR" } },
    refetch: mocks.refresh,
  });
  mounted.rerender(view());
  expect(screen.getByText(en.signupEditing.denied)).toBeTruthy();
  expect(screen.queryByDisplayValue("Original")).toBeNull();
});
it("disables terminal/historical editing without replacing its source evidence", () => {
  current = { ...source(), editable: false, state: "RECALLED" };
  render(view());
  expect(screen.getByText(en.signupEditing.readOnly)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: en.signupEditing.save })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Original signature")).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("management changes pass through the explicit timed review and retain their captured version", async () => {
  current = { ...source(), assignedSubjectIds: ["math"] };
  const mounted = render(view(true));
  expect(
    screen.getByLabelText(/Subject — First Choice/).hasAttribute("disabled"),
  ).toBe(false);
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.signupEditing.headEdit })
      .closest("form")!,
  );
  expect(mocks.headSave).not.toHaveBeenCalled();
  current = source(4);
  mounted.rerender(view(true));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm management review" }),
  );
  // A fresh background version requires Reload; the reviewed draft never adopts it.
  expect(mocks.headSave).not.toHaveBeenCalled();
});
it("shows an accepted management proposal without replaying it or pretending the live answers changed", async () => {
  mocks.headSave.mockRejectedValueOnce(
    Object.assign(new Error("Approval required"), {
      data: { approvalId: "proposal-1" },
    }),
  );
  render(view(true));
  fireEvent.submit(
    screen
      .getByRole("button", { name: en.signupEditing.headEdit })
      .closest("form")!,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm management review" }),
  );
  const link = await screen.findByRole("link", {
    name: en.signupEditing.queued,
  });
  expect(link.getAttribute("href")).toBe("/admin/approvals?request=proposal-1");
  expect(mocks.headSave.mock.calls[0]?.[0]).toMatchObject({
    expectedVersion: 0,
    signedTicket: "signed-ticket",
    releaseChangedAssignments: true,
  });
  expect(mocks.save).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: en.signupEditing.headEdit })
      .hasAttribute("disabled"),
  ).toBe(true);
});
