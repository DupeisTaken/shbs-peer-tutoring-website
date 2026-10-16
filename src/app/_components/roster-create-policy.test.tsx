/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import TutorsPage from "../(admin)/admin/tutors/page";
import TuteesPage from "../(admin)/admin/tutees/page";
const mock = vi.hoisted(() => ({
  mutate: vi.fn(),
  error: undefined as undefined | { message: string },
}));
vi.mock("~/trpc/react", async () => {
  const rows = { useQuery: () => ({ data: [] }) };
  const create = {
    useMutation: () => ({
      mutate: mock.mutate,
      error: mock.error,
      isPending: false,
    }),
  };
  return {
    api: {
      account: { me: { useQuery: () => ({ data: { role: "HEAD" } }) } },
      useUtils: () => ({
        admin: {
          tutors: { invalidate: vi.fn() },
          tutees: { invalidate: vi.fn() },
        },
      }),
      tuteeHistory: {
        permissions: {
          useQuery: () => ({ data: { canLink: true, isHead: true } }),
        },
      },
      program: {
        ...(
          await import("~/test/name-field-policy-fixtures")
        ).nameFieldPolicyQueries(),
        profilePolicy: {
          useQuery: () => ({
            data: {
              requireLatinNames: true,
              offeredGrades: [9, 12],
              currentSchoolYear: "26-27",
            },
          }),
        },
      },
      admin: {
        tutors: rows,
        tutees: rows,
        subjects: rows,
        pairings: rows,
        tuteeStats: { useQuery: () => ({ data: {} }) },
        createTutor: create,
        createTutee: create,
        deleteTutee: { useMutation: () => ({ mutate: vi.fn() }) },
      },
    },
  };
});
beforeEach(() => {
  mock.mutate.mockReset();
  mock.error = undefined;
  // JSDOM needs the native dialog opening behavior exposed to role queries.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);

it.each([
  [true, false, "PROFILE_LATIN_NAME_REQUIRED", "latinRequired"],
  [false, false, "PROFILE_LATIN_NAME_REQUIRED", "latinRequired"],
  [true, true, "PROFILE_GRADE_NOT_OFFERED", "gradeNotOffered"],
  [false, true, "PROFILE_GRADE_NOT_OFFERED", "gradeNotOffered"],
] as const)(
  "shows a translated creation rejection without discarding the draft (tutor=%s Chinese=%s)",
  (tutor, chinese, message, key) => {
    const messages = chinese ? zh : en;
    const ui = () => (
      <NextIntlClientProvider
        locale={chinese ? "zh" : "en"}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        {tutor ? <TutorsPage /> : <TuteesPage />}
      </NextIntlClientProvider>
    );
    const view = render(ui());
    // The policy rejection still belongs to the creation form; entry consent
    // admits that form without issuing a mutation of its own.
    const acknowledgeCreation = () => {
      const proceed = screen.getByRole("button", {
        name: messages.admin.creationRisk.continue,
      });
      expect((proceed as HTMLButtonElement).disabled).toBe(true);
      expect(mock.mutate).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: messages.admin.creationRisk.acknowledgement,
        }),
      );
      fireEvent.click(proceed);
      expect(mock.mutate).not.toHaveBeenCalled();
    };
    if (tutor) {
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", {
          name: messages.admin.tutors.addTutor,
        }),
      );
      acknowledgeCreation();
      fireEvent.change(
        screen.getByLabelText(
          messages.personName.firstName + " " + messages.signupFields.required,
        ),
        { target: { value: "Draft" } },
      );
      fireEvent.change(
        screen.getByLabelText(
          messages.personName.lastName + " " + messages.signupFields.optional,
        ),
        { target: { value: "Name" } },
      );
    } else {
      // Creation policy is exercised through the visible panel, as a user opens it.
      fireEvent.click(
        screen.getByRole("button", {
          name: messages.admin.tutees.addTutee,
        }),
      );

      acknowledgeCreation();
      fireEvent.change(
        screen.getByLabelText(
          messages.personName.firstName + " " + messages.signupFields.required,
        ),
        {
          target: { value: "Draft Name" },
        },
      );
    }
    fireEvent.submit(document.querySelector("form")!);
    expect(mock.mutate).toHaveBeenCalledOnce();
    // A rejected mutation leaves its error beside the same form and retains the user's input.
    mock.error = { message };
    view.rerender(ui());
    expect(screen.getByRole("alert").textContent).toBe(
      messages.profilePolicy[key],
    );
    expect(
      screen.getByDisplayValue(tutor ? "Draft" : "Draft Name"),
    ).toBeTruthy();
    expect(screen.queryByText(message)).toBeNull();
  },
);
