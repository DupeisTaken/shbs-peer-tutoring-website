// @vitest-environment jsdom
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  InterviewPanelEditor,
  type PanelTutor,
} from "./interview-panel-editor";

const mocks = vi.hoisted(() => {
  const callbacks: {
    onSuccess?: () => Promise<void> | void;
    onError?: () => Promise<void> | void;
  } = {};
  return {
    loading: false,
    error: null as Error | null,
    pending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
    refetch: vi.fn(),
    saved: false,
    saveError: null as Error | null,
    callbacks,
  };
});
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      subjectEligibility: {
        useQuery: () => ({
          data: [
            { tutorId: "a", subjectId: "math" },
            { tutorId: "b", subjectId: "physics" },
          ],
          isLoading: mocks.loading,
          error: mocks.error,
          refetch: mocks.refetch,
        }),
      },
      assignInterviewers: {
        useMutation: (callbacks: typeof mocks.callbacks) => {
          mocks.callbacks = callbacks;
          return {
            mutate: mocks.mutate,
            isPending: mocks.pending,
            isSuccess: mocks.saved,
            error: mocks.saveError,
            reset: mocks.reset,
          };
        },
      },
    },
  },
}));
const tutors: PanelTutor[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(
  (id) => ({
    id,
    englishName: `Tutor ${id.toUpperCase()}`,
    status: "ACTIVE",
    user: {
      role: id === "a" ? "HEAD" : id === "c" ? "ADMIN" : "TUTOR",
      tutorAccessRevoked: false,
      suspendedAt: null,
    },
  }),
);
const updatedAt = new Date("2026-09-01");
const props = {
  applicationId: "app",
  updatedAt,
  requestedTutorId: null as string | null,
  subjects: [
    { id: "math", label: "Math · AP" },
    { id: "physics", label: "Physics" },
  ],
  interviewers: [] as {
    isHead: boolean;
    tutor: { id: string; englishName: string };
  }[],
  tutors,
  onChanged: vi.fn(),
};
function show(
  overrides: Partial<ComponentProps<typeof InterviewPanelEditor>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InterviewPanelEditor {...props} {...overrides} />
    </NextIntlClientProvider>,
  );
}
const slot = (n: number) =>
  screen.getByRole("combobox", { name: new RegExp(`Panelist ${n}`) });
const save = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Save Panel" });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.loading = false;
  mocks.error = null;
  mocks.pending = false;
  mocks.saved = false;
  mocks.saveError = null;
  mocks.callbacks = {};
  mocks.reset.mockImplementation(() => {
    mocks.saveError = null;
    mocks.saved = false;
  });
});
afterEach(cleanup);

