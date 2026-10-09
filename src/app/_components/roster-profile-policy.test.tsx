/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import { TutorProfileEditor } from "./tutor-profile-editor";
import { TuteeEditor } from "./tutee-editor";
const mock = vi.hoisted(() => {
  const freshRow: Record<string, unknown> = {};
  return {
    mutate: vi.fn<(input: unknown) => Promise<unknown>>(),
    error: undefined as undefined | { message: string },
    freshRow,
    fetch: vi.fn<() => Promise<Record<string, unknown>[]>>(),
  };
});
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
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  // Replace transport only: React Query must settle failures before another save.
  const useRosterMutation = (options: {
    onSuccess: () => Promise<void>;
    onSettled: () => void;
  }) => {
    const mutation = useMutation({
      mutationFn: async (input: unknown) => {
        const result = await mock.mutate(input);
        // Only admitted successes change the server fixture; failed drafts keep their fence.
        mock.freshRow = {
          ...mock.freshRow,
          ...(input as Record<string, unknown>),
          updatedAt: new Date("2026-09-02"),
        };
        return result;
      },
      retry: false,
      ...options,
    });
    return { ...mutation, error: mutation.error ?? mock.error };
  };
  const invalidation = { invalidate: () => Promise.resolve() };
  return {
    api: {
      useUtils: () => ({
        admin: {
          tutors: { ...invalidation, fetch: mock.fetch },
          tutees: { ...invalidation, fetch: mock.fetch },
          tuteeStats: invalidation,
          pairings: invalidation,
          accounts: invalidation,
        },
        tuteeHistory: invalidation,
      }),
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
          useMutation: useRosterMutation,
        },
        updateTutee: {
          useMutation: useRosterMutation,
        },
      },
    },
  };
});
const clients = new Set<QueryClient>();
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.clear();
});
beforeEach(() => {
  mock.mutate
    .mockReset()
    .mockImplementation(() => new Promise(() => undefined));
  mock.error = undefined;
  mock.freshRow = {};
  mock.fetch.mockReset().mockImplementation(async () => [mock.freshRow]);
});
function renderEditor(children: React.ReactNode) {
  const client = new QueryClient();
  clients.add(client);
  const view = render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
  return { ...view, client };
}
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
  mock.freshRow = row;
  return renderEditor(
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
  "preserves a legacy grade and permits an offered correction after a failed save (tutor=%s)",
  async (tutor) => {
    let reject!: (error: Error) => void;
    mock.mutate
      .mockReturnValueOnce(
        new Promise((_, fail) => {
          reject = fail;
        }),
      )
      .mockResolvedValueOnce(undefined);
    const { client } = mount(tutor, false);
    const grade = screen.getByLabelText<HTMLSelectElement>(
      en.academics.legacyGrade,
    );
    expect(grade.value).toBe(tutor ? "2" : "IB year 1");
    expect(screen.queryByRole("option", { name: "Grade 10" })).toBeNull();
    expect(screen.getByRole("option", { name: "Grade 9" })).toBeTruthy();
    expect(screen.getByText(en.profilePolicy.nameHint)).toBeTruthy();
    const form = grade.closest("form")!;
    act(() => {
      fireEvent.submit(form);
      // A same-frame duplicate must not reach transport before pending renders.
      fireEvent.submit(form);
    });
    await waitFor(() => expect(mock.mutate).toHaveBeenCalledTimes(1));
    expect(mock.mutate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        gradeLevel: tutor ? 2 : "IB year 1",
        academicallyGraduated: false,
        expectedUpdatedAt: new Date("2026-09-01"),
      }),
    );
    await waitFor(() => expect(grade.matches(":disabled")).toBe(true));
    await act(async () => {
      reject(new Error("Save failed"));
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Save failed");
    expect(screen.getByLabelText(en.academics.legacyGrade)).toBe(grade);
    expect(grade.value).toBe(tutor ? "2" : "IB year 1");
    expect(grade.matches(":disabled")).toBe(false);
    fireEvent.change(grade, { target: { value: "12" } });
    fireEvent.submit(form);
    await waitFor(() => expect(mock.mutate).toHaveBeenCalledTimes(2));
    expect(mock.mutate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        gradeLevel: tutor ? 12 : "12",
        academicallyGraduated: false,
        expectedUpdatedAt: new Date("2026-09-01"),
      }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      en.accountProfile.sectionSaved,
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(client.isMutating()).toBe(0));
    const freshGrade = screen.getByLabelText<HTMLSelectElement>(
      en.academics.legacyGrade,
    );
    expect(freshGrade.matches(":disabled")).toBe(false);
    expect(freshGrade.value).toBe("12");
    expect(mock.fetch).toHaveBeenCalledExactlyOnceWith(undefined, {
      staleTime: 0,
    });
    expect(screen.queryByRole("option", { name: "Grade 10" })).toBeNull();
    // Refresh prepares another explicit correction without replaying the committed write.
    expect(mock.mutate).toHaveBeenCalledTimes(2);
    fireEvent.change(freshGrade, { target: { value: "9" } });
    fireEvent.submit(freshGrade.closest("form")!);
    await waitFor(() => expect(mock.mutate).toHaveBeenCalledTimes(3));
    expect(mock.mutate).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        gradeLevel: tutor ? 9 : "9",
        academicallyGraduated: false,
        expectedUpdatedAt: new Date("2026-09-02"),
      }),
    );
  },
);
it.each([true, false])(
  "keeps linked roster academics in the canonical editor (tutor=%s)",
  async (tutor) => {
    mount(tutor, true);
    expect(screen.queryByLabelText(en.academics.legacyGrade)).toBeNull();
    expect(screen.getByText("Shared academics: account")).toBeTruthy();
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(mock.mutate).toHaveBeenCalledTimes(1));
    expect(mock.mutate.mock.calls[0]?.[0]).not.toHaveProperty("gradeLevel");
    expect(mock.mutate.mock.calls[0]?.[0]).not.toHaveProperty(
      "academicallyGraduated",
    );
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
  async (canLink) => {
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
    const { container } = renderEditor(
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
    await waitFor(() => expect(mock.mutate).toHaveBeenCalledTimes(1));
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
