/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import { TutorProfileEditor } from "./tutor-profile-editor";
import { TuteeEditor } from "./tutee-editor";
const mock = vi.hoisted(() => ({
  mutate: vi.fn(),
  error: undefined as undefined | { message: string },
}));
vi.mock("./tutee-history", () => ({
  TuteeHistoryLinkForm: ({ onLinked }: { onLinked: () => void }) => (
    <button onClick={onLinked}>Complete test link</button>
  ),
}));
vi.mock("./academic-profile", () => ({
  AcademicPanel: ({ userId }: { userId: string }) => (
    <div>Shared academics: {userId}</div>
  ),
}));
vi.mock("~/app/_components/profile-dialog", () => ({
  ProfileDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    program: {
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
      subjects: { useQuery: () => ({ data: [] }) },
      timeSlots: { useQuery: () => ({ data: [] }) },
      updateTutor: {
        useMutation: () => ({ mutate: mock.mutate, error: mock.error }),
      },
      updateTutee: {
        useMutation: () => ({ mutate: mock.mutate, error: mock.error }),
      },
    },
  },
}));
afterEach(cleanup);
beforeEach(() => {
  mock.mutate.mockReset();
  mock.error = undefined;
});
function mount(tutor: boolean, linked: boolean) {
  const row = {
    id: "roster",
    englishName: "王小明",
    alternativeNames: "Wang",
    gradeLevel: tutor ? 2 : "IB year 1",
    user: linked ? { id: "account", email: "person@example.test" } : null,
    updatedAt: new Date("2026-09-01"),
    status: "ACTIVE",
    email: "person@example.test",
    availabilities: [],
  };
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      {tutor ? (
        <TutorProfileEditor
          row={
            row as unknown as ComponentProps<typeof TutorProfileEditor>["row"]
          }
          onClose={vi.fn()}
        />
      ) : (
        <TuteeEditor
          row={row as unknown as ComponentProps<typeof TuteeEditor>["row"]}
          onClose={vi.fn()}
        />
      )}
    </NextIntlClientProvider>,
  );
}
it.each([true, false])(
  "preserves an unchanged historical roster grade and offers only current choices (tutor=%s)",
  (tutor) => {
    const firstEditor = mount(tutor, false);
    const grade = screen.getByLabelText<HTMLSelectElement>(
      en.academics.legacyGrade,
    );
    expect(grade.value).toBe(tutor ? "2" : "IB year 1");
    expect(screen.queryByRole("option", { name: "Grade 10" })).toBeNull();
    expect(screen.getByRole("option", { name: "Grade 9" })).toBeTruthy();
    expect(screen.getByText(en.profilePolicy.nameHint)).toBeTruthy();
    fireEvent.submit(document.querySelector("form")!);
    expect(mock.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ gradeLevel: tutor ? 2 : "IB year 1" }),
    );
    // These are independent profile edits; a submitted draft cannot be replayed.
    firstEditor.unmount();
    mount(tutor, false);
    fireEvent.change(screen.getByLabelText(en.academics.legacyGrade), {
      target: { value: "12" },
    });
    fireEvent.submit(document.querySelector("form")!);
    expect(mock.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ gradeLevel: tutor ? 12 : "12" }),
    );
  },
);
it.each([true, false])(
  "keeps linked roster academics in the canonical editor (tutor=%s)",
  (tutor) => {
    mount(tutor, true);
    expect(screen.queryByLabelText(en.academics.legacyGrade)).toBeNull();
    expect(screen.getByText("Shared academics: account")).toBeTruthy();
    fireEvent.submit(document.querySelector("form")!);
    expect(mock.mutate.mock.calls[0]?.[0]).not.toHaveProperty("gradeLevel");
  },
);
it.each([true, false])(
  "translates name-policy errors in roster editing (tutor=%s)",
  (tutor) => {
    mock.error = { message: "PROFILE_LATIN_NAME_REQUIRED" };
    mount(tutor, false);
    expect(screen.getByRole("alert").textContent).toBe(
      en.profilePolicy.latinRequired,
    );
  },
);

it.each([true, false])(
  "gates embedded linking and preserves unsaved profile edits (allowed=%s)",
  (canLink) => {
    const row = {
      id: "past",
      englishName: "Alex",
      historical: true,
      status: "INACTIVE",
      gradeLevel: "9",
      availabilities: [],
      updatedAt: new Date(),
    } as unknown as ComponentProps<typeof TuteeEditor>["row"];
    const close = vi.fn();
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TuteeEditor
          row={row}
          onClose={close}
          historyPermissions={{ canLink, isHead: false }}
        />
      </NextIntlClientProvider>,
    );
    // All four controlled name drafts must survive linking, not just plain form fields.
    const drafts = {
      firstName: "Alexander",
      lastName: "Chen",
      preferredName: "Alex",
      alternativeNames: "陈同学",
    };
    for (const [key, value] of Object.entries(drafts)) {
      fireEvent.change(container.querySelector(`input[name="${key}"]`)!, {
        target: { value },
      });
    }
    const notes = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="notes"]',
    )!;
    fireEvent.change(notes, { target: { value: "Keep this draft" } });
    const section = container.querySelector("details");
    if (!canLink) {
      expect(section).toBeNull();
      return;
    }
    expect(section).not.toBeNull();
    expect(section!.closest("form")).toBeNull();
    section!.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Complete test link" }));
    expect(section!.open).toBe(false);
    for (const [key, value] of Object.entries(drafts)) {
      expect(
        container.querySelector<HTMLInputElement>(`input[name="${key}"]`)!
          .value,
      ).toBe(value);
    }
    expect(notes.value).toBe("Keep this draft");
    fireEvent.submit(container.querySelector("form")!);
    expect(mock.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ...drafts,
        englishName: "Alexander Chen",
        notes: "Keep this draft",
      }),
    );
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      en.tuteeHistory.linkSaved,
    );
    expect(document.activeElement).toBe(section!.querySelector("summary"));
  },
);
