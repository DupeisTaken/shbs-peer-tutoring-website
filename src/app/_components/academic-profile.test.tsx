/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  AcademicDetails,
  AcademicForm,
  AcademicPanel,
} from "./academic-profile";
import type { AcademicSummary } from "~/lib/academics";

const mock = vi.hoisted(() => ({
  own: vi.fn(),
  staff: vi.fn(),
  invalidate: vi.fn(),
  refresh: vi.fn(),
  staffQuery: vi.fn(),
  selfQuery: vi.fn(),
  error: null as null | {
    message: string;
    data: { code?: string; approvalId?: string };
  },
  role: "STUDENT",
  version: 3,
  policyLoaded: true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("~/trpc/react", () => {
  const summary = {
    status: "REPORTED",
    gradeLevel: 10,
    rawGrade: null,
    schoolYear: "26-27",
    confirmedAt: null,
    needsConfirmation: true,
    expectedGraduationYear: 2029,
  };
  const data = () => ({
    academic: summary,
    profileVersion: mock.version,
    currentSchoolYear: "26-27",
    role: mock.role,
  });
  const query = (staff: boolean) => ({
    useQuery: (_input: unknown, options: { enabled: boolean }) => {
      (staff ? mock.staffQuery : mock.selfQuery)(options);
      return {
        data: { ...data(), history: [] },
        isLoading: false,
        refetch: async () => ({ data: data() }),
      };
    },
  });
  const mutation = (staff: boolean) => ({
    useMutation: (options: { onSuccess: () => Promise<void> }) => ({
      error: mock.error,
      isPending: false,
      reset: vi.fn(),
      mutate: (input: unknown) => {
        (staff ? mock.staff : mock.own)(input);
        if (!mock.error) void options.onSuccess();
      },
    }),
  });
  const invalidator = { invalidate: mock.invalidate };
  return {
    api: {
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: mock.policyLoaded
              ? {
                  requireLatinNames: false,
                  offeredGrades: Array.from({ length: 12 }, (_, i) => i + 1),
                  currentSchoolYear: "26-27",
                }
              : undefined,
            refetch: async () => ({ data: {} }),
          }),
        },
      },
      useUtils: () => ({
        account: { me: invalidator, academicHistory: invalidator },
        admin: {
          accountAcademics: invalidator,
          accounts: invalidator,
          tutors: invalidator,
          tutees: invalidator,
        },
        tutor: { me: invalidator, myProfile: invalidator },
        tutorDetails: invalidator,
      }),
      account: {
        me: query(false),
        academicHistory: { useQuery: () => ({ data: [] }) },
        updateAcademics: mutation(false),
      },
      admin: {
        accountAcademics: query(true),
        updateAccountAcademics: mutation(true),
      },
    },
  };
});
const academic: AcademicSummary = {
  status: "REPORTED",
  gradeLevel: 10,
  rawGrade: null,
  schoolYear: "26-27",
  confirmedAt: null,
  needsConfirmation: true,
  expectedGraduationYear: 2029,
};
const wrap = (child: React.ReactNode, chinese = false) => (
  <NextIntlClientProvider
    locale={chinese ? "zh" : "en"}
    messages={chinese ? zh : en}
    timeZone="Asia/Shanghai"
  >
    {child}
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  mock.error = null;
  mock.role = "STUDENT";
  mock.version = 3;
  mock.policyLoaded = true;
});
afterEach(cleanup);

