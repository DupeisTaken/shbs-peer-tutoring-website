/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
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
const mutation = vi.hoisted(() => {
  const queryData: unknown = undefined;
  return {
    isPending: false,
    error: null as null | { message: string },
    queryData,
    queryError: null as { message: string } | null,
    fetching: false,
    retry: vi.fn(),
    onSuccess: () => Promise.resolve(),
    invalidate: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { tutors: { invalidate: mutation.invalidate } },
    }),
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
          error: mutation.queryError,
          isFetching: mutation.fetching,
          refetch: mutation.retry,
          data:
            mutation.queryData === null
              ? undefined
              : (mutation.queryData ?? [
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
                ]),
        }),
      },
      createTutor: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => {
          mutation.onSuccess = options.onSuccess;
          return {
            mutate: createTutor,
            isPending: mutation.isPending,
            error: mutation.error,
          };
        },
      },
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
beforeEach(() => {
  createTutor.mockClear();
  mutation.isPending = false;
  mutation.error = null;
  mutation.queryData = undefined;
  mutation.queryError = null;
  mutation.fetching = false;
  mutation.retry.mockReset();
  mutation.invalidate.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
});

function app(readOnly = false, chinese = false) {
  return (
    <NextIntlClientProvider
      locale={chinese ? "zh" : "en"}
      messages={chinese ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <TutorsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>
  );
}
function mount(readOnly = false, chinese = false) {
  return render(app(readOnly, chinese));
}
function openCreate(chinese = false) {
  const label = (chinese ? zh : en).admin.tutors.addTutor;
  const trigger = screen.getByRole("button", { name: label });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole("dialog", { name: label });
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
  expect(
    screen.queryByRole("button", { name: en.admin.tutors.addTutor }),
  ).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
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
  const actions = row.querySelector(".table-action-list")!;
  expect(within(actions as HTMLElement).getAllByRole("button")).toHaveLength(2);
  for (const button of actions.querySelectorAll("button")) {
    expect(button.classList.contains("table-action-link")).toBe(true);
    expect(button.classList.contains("btn-secondary")).toBe(false);
  }
});

it("offers Unknown and Graduated when adding a tutor", () => {
  createTutor.mockClear();
  mount();
  const dialog = openCreate();
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
    within(dialog).getByRole("button", { name: en.admin.tutors.addTutor }),
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
    const dialog = openCreate(chinese);
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
      within(dialog).getByRole("button", {
        name: messages.admin.tutors.addTutor,
      }),
    );
    expect(createTutor).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: "" } });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: messages.admin.tutors.addTutor,
      }),
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

it.each([false, true])(
  "keeps the roster compact and retains every draft field across Close and Escape (Chinese=%s)",
  (chinese) => {
    mount(false, chinese);
    const messages = chinese ? zh : en;
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('input[name="firstName"]')).toBeNull();
    const trigger = screen.getByRole("button", {
      name: messages.admin.tutors.addTutor,
    });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    for (const dismiss of ["close", "escape"]) {
      const dialog = openCreate(chinese);
      const values = {
        firstName: "Ada",
        lastName: "Lovelace",
        preferredName: "Ada",
        alternativeNames: "艾达",
        email: "ada@example.test",
      };
      for (const [name, value] of Object.entries(values))
        fireEvent.change(dialog.querySelector(`[name="${name}"]`)!, {
          target: { value },
        });
      fireEvent.change(within(dialog).getByRole("combobox"), {
        target: { value: "GRADUATED" },
      });
      expect(
        within(dialog).getByText(messages.admin.tutors.createDraftHint),
      ).toBeTruthy();
      if (dismiss === "close")
        fireEvent.click(
          within(dialog).getByRole("button", {
            name: messages.accountProfile.close,
          }),
        );
      else
        expect(
          fireEvent(
            dialog,
            new Event("cancel", { bubbles: true, cancelable: true }),
          ),
        ).toBe(false);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      const reopened = openCreate(chinese);
      for (const [name, value] of Object.entries(values))
        expect(
          reopened.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value,
        ).toBe(value);
      expect(
        within(reopened).getByRole<HTMLSelectElement>("combobox").value,
      ).toBe("GRADUATED");
      fireEvent.click(
        within(reopened).getByRole("button", {
          name: messages.accountProfile.close,
        }),
      );
    }
    expect(createTutor).not.toHaveBeenCalled();
  },
);

