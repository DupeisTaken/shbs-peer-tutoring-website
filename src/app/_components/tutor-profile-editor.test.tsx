/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { TutorProfileEditor } from "./tutor-profile-editor";
import type { RouterOutputs } from "~/trpc/react";
import messages from "../../../messages/en.json";

const state = vi.hoisted(() => ({ save: vi.fn(), error: null as { message: string } | null }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({}),
  admin: { updateTutor: { useMutation: () => ({ mutate: state.save, error: state.error, isPending: false }) } },
  program: { profilePolicy: { useQuery: () => ({ data: { offeredGrades: [10, 11, 12], currentSchoolYear: "26-27" } }) } },
} }));
vi.mock("./profile-dialog", () => ({ ProfileDialog: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div> }));
vi.mock("./academic-profile", () => ({ AcademicPanel: () => null }));
const row = { id: "past-tutor", updatedAt: new Date("2026-09-01"), englishName: "Past Tutor", username: "pasttutor", email: null, gradeLevel: 10, academicallyGraduated: false, status: "ARCHIVED", user: null } as RouterOutputs["admin"]["tutors"][number];
function mount(isHead = true, tutor = row) {
  render(<NextIntlClientProvider locale="en" messages={messages}><TutorProfileEditor row={tutor} isHead={isHead} onClose={vi.fn()} /></NextIntlClientProvider>);
}
beforeEach(() => { state.save.mockReset(); state.error = null; });
afterEach(cleanup);
it("saves an archived unlinked correction without an email and preserves status", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Preferred Name"), { target: { value: "Corrected Tutor" } });
  fireEvent.change(screen.getByLabelText("Legal Name"), { target: { value: "José García" } });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "corrected93" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ id: "past-tutor", expectedUpdatedAt: row.updatedAt,
    firstName: "Corrected", lastName: "Tutor", alternativeNames: "José García", username: "corrected93", email: null, gradeLevel: 10, status: "ARCHIVED" }));
});
it("keeps ordinary staff username fields read-only and surfaces validation failures", () => {
  state.error = { message: "That username is already taken." };
  mount(false);
  expect(screen.getByLabelText<HTMLInputElement>("Username").readOnly).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe("That username is already taken.");
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(state.save.mock.calls[0]?.[0]).not.toHaveProperty("username");
});
it("keeps linked email changes read-only and does not send legacy academic edits", () => {
  mount(true, { ...row, user: { id: "linked", email: "linked@example.test" } } as typeof row);
  expect(screen.getByLabelText<HTMLInputElement>(/^Email/).readOnly).toBe(true);
  expect(screen.queryByLabelText("Username")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(state.save.mock.calls[0]?.[0]).not.toHaveProperty("gradeLevel");
  expect(state.save.mock.calls[0]?.[0]).not.toHaveProperty("username");
});