it.each([false, true])(
  "shows grade, reference, graduation and stale confirmation together (Chinese=%s)",
  (chinese) => {
    render(wrap(<AcademicDetails academic={academic} />, chinese));
    expect(screen.getByText(chinese ? "10 年级" : "Grade 10")).toBeTruthy();
    expect(
      screen.getByText(chinese ? "26-27 学年" : "School year 26-27"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        chinese ? "预计毕业年份：2029" : "Expected graduation: 2029",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText((chinese ? zh : en).academics.needsConfirmation),
    ).toBeTruthy();
  },
);

it.each([null, 10])(
  "preserves raw unknown reports, including migrated numeric grades (%s)",
  (gradeLevel) => {
    render(
      wrap(
        <AcademicDetails
          academic={{
            ...academic,
            status: "UNKNOWN",
            gradeLevel,
            rawGrade: "Year 10 / IB",
            expectedGraduationYear: null,
          }}
        />,
      ),
    );
    expect(screen.getByText(en.academics.unknown)).toBeTruthy();
    expect(screen.getByText("Original report: Year 10 / IB")).toBeTruthy();
    expect(screen.getByText(en.academics.graduationUnknown)).toBeTruthy();
  },
);

it("makes missing and not-applicable data explicit without a graduation guess", () => {
  const view = render(wrap(<AcademicDetails />));
  expect(screen.getByText(en.academics.unknown)).toBeTruthy();
  view.rerender(
    wrap(
      <AcademicDetails
        academic={{
          ...academic,
          status: "NOT_APPLICABLE",
          gradeLevel: null,
          schoolYear: null,
          expectedGraduationYear: null,
          needsConfirmation: false,
        }}
      />,
    ),
  );
  expect(screen.getByText(en.academics.notApplicable)).toBeTruthy();
  expect(screen.queryByText(en.academics.needsConfirmation)).toBeNull();
});

it("uses the program year and offered grades while preserving the draft's original version", () => {
  const save = vi.fn();
  const snapshot = {
    academic,
    profileVersion: 3,
    currentSchoolYear: "27-28",
    offeredGrades: [1, 9, 12],
  };
  const view = render(
    wrap(
      <AcademicForm
        snapshot={snapshot}
        pending={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  expect(screen.getByRole("option", { name: "Grade 1" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Grade 12" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Grade 8" })).toBeNull();
  expect(
    screen.queryByRole("textbox", { name: en.academics.schoolYear }),
  ).toBeNull();
  // The legacy grade remains visible, but cannot be submitted until a currently offered grade is selected.
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.academics.confirm,
    }).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText(en.academics.grade), {
    target: { value: "9" },
  });
  expect(screen.getByText("Expected graduation: 2031")).toBeTruthy();
  view.rerender(
    wrap(
      <AcademicForm
        snapshot={{
          ...snapshot,
          profileVersion: 4,
          currentSchoolYear: "28-29",
        }}
        pending={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      gradeLevel: 9,
      schoolYear: "27-28",
      expectedSchoolYear: "27-28",
      expectedProfileVersion: 3,
    }),
  );
});

it("cannot confirm a reported grade without a current program year", () => {
  const save = vi.fn();
  render(
    wrap(
      <AcademicForm
        snapshot={{ academic, profileVersion: 3, currentSchoolYear: null }}
        pending={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  expect(screen.getByText(en.academics.noCurrentYear)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
  expect(save).not.toHaveBeenCalled();
});

it("unknown and not-applicable drafts clear canonical numeric grade and year", () => {
  const save = vi.fn();
  render(
    wrap(
      <AcademicForm
        snapshot={{ academic, profileVersion: 3, currentSchoolYear: null }}
        pending={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  fireEvent.change(screen.getByLabelText(en.academics.status), {
    target: { value: "UNKNOWN" },
  });
  fireEvent.change(
    screen.getByLabelText(
      new RegExp(`^${en.academics.rawGrade.replace(/[()]/g, "\\$&")}`),
    ),
    { target: { value: "IB year 1" } },
  );
  fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "UNKNOWN",
      gradeLevel: null,
      schoolYear: null,
      rawGrade: "IB year 1",
    }),
  );
  fireEvent.change(screen.getByLabelText(en.academics.status), {
    target: { value: "NOT_APPLICABLE" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "NOT_APPLICABLE",
      gradeLevel: null,
      schoolYear: null,
      rawGrade: null,
    }),
  );
});

it.each(["STUDENT", "TUTOR", "CREW", "ADMIN", "VIEWER"])(
  "supports self-service without enabling staff queries for %s",
  async (role) => {
    mock.role = role;
    render(wrap(<AcademicPanel />));
    expect(mock.staffQuery).toHaveBeenLastCalledWith({ enabled: false });
    fireEvent.click(screen.getByRole("button", { name: en.academics.review }));
    fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
    expect(mock.own).toHaveBeenCalledWith(
      expect.objectContaining({ expectedProfileVersion: 3 }),
    );
    expect(mock.staff).not.toHaveBeenCalled();
    await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
    expect(mock.invalidate).toHaveBeenCalledTimes(9);
  },
);

it("staff corrections target the selected account and coordinator proposals do not claim a save", () => {
  mock.error = { message: "Queued", data: { approvalId: "proposal-1" } };
  render(wrap(<AcademicPanel userId="target-user" />));
  expect(mock.selfQuery).toHaveBeenLastCalledWith({ enabled: false });
  fireEvent.click(screen.getByRole("button", { name: en.academics.review }));
  fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
  expect(mock.staff).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "target-user" }),
  );
  expect(screen.getByText(en.academics.requested)).toBeTruthy();
  expect(screen.queryByText(en.academics.saved)).toBeNull();
});

it("keeps a stale draft visible with an explicit reload action", () => {
  mock.error = { message: "Conflict", data: { code: "CONFLICT" } };
  render(wrap(<AcademicPanel />));
  fireEvent.click(screen.getByRole("button", { name: en.academics.review }));
  fireEvent.change(screen.getByLabelText(en.academics.grade), {
    target: { value: "8" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.academics.confirm }));
  expect(screen.getByRole("alert").textContent).toBe(en.academics.conflict);
  expect(
    screen.getByRole("button", { name: en.academics.reload }),
  ).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLSelectElement>(en.academics.grade).value,
  ).toBe("8");
  expect(mock.invalidate).not.toHaveBeenCalled();
});

it("waits for the current policy before capturing an academic draft", () => {
  mock.policyLoaded = false;
  render(wrap(<AcademicPanel />));
  const edit = screen.getByRole<HTMLButtonElement>("button", {
    name: en.academics.review,
  });
  expect(edit.disabled).toBe(true);
  fireEvent.click(edit);
  expect(screen.queryByLabelText(en.academics.grade)).toBeNull();
});