it("groups by explicit grants across any requested subject, then by a focused subject without losing picks", () => {
  show();
  const qualified = within(slot(1)).getByRole("group", {
    name: "Qualified in the selected subjects",
  });
  expect(
    within(qualified)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Tutor A — Math · AP", "Tutor B — Physics"]);
  fireEvent.change(slot(1), { target: { value: "b" } });
  fireEvent.change(screen.getByLabelText("Group panelists by subject"), {
    target: { value: "math" },
  });
  expect((slot(1) as HTMLSelectElement).value).toBe("b");
  expect(
    within(slot(1))
      .getByRole("option", { name: "Tutor B — Physics" })
      .parentElement?.getAttribute("label"),
  ).toBe("Other available tutors");
  expect(
    within(slot(2)).queryByRole("option", { name: "Tutor B — Physics" }),
  ).toBeNull();
});
it("requires three distinct panelists and a chair and sends the original concurrency token", () => {
  show();
  expect(save().disabled).toBe(true);
  ["a", "b", "c"].forEach((id, index) =>
    fireEvent.change(slot(index + 1), { target: { value: id } }),
  );
  expect(save().disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Choose panelist 3 as chair"));
  fireEvent.change(slot(3), { target: { value: "d" } });
  expect(save().disabled).toBe(true);
  fireEvent.change(slot(3), { target: { value: "c" } });
  expect(save().disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Choose panelist 3 as chair"));
  const saveButton = save();
  fireEvent.click(saveButton);
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(mocks.mutate).toHaveBeenCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "c"],
    headTutorId: "c",
    expectedUpdatedAt: updatedAt,
  });
  expect(saveButton.textContent).toBe(en.admin.applications.saving);
  expect(saveButton.disabled).toBe(true);
  [1, 2, 3].forEach((index) => {
    expect((slot(index) as HTMLSelectElement).disabled).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>("radio", {
        name: `Choose panelist ${index} as chair`,
      }).disabled,
    ).toBe(true);
  });
});
it("allows an Admin chair alongside Head while keeping Coordinators as ordinary panelists", () => {
  show({
    tutors: tutors.map((tutor) =>
      tutor.id === "b"
        ? { ...tutor, user: { ...tutor.user!, role: "COORDINATOR" } }
        : tutor,
    ),
  });
  ["a", "b", "c"].forEach((id, index) =>
    fireEvent.change(slot(index + 1), { target: { value: id } }),
  );
  const headChair = screen.getByRole<HTMLInputElement>("radio", {
    name: "Choose panelist 1 as chair",
  });
  const coordinatorChair = screen.getByRole<HTMLInputElement>("radio", {
    name: "Choose panelist 2 as chair",
  });
  const adminChair = screen.getByRole<HTMLInputElement>("radio", {
    name: "Choose panelist 3 as chair",
  });
  expect(headChair.disabled).toBe(false);
  expect(coordinatorChair.disabled).toBe(true);
  expect(adminChair.disabled).toBe(false);
  fireEvent.click(coordinatorChair);
  expect(save().disabled).toBe(true);
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(adminChair);
  expect(save().disabled).toBe(false);
  fireEvent.click(save());
  expect(mocks.mutate).toHaveBeenCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "c"],
    headTutorId: "c",
    expectedUpdatedAt: updatedAt,
  });
});
it("retains a former non-management chair without permitting the old chair assignment to be saved", () => {
  show({
    interviewers: tutors.slice(0, 3).map((tutor) => ({
      tutor,
      isHead: tutor.id === "b",
    })),
  });
  const formerChair = screen.getByRole<HTMLInputElement>("radio", {
    name: "Choose panelist 2 as chair",
  });
  expect((slot(2) as HTMLSelectElement).value).toBe("b");
  expect(formerChair.checked).toBe(true);
  expect(formerChair.disabled).toBe(true);
  expect(save().disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("radio", { name: "Choose panelist 3 as chair" }),
  );
  expect(save().disabled).toBe(false);
  expect((slot(2) as HTMLSelectElement).value).toBe("b");
});
it("uses a standard commit action while retaining compact panel-slot tools", () => {
  show();
  expect(save().classList.contains("control-standard")).toBe(true);
  expect(save().classList.contains("btn-sm")).toBe(false);
  expect(
    screen
      .getByRole("button", { name: /Add Interviewer/ })
      .classList.contains("control-compact"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: /Remove Last Interviewer/ })
      .classList.contains("control-compact"),
  ).toBe(true);
});
it("retains unavailable historical labels and blocks saving until replacement", () => {
  show({
    interviewers: [
      { isHead: true, tutor: { id: "gone", englishName: "Former Chair" } },
    ],
  });
  const retained = screen.getByRole<HTMLOptionElement>("option", {
    name: "Former Chair (unavailable — replace this selection)",
  });
  expect(retained.disabled).toBe(true);
  expect((slot(1) as HTMLSelectElement).value).toBe("gone");
  expect(save().disabled).toBe(true);
});
it("excludes inactive, revoked, suspended and accountless tutors", () => {
  show({
    tutors: [
      { ...tutors[0]!, status: "GRADUATED" },
      { ...tutors[1]!, user: null },
      {
        ...tutors[2]!,
        user: { role: "ADMIN", tutorAccessRevoked: true, suspendedAt: null },
      },
      {
        ...tutors[3]!,
        user: {
          role: "HEAD",
          tutorAccessRevoked: false,
          suspendedAt: new Date(),
        },
      },
      tutors[4]!,
    ],
  });
  expect(
    within(slot(1))
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["— Panelist 1 —", "Tutor E"]);
});

