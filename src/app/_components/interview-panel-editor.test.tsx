// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import {
  InterviewPanelEditor,
  type PanelTutor,
} from "./interview-panel-editor";

const mocks = vi.hoisted(() => ({
  loading: false,
  error: null as Error | null,
  pending: false,
  mutate: vi.fn(),
  refetch: vi.fn(),
  saved: false,
  saveError: null as Error | null,
}));
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
        useMutation: () => ({
          mutate: mocks.mutate,
          isPending: mocks.pending,
          isSuccess: mocks.saved,
          error: mocks.saveError,
        }),
      },
    },
  },
}));
const tutors: PanelTutor[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(
  (id) => ({
    id,
    englishName: `Tutor ${id.toUpperCase()}`,
    status: "ACTIVE",
    user: { tutorAccessRevoked: false, suspendedAt: null },
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
function show(overrides: Partial<typeof props> = {}) {
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
  fireEvent.click(save());
  expect(mocks.mutate).toHaveBeenCalledWith({
    applicationId: "app",
    tutorIds: ["a", "b", "c"],
    headTutorId: "c",
    expectedUpdatedAt: updatedAt,
  });
  fireEvent.change(slot(3), { target: { value: "d" } });
  expect(save().disabled).toBe(true);
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
      { ...tutors[2]!, user: { tutorAccessRevoked: true, suspendedAt: null } },
      {
        ...tutors[3]!,
        user: { tutorAccessRevoked: false, suspendedAt: new Date() },
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
