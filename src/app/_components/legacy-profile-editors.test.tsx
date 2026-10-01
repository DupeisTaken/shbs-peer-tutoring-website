/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { TuteeEditor } from "./tutee-editor";
import { TutorProfileEditor } from "./tutor-profile-editor";
import { AccountProfileEditor } from "./account-profile-editor";
import type { RouterOutputs } from "~/trpc/react";

vi.mock("./profile-dialog", () => ({
  ProfileDialog: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
const state = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    admin: {
      updateTutee: { useMutation: () => ({ mutate: state.mutate }) },
      updateTutor: { useMutation: () => ({ mutate: state.mutate }) },
      updateAccountProfile: { useMutation: () => ({ mutate: state.mutate }) },
      subjects: { useQuery: () => ({ data: [] }) },
      timeSlots: { useQuery: () => ({ data: [] }) },
    },
    program: {
      profilePolicy: { useQuery: () => ({ data: { offeredGrades: [10] } }) },
    },
  },
}));
vi.mock("./academic-profile", () => ({ AcademicPanel: () => null }));
vi.mock("./school-departure", () => ({ SchoolDeparturePanel: () => null }));
afterEach(() => {
  cleanup();
  state.mutate.mockReset();
});

it.each(["tutee", "tutor", "account"] as const)(
  "submits the %s editor without overwriting an unchanged unsplit identity",
  (kind) => {
    const row = {
      id: "legacy",
      englishName: "张小明",
      firstName: null,
      lastName: null,
      preferredName: null,
      alternativeNames: null,
      updatedAt: new Date(),
      status: "INACTIVE",
      user: null,
      gradeLevel: null,
      availabilities: [],
    };
    const editor =
      kind === "tutee" ? (
        <TuteeEditor
          row={row as unknown as RouterOutputs["admin"]["tutees"][number]}
          onClose={vi.fn()}
        />
      ) : kind === "tutor" ? (
        <TutorProfileEditor
          row={
            {
              ...row,
              status: "ARCHIVED",
            } as unknown as RouterOutputs["admin"]["tutors"][number]
          }
          onClose={vi.fn()}
        />
      ) : (
        <AccountProfileEditor
          profile={{
            ...row,
            userId: "legacy",
            name: row.englishName,
            profileVersion: 0,
          }}
          onClose={vi.fn()}
        />
      );
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        {editor}
      </NextIntlClientProvider>,
    );
    if (kind === "tutee")
      fireEvent.change(screen.getByLabelText("Staff Notes"), {
        target: { value: "Corrected notes" },
      });
    else
      fireEvent.change(
        screen.getByLabelText("Name in Another Language Optional"),
        { target: { value: "小明" } },
      );
    expect(container.querySelector("form")!.checkValidity()).toBe(true);
    fireEvent.click(
      screen.getByRole("button", {
        name: kind === "tutee" ? "Save Details" : "Save profile",
      }),
    );
    expect(state.mutate).toHaveBeenCalledOnce();
    const payload = state.mutate.mock.calls[0]![0] as Record<string, unknown>;
    for (const key of ["firstName", "lastName", "preferredName"])
      expect(payload).not.toHaveProperty(key);
    if (kind === "tutee")
      expect(payload).toMatchObject({
        englishName: "张小明",
        notes: "Corrected notes",
      });
    if (kind === "account")
      expect(payload).toMatchObject({
        name: "张小明",
        alternativeNames: "小明",
      });
  },
);
