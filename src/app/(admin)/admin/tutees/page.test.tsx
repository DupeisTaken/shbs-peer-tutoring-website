/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
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

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  moreHistory: false,
  create: vi.fn(),
  pending: false,
  error: null as { message: string } | null,
  searchRows: null as Record<string, unknown>[] | null,
}));
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
      tuteeHistory: {
        permissions: {
          useQuery: () => ({ data: { canLink: true, isHead: true } }),
        },
      },
      admin: {
        subjects: {
          useQuery: () => ({
            data: [
              { id: "math", name: "Math", active: true },
              { id: "english", name: "English", active: true },
            ],
          }),
        },
        tutors: empty,
        pairings: empty,
        tuteeStats: { useQuery: () => ({ data: {} }) },
        tutees: {
          useQuery: () => ({
            data: mocks.searchRows ?? [
              {
                id: "tutee-1",
                historical: false,
                englishName: "Example Tutee",
                alternativeNames: "示例学生",
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
              {
                id: "historical",
                englishName: "Archive Learner",
                historical: true,
                status: "INACTIVE",
                firstChoice: null,
                secondChoice: null,
                gradeLevel: "9",
                academic: { status: "REPORTED", gradeLevel: 12 },
              },
              {
                id: "unverified",
                englishName: "Unverified Learner",
                historical: false,
                status: "ACTIVE",
                firstChoice: null,
                secondChoice: null,
                user: { id: "login", emailVerifiedAt: null },
                academic: { status: "UNKNOWN" },
              },
              ...(mocks.moreHistory
                ? [
                    {
                      id: "later-grade",
                      firstChoice: null,
                      secondChoice: null,
                      englishName: "Later Grade",
                      historical: true,
                      status: "INACTIVE",
                      gradeLevel: "10",
                      academic: { status: "REPORTED", gradeLevel: 1 },
                    },
                  ]
                : []),
            ],
          }),
        },
        createTutee: {
          useMutation: () => ({
            mutate: mocks.create,
            isPending: mocks.pending,
            error: mocks.error,
          }),
        },
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
  mocks.moreHistory = false;
  mocks.pending = false;
  mocks.error = null;
  mocks.searchRows = null;
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
    expect(headers[2]!.textContent).toContain(messages.tuteeHistory.gradeClass);
    const row = screen.getByText("Example Tutee").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(
      within(cells[1]!).getByRole("button", {
        name: messages.accountProfile.showEmail,
      }),
    ).toBeTruthy();
    expect(
      Array.from(cells[2]!.querySelectorAll("p"), (p) => p.textContent),
    ).toEqual([messages.tuteeHistory.notRecorded]);
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
  expect(within(row).getByText(en.tuteeHistory.notRecorded)).toBeTruthy();
});

it("uses the server-composed display name without separately revealing hidden additional names", () => {
  mount();
  const row = screen.getByText("Example Tutee").closest("tr")!;
  expect(within(row).queryByText("示例学生")).toBeNull();
  expect(within(row).queryByText(en.tuteeHistory.noAccount)).toBeNull();
});

it("reveals historical and unverified records independently without setup or current-grade demands", () => {
  mount();
  expect(screen.queryByText("Archive Learner")).toBeNull();
  expect(screen.queryByText("Unverified Learner")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  const row = screen.getByText("Archive Learner").closest("tr")!;
  expect(within(row).getByText("Grade 9")).toBeTruthy();
  expect(within(row).queryByText(en.accountProfile.setupRequired)).toBeNull();
  expect(
    within(row).queryByRole("button", { name: en.tuteeHistory.linkTitle }),
  ).toBeNull();
  expect(
    within(row.querySelector("td:last-child")!)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual([
    en.tuteeHistory.details,
    en.accountProfile.editProfile,
    en.admin.tutees.deleteBtn,
  ]);
  expect(screen.queryByText("Example Tutee")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All Records" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Show unverified accounts" }),
  );
  expect(screen.getByText("Unverified Learner")).toBeTruthy();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search tutee records" }),
    { target: { value: "archive" } },
  );
  expect(screen.getByText("Archive Learner")).toBeTruthy();
  expect(screen.queryByText("Unverified Learner")).toBeNull();
});
it("sorts historical rows by original grades instead of the owner's current grade", () => {
  mocks.moreHistory = true;
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.historical }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(en.tuteeHistory.gradeClass),
    }),
  );
  const names = screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);
  expect(names[0]).toContain("Archive Learner");
  expect(names[1]).toContain("Later Grade");
});

