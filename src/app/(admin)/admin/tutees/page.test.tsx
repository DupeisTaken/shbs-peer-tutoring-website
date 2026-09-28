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
import zh from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import TuteesPage from "./page";

const mocks = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("~/trpc/react", () => {
  const empty = { useQuery: () => ({ data: [] }) };
  return {
    api: {
      useUtils: () => ({}),
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: { offeredGrades: [9, 12], currentSchoolYear: "26-27" },
          }),
        },
      },
      admin: {
        subjects: empty,
        tutors: empty,
        pairings: empty,
        tuteeStats: { useQuery: () => ({ data: {} }) },
        tutees: {
          useQuery: () => ({
            data: [
              {
                id: "tutee-1",
                englishName: "Example Tutee",
                email: "tutee@example.test",
                status: "ACTIVE",
                firstChoice: null,
                secondChoice: null,
                academic: {
                  status: "UNKNOWN",
                  rawGrade: "9",
                  gradeLevel: null,
                  needsConfirmation: true,
                },
              },
            ],
          }),
        },
        createTutee: { useMutation: () => ({}) },
        deleteTutee: { useMutation: () => ({ mutate: mocks.remove }) },
      },
    },
  };
});
// The editor has its own save/permissions suite; this checks which row opens it.
vi.mock("~/app/_components/tutee-editor", () => ({
  TuteeEditor: ({ row }: { row: { id: string } }) => (
    <div role="dialog">Editing {row.id}</div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount(chinese = false, readOnly = false) {
  return render(
    <NextIntlClientProvider
      locale={chinese ? "zh" : "en"}
      messages={chinese ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <TuteesPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
}

it.each([false, true])(
  "places email before compact academics with matching headers (Chinese=%s)",
  (chinese) => {
    mount(chinese);
    const messages = chinese ? zh : en;
    const headers = screen.getAllByRole("columnheader");
    expect(headers[1]!.textContent).toBe(messages.admin.tutees.colContact);
    expect(headers[2]!.textContent).toContain(messages.academics.title);
    const row = screen.getByText("Example Tutee").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(
      within(cells[1]!).getByRole("button", {
        name: messages.accountProfile.showEmail,
      }),
    ).toBeTruthy();
    expect(
      Array.from(cells[2]!.querySelectorAll("p"), (p) => p.textContent),
    ).toEqual([
      messages.academics.rosterUnknown,
      messages.academics.rosterNeedsConfirmation,
    ]);
    const actions = within(cells.at(-1)!);
    const edit = actions.getByRole("button", {
      name: messages.accountProfile.editProfile,
    });
    const remove = actions.getByRole("button", {
      name: messages.admin.tutees.deleteBtn,
    });
    expect(edit.classList.contains("table-account-action")).toBe(true);
    expect(remove.classList.contains("link-danger")).toBe(true);
    fireEvent.click(edit);
    expect(screen.getByRole("dialog").textContent).toBe("Editing tutee-1");
    fireEvent.click(remove);
    expect(mocks.remove).toHaveBeenCalledWith({ id: "tutee-1" });
  },
);

it("hides private account actions for read-only viewers", () => {
  mount(false, true);
  const row = screen.getByText("Example Tutee").closest("tr")!;
  expect(within(row).queryByRole("button")).toBeNull();
  expect(within(row).getByText(en.accountProfile.privateEmail)).toBeTruthy();
  expect(within(row).getByText(en.academics.rosterUnknown)).toBeTruthy();
});