it("prevents dismissal and duplicate writes while pending, then clears and focuses after success", async () => {
  const view = mount();
  const dialog = openCreate();
  fireEvent.change(dialog.querySelector('[name="firstName"]')!, {
    target: { value: "Ada" },
  });
  fireEvent.change(dialog.querySelector('[name="lastName"]')!, {
    target: { value: "Lovelace" },
  });
  fireEvent.change(dialog.querySelector('[name="email"]')!, {
    target: { value: "ada@example.test" },
  });
  fireEvent.change(within(dialog).getByRole("combobox"), {
    target: { value: "12" },
  });
  const form = dialog.querySelector("form")!;
  fireEvent.submit(form);
  mutation.isPending = true;
  view.rerender(app());
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(dialog.querySelector("fieldset")!.disabled).toBe(true);
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close" })
      .disabled,
  ).toBe(true);
  expect(
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true })),
  ).toBe(false);
  fireEvent.submit(form);
  expect(createTutor).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(() => mutation.onSuccess());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe(en.admin.tutors.created);
  expect(mutation.invalidate).toHaveBeenCalledOnce();
  mutation.isPending = false;
  view.rerender(app());
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: en.admin.tutors.addTutor }),
  );
  const fresh = openCreate();
  for (const input of fresh.querySelectorAll("input"))
    expect(input.value).toBe("");
  expect(within(fresh).getByRole<HTMLSelectElement>("combobox").value).toBe("");
});

it("shows server errors inside the dialog and preserves the rejected draft for retry", () => {
  const view = mount();
  const dialog = openCreate();
  fireEvent.change(dialog.querySelector('[name="firstName"]')!, {
    target: { value: "张" },
  });
  fireEvent.change(dialog.querySelector('[name="lastName"]')!, {
    target: { value: "Example" },
  });
  mutation.error = { message: "PROFILE_LATIN_NAME_REQUIRED" };
  view.rerender(app());
  expect(within(dialog).getByRole("alert").textContent).toBe(
    en.profilePolicy.latinRequired,
  );
  expect(
    dialog.querySelector<HTMLInputElement>('[name="firstName"]')!.value,
  ).toBe("张");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  const reopened = openCreate();
  expect(
    reopened.querySelector<HTMLInputElement>('[name="firstName"]')!.value,
  ).toBe("张");
  expect(within(reopened).getByRole("alert")).toBeTruthy();
});

it("distinguishes cold load, failed load, and an empty tutor roster", () => {
  mutation.queryData = null;
  mount();
  expect(
    screen
      .getAllByRole("status")
      .some((node) => node.textContent?.includes(en.common.loading)),
  ).toBe(true);
  expect(screen.queryByText("0 records")).toBeNull();
  cleanup();
  mutation.queryError = { message: "offline" };
  mount();
  expect(screen.getByRole("alert").textContent).toContain(
    en.uiPatterns.loadFailed,
  );
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(mutation.retry).toHaveBeenCalledOnce();
  cleanup();
  mutation.queryError = null;
  mutation.queryData = [];
  mount();
  expect(screen.getByText("0 records")).toBeTruthy();
});

it("keeps cached tutor rows and their trailing actions after a refresh fails", () => {
  mutation.queryError = { message: "offline" };
  mount();
  expect(screen.getByRole("alert")).toBeTruthy();
  const table = screen.getByRole("table", { name: en.admin.tutors.title });
  expect(table.parentElement?.getAttribute("tabindex")).toBe("0");
  expect(within(table).getByText("Example Tutor")).toBeTruthy();
  expect(
    within(table).getByRole("columnheader", { name: en.tablePatterns.actions }),
  ).toBeTruthy();
});