it.each([false, true])(
  "starts with roster search and keeps a hidden creation draft (Chinese=%s)",
  (chinese) => {
    const messages = chinese ? zh : en;
    mount(chinese);
    expect(
      screen.getByRole("textbox", {
        name: messages.tuteeHistory.searchRecords,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("textbox", {
        name: `${messages.personName.firstName} ${messages.signupFields.required}`,
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: messages.admin.tutees.addTutee }),
    );
    const region = screen.getByRole("region", {
      name: messages.admin.tutees.addTutee,
    });
    const first = within(region).getByLabelText<HTMLInputElement>(
      `${messages.personName.firstName} ${messages.signupFields.required}`,
    );
    expect(first.required).toBe(true);
    fireEvent.change(first, { target: { value: "Draft" } });
    fireEvent.change(
      within(region).getByRole("combobox", {
        name: `${messages.admin.tutees.grade} ${messages.signupFields.optional}`,
      }),
      { target: { value: "9" } },
    );
    fireEvent.change(
      within(region).getByRole("combobox", {
        name: `${messages.admin.tutees.firstChoice} ${messages.signupFields.optional}`,
      }),
      { target: { value: "math" } },
    );
    fireEvent.change(
      within(region).getByRole("combobox", {
        name: `${messages.admin.tutees.secondChoice} ${messages.signupFields.optional}`,
      }),
      { target: { value: "english" } },
    );
    fireEvent.click(
      within(region).getByRole("button", {
        name: messages.admin.tutees.hideAddForm,
      }),
    );
    const trigger = screen.getByRole("button", {
      name: messages.admin.tutees.addTutee,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(first.value).toBe("Draft");
    fireEvent.click(
      within(region).getByRole("button", {
        name: messages.admin.tutees.addTuteeBtn,
      }),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Draft",
        gradeLevel: "9",
        firstChoiceId: "math",
        secondChoiceId: "english",
      }),
      expect.any(Object),
    );
    // A successful mutation is the only hide interaction that clears the draft.
    const callbacks = mocks.create.mock.calls[0]![1] as {
      onSuccess: () => void;
      onSettled: () => void;
    };
    act(() => {
      callbacks.onSuccess();
      callbacks.onSettled();
    });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(first.value).toBe("");
    for (const select of region.querySelectorAll("select"))
      expect(select.value).toBe("");
  },
);
it("hides creation from read-only viewers", () => {
  mount(false, true);
  expect(
    screen.queryByRole("button", { name: en.admin.tutees.addTutee }),
  ).toBeNull();
  expect(document.querySelector("#add-tutee-form")).toBeNull();
});
it("prevents hiding during a pending creation and retains failures for retry", () => {
  mocks.error = { message: "Try again" };
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.tutees.addTutee }),
  );
  expect(screen.getByRole("alert").textContent).toBe("Try again");
  cleanup();
  mocks.pending = true;
  mount();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.admin.tutees.addTutee,
    }).disabled,
  ).toBe(true);
});

it("restores focus after pending state ends, rather than focusing a disabled trigger", () => {
  const view = mount();
  const tree = (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <ReadOnlyProvider value={false}>
        <TuteesPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.tutees.addTutee }),
  );
  fireEvent.change(screen.getByLabelText("First Name Required"), {
    target: { value: "Ada" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.tutees.addTuteeBtn }),
  );
  mocks.pending = true;
  view.rerender(tree);
  const callbacks = mocks.create.mock.calls[0]![1] as { onSuccess: () => void };
  act(() => callbacks.onSuccess());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.admin.tutees.addTutee,
    }).disabled,
  ).toBe(true);
  mocks.pending = false;
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <ReadOnlyProvider value={false}>
        <TuteesPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: en.admin.tutees.addTutee }),
  );
});
it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "searches saved canonical and preferred identity with display toggles %s/%s",
  (preferred, alternate) => {
    const display = `${preferred ? "Sasha" : "Alexander"} Chen${alternate ? " · 陈晓明" : ""}`;
    mocks.searchRows = [
      {
        id: "names",
        firstChoice: null,
        secondChoice: null,
        firstName: "Alexander",
        lastName: "Chen",
        preferredName: "Sasha",
        alternativeNames: "陈晓明",
        englishName: display,
        historical: true,
        status: "INACTIVE",
        academic: { status: "UNKNOWN" },
      },
    ];
    mount();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    for (const query of [
      "Alexander",
      "Alexander Chen",
      "Sasha",
      "Sasha Chen",
      "陈晓明",
    ]) {
      fireEvent.change(
        screen.getByRole("textbox", { name: en.tuteeHistory.searchRecords }),
        { target: { value: query } },
      );
      expect(screen.getByText(display)).toBeTruthy();
    }
  },
);
it.each([false, true])(
  "distinguishes empty Current, History and All from no search matches (Chinese=%s)",
  (chinese) => {
    const messages = chinese ? zh : en;
    mount(chinese);
    for (const view of ["current", "historical", "all"] as const) {
      fireEvent.click(
        screen.getByRole("button", {
          name: messages.tuteeHistory[view],
        }),
      );
      fireEvent.change(
        screen.getByRole("textbox", {
          name: messages.tuteeHistory.searchRecords,
        }),
        { target: { value: "No such person" } },
      );
      expect(
        screen.getByText(messages.tuteeHistory.noSearchMatches),
      ).toBeTruthy();
    }
    cleanup();
    mocks.searchRows = [];
    mount(chinese);
    for (const [view, key] of [
      ["current", "emptyCurrent"],
      ["historical", "emptyHistory"],
      ["all", "emptyAll"],
    ] as const) {
      fireEvent.click(
        screen.getByRole("button", {
          name: messages.tuteeHistory[view],
        }),
      );
      expect(screen.getByText(messages.tuteeHistory[key])).toBeTruthy();
      expect(
        screen.queryByText(messages.tuteeHistory.noSearchMatches),
      ).toBeNull();
    }
  },
);