it("excludes the applicant from their own qualification panel", () => {
  show({ requestedTutorId: "a" });
  expect(within(slot(1)).queryByRole("option", { name: /Tutor A/ })).toBeNull();
  expect(within(slot(1)).getByRole("option", { name: /Tutor B/ })).toBeTruthy();
});
it("preserves panels larger than three and enforces the eight-slot limit", () => {
  show({
    interviewers: tutors
      .slice(0, 5)
      .map((tutor, index) => ({ isHead: index === 0, tutor })),
  });
  expect(slot(5)).toBeTruthy();
  const add = screen.getByRole<HTMLButtonElement>("button", {
    name: /Add Interviewer/,
  });
  fireEvent.click(add);
  fireEvent.click(add);
  fireEvent.click(add);
  expect(slot(8)).toBeTruthy();
  expect(add.disabled).toBe(true);
  const remove = screen.getByRole<HTMLButtonElement>("button", {
    name: /Remove Last Interviewer/,
  });
  for (let i = 0; i < 5; i++) fireEvent.click(remove);
  expect(remove.disabled).toBe(true);
});
it("does not mislabel failed/loading qualifications as unqualified and offers retry", () => {
  mocks.loading = true;
  const view = show();
  expect((slot(1) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText("Loading subject qualifications…")).toBeTruthy();
  view.unmount();
  mocks.loading = false;
  mocks.error = new Error("offline");
  show();
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(save().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry qualifications" }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
it("disables edits while saving and exposes server errors", () => {
  mocks.pending = true;
  mocks.saveError = new Error("Panel changed; reload");
  show();
  expect((slot(1) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe("Panel changed; reload");
});

const panel = (ids: string[], chair: string) =>
  ids.map((id) => ({
    isHead: id === chair,
    tutor: { id, englishName: `Tutor ${id.toUpperCase()}` },
  }));

it.each(["en", "zh"] as const)(
  "keeps a retained panel and its original version together after background refresh (%s)",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const refreshedVersion = new Date("2026-09-01T00:01:00Z");
    const view = (version: Date, ids: string[], chair: string) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <InterviewPanelEditor
          {...props}
          updatedAt={version}
          interviewers={panel(ids, chair)}
        />
      </NextIntlClientProvider>
    );
    const { rerender } = render(view(updatedAt, ["a", "b", "c"], "a"));
    // The retained editor owns panel A. A background read of saved panel B must
    // not authorize overwriting B with A by lending A the new concurrency token.
    rerender(view(refreshedVersion, ["c", "d", "e"], "c"));
    const selectedIds = screen
      .getAllByRole<HTMLSelectElement>("combobox")
      .slice(1)
      .map((select) => select.value);
    expect(selectedIds).toEqual(["a", "b", "c"]);
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.admin.applications.savePanel,
      }),
    );
    expect(mocks.mutate).toHaveBeenCalledWith({
      applicationId: props.applicationId,
      tutorIds: ["a", "b", "c"],
      headTutorId: "a",
      expectedUpdatedAt: updatedAt,
    });
  },
);

it("retains edited selections and their version after a rejected save and refresh", async () => {
  const initial = { ...props, interviewers: panel(["a", "b", "c"], "a") };
  const view = (version: Date) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <InterviewPanelEditor {...initial} updatedAt={version} />
    </NextIntlClientProvider>
  );
  const { rerender } = render(view(updatedAt));
  fireEvent.change(slot(3), { target: { value: "d" } });
  fireEvent.click(save());
  mocks.saveError = new Error("Panel changed; reload");
  await act(async () => mocks.callbacks.onError?.());
  rerender(view(new Date("2026-09-01T00:01:00Z")));
  expect((slot(3) as HTMLSelectElement).value).toBe("d");
  fireEvent.click(save());
  expect(mocks.mutate).toHaveBeenLastCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "d"],
    headTutorId: "a",
    expectedUpdatedAt: updatedAt,
  });
});

it("admits one panel save before the pending render", () => {
  show({ interviewers: panel(["a", "b", "c"], "a") });
  const button = save();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.mutate).toHaveBeenCalledOnce();
});

it("starts a separate draft and captured version when the application identity changes", () => {
  const view = (applicationId: string, version: Date, ids: string[]) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <InterviewPanelEditor
        {...props}
        applicationId={applicationId}
        updatedAt={version}
        interviewers={panel(ids, ids[0]!)}
      />
    </NextIntlClientProvider>
  );
  const nextVersion = new Date("2026-09-01T00:01:00Z");
  const { rerender } = render(view("first", updatedAt, ["a", "b", "c"]));
  fireEvent.change(slot(3), { target: { value: "d" } });
  rerender(view("second", nextVersion, ["c", "d", "e"]));
  expect((slot(1) as HTMLSelectElement).value).toBe("c");
  fireEvent.click(save());
  expect(mocks.mutate).toHaveBeenLastCalledWith({
    applicationId: "second",
    tutorIds: ["c", "d", "e"],
    headTutorId: "c",
    expectedUpdatedAt: nextVersion,
  });
});

