/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import zh from "../../../../../messages/zh.json";
import en from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import TutorsPage from "./page";

const createTutor = vi.hoisted(() => vi.fn());

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    program: {
      profilePolicy: {
        useQuery: () => ({
          data: { offeredGrades: [12], currentSchoolYear: "26-27" },
        }),
      },
    },
    admin: {
      tutors: {
        useQuery: () => ({
          data: [
            {
              id: "tutor-1",
              englishName: "Example Tutor",
              username: "example",
              user: { id: "user-1", email: null },
              status: "ACTIVE",
              email: null,
              academic: {
                status: "REPORTED",
                gradeLevel: 12,
                schoolYear: "26-27",
                expectedGraduationYear: 2027,
              },
            },
            {
              id: "tutor-historical",
              englishName: "Historical Tutor",
              status: "ARCHIVED",
              user: null,
              gradeLevel: null,
              academic: { status: "UNKNOWN", needsConfirmation: true },
            },
            {
              id: "tutor-unknown",
              englishName: "Unconfirmed Tutor",
              status: "ACTIVE",
              academic: {
                status: "UNKNOWN",
                rawGrade: "11",
                gradeLevel: null,
                needsConfirmation: true,
              },
            },
          ],
        }),
      },
      createTutor: { useMutation: () => ({ mutate: createTutor }) },
    },
  },
}));
// The editor's own suite covers saving; this test checks the row still selects the right person.
vi.mock("~/app/_components/tutor-profile-editor", () => ({
  TutorProfileEditor: ({ row }: { row: { id: string } }) => (
    <div role="dialog">Editing {row.id}</div>
  ),
}));
afterEach(cleanup);

function mount(readOnly = false, chinese = false) {
  render(
    <NextIntlClientProvider
      locale={chinese ? "zh" : "en"}
      messages={chinese ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <TutorsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
}

it("groups details and edit actions at the right of a concise academic row", () => {
  mount();
  const row = screen.getByText("Example Tutor").closest("tr")!;
  const cells = within(row).getAllByRole("cell");
  const actions = within(cells.at(-1)!);
  expect(within(cells[0]!).queryByRole("button")).toBeNull();
  expect(
    actions.getByRole("button", {
      name: "View user details for Example Tutor",
    }),
  ).toBeTruthy();
  expect(within(row).getByText("Grade 12")).toBeTruthy();
  expect(within(row).getByText("Expected graduation: 2027")).toBeTruthy();
  expect(within(row).queryByText("School year 26-27")).toBeNull();
  fireEvent.click(actions.getByRole("button", { name: "Edit profile" }));
  expect(screen.getByRole("dialog").textContent).toBe("Editing tutor-1");
});

it("keeps private row actions hidden for read-only viewers", () => {
  mount(true);
  const row = screen.getByText("Example Tutor").closest("tr")!;
  expect(within(row).queryByRole("button")).toBeNull();
  expect(within(row).getByText("Grade 12")).toBeTruthy();
});

it("uses the shared text-action stack and compact unknown grade summary", () => {
  mount();
  const row = screen.getByText("Unconfirmed Tutor").closest("tr")!;
  expect(within(row).getByText("Unknown Grade Level")).toBeTruthy();
  expect(within(row).getByText("Needs Review & Confirmation")).toBeTruthy();
  expect(
    within(row).queryByText(/Original report|Expected graduation/),
  ).toBeNull();
  const actions = row.querySelector(".table-account-actions")!;
  expect(within(actions as HTMLElement).getAllByRole("button")).toHaveLength(2);
  for (const button of actions.querySelectorAll("button")) {
    expect(button.classList.contains("table-account-action")).toBe(true);
    expect(button.classList.contains("link")).toBe(true);
    expect(button.classList.contains("btn-secondary")).toBe(false);
  }
});

it("offers Unknown and Graduated when adding a tutor", () => {
  createTutor.mockClear();
  mount();
  const grade = screen.getByRole<HTMLSelectElement>("combobox", {
    name: `${en.admin.tutors.colGrade} ${en.signupFields.optional}`,
  });
  expect(within(grade).getByRole("option", { name: "Unknown" })).toBeTruthy();
  expect(within(grade).getByRole("option", { name: "Graduated" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("First Name Required"), {
    target: { value: "Ada" },
  });
  fireEvent.change(screen.getByLabelText("Last Name Required"), {
    target: { value: "Lovelace" },
  });
  fireEvent.change(grade, { target: { value: "GRADUATED" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.tutors.addTutor }),
  );
  expect(createTutor).toHaveBeenCalledWith(
    expect.objectContaining({
      firstName: "Ada",
      lastName: "Lovelace",
      academicallyGraduated: true,
      gradeLevel: undefined,
    }),
  );
});

it("shows archived accountless tutors without a current academic or setup requirement", () => {
  mount();
  expect(screen.queryByText("Historical Tutor")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show past tutors" }));
  const row = screen.getByText("Historical Tutor").closest("tr")!;
  expect(within(row).getByText(en.tuteeHistory.noAccount)).toBeTruthy();
  expect(within(row).getByText(en.tuteeHistory.notRecorded)).toBeTruthy();
  expect(
    within(row).queryByText(en.academics.rosterNeedsConfirmation),
  ).toBeNull();
  expect(within(row).queryByText(en.accountProfile.setupRequired)).toBeNull();
});

it.each([false, true])(
  "labels optional controls and preserves native email validation (Chinese=%s)",
  (chinese) => {
    createTutor.mockClear();
    mount(false, chinese);
    const messages = chinese ? zh : en;
    const email = screen.getByRole<HTMLInputElement>("textbox", {
      name: `${messages.admin.tutors.colEmail} ${messages.signupFields.optional}`,
    });
    const first = screen.getByLabelText<HTMLInputElement>(
      `${messages.personName.firstName} ${messages.signupFields.required}`,
    );
    const last = screen.getByLabelText<HTMLInputElement>(
      `${messages.personName.lastName} ${messages.signupFields.required}`,
    );
    const form = email.closest("form")!;
    expect(first.required).toBe(true);
    expect(last.required).toBe(true);
    expect(email.required).toBe(false);
    expect(form.checkValidity()).toBe(false);
    fireEvent.change(first, { target: { value: "Ada" } });
    fireEvent.change(last, { target: { value: "Lovelace" } });
    expect(form.checkValidity()).toBe(true);
    fireEvent.change(email, { target: { value: "invalid" } });
    expect(form.checkValidity()).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: messages.admin.tutors.addTutor }),
    );
    expect(createTutor).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("button", { name: messages.admin.tutors.addTutor }),
    );
    expect(createTutor).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Ada",
        lastName: "Lovelace",
        email: undefined,
        gradeLevel: undefined,
      }),
    );
  },
);
