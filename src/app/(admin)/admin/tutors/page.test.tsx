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
import en from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import TutorsPage from "./page";

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
          ],
        }),
      },
      createTutor: { useMutation: () => ({}) },
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

function mount(readOnly = false) {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
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