it("replaces selections and their version together only after an explicit successful reload", async () => {
  const freshVersion = new Date("2026-09-01T00:02:00Z");
  const onReload = vi.fn().mockResolvedValue({
    applicationId: "app",
    updatedAt: freshVersion,
    interviewers: panel(["c", "d", "e"], "c"),
  });
  mocks.saveError = new Error("Panel changed; reload");
  show({ interviewers: panel(["a", "b", "c"], "a"), onReload });
  fireEvent.change(slot(3), { target: { value: "d" } });
  fireEvent.click(screen.getByRole("button", { name: "Reload panel" }));
  await waitFor(() => expect((slot(1) as HTMLSelectElement).value).toBe("c"));
  expect(onReload).toHaveBeenCalledOnce();
  expect((slot(3) as HTMLSelectElement).value).toBe("e");
  fireEvent.click(save());
  expect(mocks.mutate).toHaveBeenCalledWith({
    applicationId: "app",
    tutorIds: ["c", "d", "e"],
    headTutorId: "c",
    expectedUpdatedAt: freshVersion,
  });
});

it.each(["failed read", "different application"] as const)(
  "retains the complete draft and token after reload returns a %s",
  async (scenario) => {
    const onReload = vi.fn();
    if (scenario === "failed read")
      onReload.mockRejectedValue(new Error("offline"));
    else
      onReload.mockResolvedValue({
        applicationId: "different-app",
        updatedAt: new Date("2026-09-01T00:02:00Z"),
        interviewers: panel(["c", "d", "e"], "c"),
      });
    mocks.saveError = new Error("Panel changed; reload");
    show({ interviewers: panel(["a", "b", "c"], "a"), onReload });
    fireEvent.change(slot(3), { target: { value: "d" } });
    fireEvent.click(screen.getByRole("button", { name: "Reload panel" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "The current panel could not be loaded. Your draft is unchanged.",
        ),
      ).toBeTruthy(),
    );
    expect((slot(1) as HTMLSelectElement).value).toBe("a");
    expect((slot(3) as HTMLSelectElement).value).toBe("d");
    fireEvent.click(save());
    expect(mocks.mutate).toHaveBeenCalledWith({
      applicationId: "app",
      tutorIds: ["a", "b", "d"],
      headTutorId: "a",
      expectedUpdatedAt: updatedAt,
    });
  },
);

it("keeps an accepted save locked after refresh failure and recovers through reads only", async () => {
  const freshVersion = new Date("2026-09-01T00:02:00Z");
  const onChanged = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const onReload = vi.fn().mockResolvedValue({
    applicationId: "app",
    updatedAt: freshVersion,
    interviewers: panel(["a", "b", "d"], "a"),
  });
  show({ interviewers: panel(["a", "b", "c"], "a"), onChanged, onReload });
  fireEvent.change(slot(3), { target: { value: "d" } });
  fireEvent.click(save());
  await act(async () => mocks.callbacks.onSuccess?.());
  expect(save().disabled).toBe(true);
  expect((slot(3) as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(save());
  expect(mocks.mutate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading panel" }));
  await waitFor(() => expect(save().disabled).toBe(false));
  expect(onChanged).toHaveBeenCalledTimes(2);
  expect(onReload).toHaveBeenCalledOnce();
  expect(mocks.mutate).toHaveBeenCalledOnce();
  fireEvent.click(save());
  expect(mocks.mutate).toHaveBeenLastCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "d"],
    headTutorId: "a",
    expectedUpdatedAt: freshVersion,
  });
});

it("requires a nonblank repair reason and submits its trimmed value with the captured version", () => {
  show({ repairRequired: true, interviewers: panel(["a", "b", "c"], "a") });
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Repair panel",
  });
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Reason for panel repair",
  });
  expect(reason.required).toBe(true);
  expect(reason.maxLength).toBe(1000);
  expect(button.disabled).toBe(true);
  expect(
    screen.getByText(
      "Replacing this open panel clears its votes. Recorded completion and earned hours stay as history; new panelists receive no automatic credit. Every replacement panelist must vote again.",
    ),
  ).toBeTruthy();
  fireEvent.change(reason, { target: { value: "   " } });
  expect(button.disabled).toBe(true);
  fireEvent.change(reason, { target: { value: "x".repeat(1001) } });
  expect(button.disabled).toBe(true);
  fireEvent.change(reason, {
    target: { value: "  Replace unavailable panelist  " },
  });
  fireEvent.click(button);
  expect(mocks.mutate).toHaveBeenCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "c"],
    headTutorId: "a",
    expectedUpdatedAt: updatedAt,
    repairReason: "Replace unavailable panelist",
  });
});

