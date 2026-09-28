// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import { SubjectWillingness } from "./subject-willingness";

const mocks = vi.hoisted(() => {
  const mutation: { isPending?: boolean; error?: { message: string } } = {};
  const options: { onSuccess?: () => Promise<void> } = {};
  return {
    query: vi.fn(),
    mutate: vi.fn(),
    invalidate: vi.fn(),
    refetch: vi.fn(),
    mutation,
    options,
  };
});
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      subjectAvailability: {
        mySubjects: { invalidate: mocks.invalidate },
        mine: { invalidate: mocks.invalidate },
        options: { invalidate: mocks.invalidate },
      },
      tutorDetails: { invalidate: mocks.invalidate },
    }),
    subjectAvailability: {
      mySubjects: { useQuery: mocks.query },
      setMine: {
        useMutation: (options: typeof mocks.options) => {
          mocks.options = options;
          return { mutate: mocks.mutate, ...mocks.mutation };
        },
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutation = {};
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  mocks.query.mockReturnValue({
    data: {
      canEdit: true,
      rows: [
        {
          id: "math",
          name: "Math",
          active: true,
          qualified: true,
          willing: null,
          group: null,
          level: null,
        },
        {
          id: "bio",
          name: "Biology",
          active: true,
          qualified: false,
          willing: false,
          group: null,
          level: null,
        },
        {
          id: "old",
          name: "Archived Physics",
          active: false,
          qualified: true,
          willing: true,
          group: null,
          level: null,
        },
      ],
    },
    refetch: mocks.refetch,
  });
});
afterEach(cleanup);
const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SubjectWillingness />
    </NextIntlClientProvider>,
  );
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Edit willingness" }));
it("loads only on open, shows all three intent states and saves a self-scoped choice", async () => {
  show();
  expect(mocks.query).not.toHaveBeenCalled();
  open();
  const dialog = screen.getByRole("dialog", { name: "My Subject Willingness" });
  const selects = within(dialog).getAllByRole<HTMLSelectElement>("combobox");
  expect(selects.map((select) => select.value)).toEqual([
    "UNKNOWN",
    "NO",
    "YES",
  ]);
  fireEvent.change(selects[1]!, { target: { value: "YES" } });
  expect(mocks.mutate).toHaveBeenCalledWith({
    subjectId: "bio",
    willing: true,
  });
  await mocks.options.onSuccess?.();
  expect(mocks.invalidate).toHaveBeenCalledTimes(4);
  expect(
    within(
      screen.getByRole("article", { name: "Archived Physics" }),
    ).getByRole<HTMLOptionElement>("option", {
      name: en.subjectAvailability.willing,
    }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Edit willingness" }),
  );
});
it("supports search, empty results and Escape dismissal", () => {
  show();
  open();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "physics" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No subjects match these filters.")).toBeTruthy();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Edit willingness" }),
  );
});
it("keeps inactive accounts read-only and blocks duplicate saves while pending", () => {
  const result = mocks.query() as { data: { canEdit: boolean } };
  result.data.canEdit = false;
  const view = show();
  open();
  expect(
    screen
      .getAllByRole<HTMLSelectElement>("combobox")
      .every((select) => select.disabled),
  ).toBe(true);
  view.unmount();
  result.data.canEdit = true;
  mocks.mutation = { isPending: true };
  show();
  open();
  expect(
    screen
      .getAllByRole<HTMLSelectElement>("combobox")
      .every((select) => select.disabled),
  ).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("Saving…");
});
it("reports failed saves without changing confirmed values", () => {
  mocks.mutation = { error: { message: "Save failed" } };
  show();
  open();
  expect(screen.getByRole("alert").textContent).toBe("Save failed");
  expect(screen.getAllByRole<HTMLSelectElement>("combobox")[0]!.value).toBe(
    "UNKNOWN",
  );
  expect(screen.getByRole("status").textContent).toBe("");
});
it("reports loading and lets a failed query retry", async () => {
  mocks.query.mockReturnValue({});
  const view = show();
  open();
  expect(screen.getByRole("status")).toBeTruthy();
  view.unmount();
  mocks.query.mockReturnValue({
    error: { message: "Load failed" },
    refetch: mocks.refetch,
  });
  show();
  open();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
});