it("retains the repair reason, choices and original token after rejection and background refresh", async () => {
  const view = (version: Date, ids: string[]) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <InterviewPanelEditor
        {...props}
        repairRequired
        updatedAt={version}
        interviewers={panel(ids, ids[0]!)}
      />
    </NextIntlClientProvider>
  );
  const { rerender } = render(view(updatedAt, ["a", "b", "c"]));
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Reason for panel repair",
  });
  fireEvent.change(reason, { target: { value: "Keep this explanation" } });
  fireEvent.change(slot(3), { target: { value: "d" } });
  fireEvent.click(screen.getByRole("button", { name: "Repair panel" }));
  mocks.saveError = new Error("Panel changed; reload");
  await act(async () => mocks.callbacks.onError?.());
  rerender(view(new Date("2026-09-01T00:01:00Z"), ["c", "d", "e"]));
  expect(reason.value).toBe("Keep this explanation");
  expect((slot(1) as HTMLSelectElement).value).toBe("a");
  expect((slot(3) as HTMLSelectElement).value).toBe("d");
  fireEvent.click(screen.getByRole("button", { name: "Repair panel" }));
  expect(mocks.mutate).toHaveBeenLastCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "d"],
    headTutorId: "a",
    expectedUpdatedAt: updatedAt,
    repairReason: "Keep this explanation",
  });
});

it.each(["explicit reload", "accepted save"] as const)(
  "clears the repair reason only after a successful %s adopts the saved panel",
  async (scenario) => {
    const freshVersion = new Date("2026-09-01T00:02:00Z");
    const onReload = vi.fn().mockResolvedValue({
      applicationId: "app",
      updatedAt: freshVersion,
      repairRequired: true,
      interviewers: panel(["c", "d", "e"], "c"),
    });
    if (scenario === "explicit reload")
      mocks.saveError = new Error("Panel changed; reload");
    show({
      repairRequired: true,
      interviewers: panel(["a", "b", "c"], "a"),
      onReload,
    });
    const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Reason for panel repair",
    });
    fireEvent.change(reason, { target: { value: "Original repair reason" } });
    if (scenario === "explicit reload")
      fireEvent.click(screen.getByRole("button", { name: "Reload panel" }));
    else {
      fireEvent.click(screen.getByRole("button", { name: "Repair panel" }));
      await act(async () => mocks.callbacks.onSuccess?.());
    }
    await waitFor(() => expect(reason.value).toBe(""));
    expect((slot(1) as HTMLSelectElement).value).toBe("c");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Repair panel" })
        .disabled,
    ).toBe(true);
    fireEvent.change(reason, { target: { value: "New reviewed reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Repair panel" }));
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      applicationId: "app",
      tutorIds: ["c", "d", "e"],
      headTutorId: "c",
      expectedUpdatedAt: freshVersion,
      repairReason: "New reviewed reason",
    });
  },
);

it("requires a repair reason after another panel opens without rebasing the original draft", () => {
  const view = (version: Date, repairRequired: boolean, ids: string[]) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <InterviewPanelEditor
        {...props}
        repairRequired={repairRequired}
        updatedAt={version}
        interviewers={panel(ids, ids[0]!)}
      />
    </NextIntlClientProvider>
  );
  const { rerender } = render(view(updatedAt, false, ["a", "b", "c"]));
  rerender(view(new Date("2026-09-01T00:01:00Z"), true, ["c", "d", "e"]));
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Repair panel",
  });
  expect(button.disabled).toBe(true);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Reason for panel repair" }),
    {
      target: { value: "Review the changed panel" },
    },
  );
  fireEvent.click(button);
  expect(mocks.mutate).toHaveBeenCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "c"],
    headTutorId: "a",
    expectedUpdatedAt: updatedAt,
    repairReason: "Review the changed panel",
  });
});

it("keeps the repair reason and original version when the explicit reload fails", async () => {
  mocks.saveError = new Error("Panel changed; reload");
  show({
    repairRequired: true,
    interviewers: panel(["a", "b", "c"], "a"),
    onReload: vi.fn().mockRejectedValue(new Error("offline")),
  });
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Reason for panel repair",
  });
  fireEvent.change(reason, {
    target: { value: "Keep the reviewed explanation" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reload panel" }));
  await waitFor(() =>
    expect(
      screen.getByText(
        "The current panel could not be loaded. Your draft is unchanged.",
      ),
    ).toBeTruthy(),
  );
  expect(reason.value).toBe("Keep the reviewed explanation");
  fireEvent.click(screen.getByRole("button", { name: "Repair panel" }));
  expect(mocks.mutate).toHaveBeenCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "c"],
    headTutorId: "a",
    expectedUpdatedAt: updatedAt,
    repairReason: "Keep the reviewed explanation",
  });
});
