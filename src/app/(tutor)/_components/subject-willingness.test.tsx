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
import zh from "../../../../messages/zh.json";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { SubjectWillingness } from "./subject-willingness";

const mocks = vi.hoisted(() => {
  const mutation: {
    isPending?: boolean;
    isSuccess?: boolean;
    error?: { message: string };
  } = {};
  const options: {
    onSuccess?: () => Promise<void>;
    onSettled?: () => void;
  } = {};
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
        {
          id: "chem",
          name: "Chemistry",
          active: true,
          qualified: true,
          willing: false,
          group: null,
          level: null,
        },
      ],
    },
    refetch: mocks.refetch,
  });
});
afterEach(cleanup);
const content = (locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
    <SubjectWillingness />
  </NextIntlClientProvider>
);
const show = () => render(content());
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Edit willingness" }));
it("loads only on open, hides unqualified subjects and saves a self-scoped choice", async () => {
  show();
  expect(mocks.query).not.toHaveBeenCalled();
  open();
  const dialog = screen.getByRole("dialog", { name: "My Subject Willingness" });
  expect(within(dialog).queryByRole("combobox")).toBeNull();
  expect(within(dialog).queryByRole("article", { name: "Biology" })).toBeNull();
  const math = within(screen.getByRole("article", { name: "Math" }));
  expect(math.getAllByRole("button", { pressed: false })).toHaveLength(2);
  expect(math.getByText("Not recorded")).toBeTruthy();
  fireEvent.click(math.getByRole("button", { name: "Willing to Tutor" }));
  expect(mocks.mutate).toHaveBeenCalledWith({
    subjectId: "math",
    willing: true,
  });
  await mocks.options.onSuccess?.();
  expect(mocks.invalidate).toHaveBeenCalledTimes(4);
  expect(
    within(
      screen.getByRole("article", { name: "Archived Physics" }),
    ).getByRole<HTMLButtonElement>("button", {
      name: "Willing to Tutor",
      pressed: true,
    }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Edit willingness" }),
  );
});
it("keeps choices mutually exclusive and does not clear a selected answer on repeat clicks", () => {
  show();
  open();
  const chemistry = within(screen.getByRole("article", { name: "Chemistry" }));
  expect(chemistry.getAllByRole("button", { pressed: true })).toHaveLength(1);
  fireEvent.click(
    chemistry.getByRole("button", {
      name: "Unwilling to Tutor",
      pressed: true,
    }),
  );
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(
    chemistry.getByRole("button", { name: "Willing to Tutor", pressed: false }),
  );
  expect(mocks.mutate).toHaveBeenLastCalledWith({
    subjectId: "chem",
    willing: true,
  });
  mocks.options.onSettled?.();
  const archived = within(
    screen.getByRole("article", { name: "Archived Physics" }),
  );
  fireEvent.click(archived.getByRole("button", { name: "Unwilling to Tutor" }));
  expect(mocks.mutate).toHaveBeenLastCalledWith({
    subjectId: "old",
    willing: false,
  });
});
it("guides tutors without qualified subjects to request qualification", () => {
  mocks.query.mockReturnValue({ data: { canEdit: true, rows: [] } });
  show();
  open();
  expect(screen.queryByRole("article")).toBeNull();
  expect(
    screen.getByText(en.subjectAvailability.noQualifiedSubjects),
  ).toBeTruthy();
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
      .getAllByRole<HTMLButtonElement>("button", {
        name: /^(Unwilling|Willing) to Tutor$/,
      })
      .every((button) => button.disabled),
  ).toBe(true);
  view.unmount();
  result.data.canEdit = true;
  mocks.mutation = { isPending: true };
  show();
  open();
  expect(
    screen
      .getAllByRole<HTMLButtonElement>("button", {
        name: /^(Unwilling|Willing) to Tutor$/,
      })
      .every((button) => button.disabled),
  ).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("Saving…");
});
it("reports failed saves without changing confirmed values", () => {
  mocks.mutation = { error: { message: "Save failed" } };
  show();
  open();
  expect(screen.getByRole("alert").textContent).toBe("Save failed");
  expect(
    within(screen.getByRole("article", { name: "Math" })).getAllByRole(
      "button",
      { pressed: false },
    ),
  ).toHaveLength(2);
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

it.each(["en", "zh"] as const)(
  "retains %s willingness intent, blocks dismissal during writes, and releases after failure and retry",
  async (locale) => {
    const labels = locale === "en" ? en : zh;
    const view = render(content(locale));
    const opener = screen.getByRole("button", {
      name: labels.subjectAvailability.editMine,
    });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", {
      name: labels.subjectAvailability.myTitle,
    });
    const search = within(dialog).getByRole<HTMLInputElement>("textbox");
    fireEvent.change(search, { target: { value: "Math" } });
    const choice = within(dialog).getByRole("button", {
      name: labels.subjectAvailability.willingChoice,
    });
    // Two clicks before the mocked mutation publishes isPending still produce one write.
    fireEvent.click(choice);
    fireEvent.click(choice);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      subjectId: "math",
      willing: true,
    });
    mocks.mutation = { isPending: true };
    view.rerender(content(locale));
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(search.disabled).toBe(true);
    const close = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: labels.accountProfile.close,
    });
    expect(close.disabled).toBe(true);
    for (let press = 0; press < 3; press++) {
      fireEvent.keyDown(dialog, { key: "Escape" });
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(screen.getByRole("dialog")).toBe(dialog);
    }
    mocks.options.onSettled?.();
    mocks.mutation = {
      isPending: false,
      error: { message: "Willingness save failed" },
    };
    view.rerender(content(locale));
    expect(dialog.getAttribute("aria-busy")).toBe("false");
    expect(close.disabled).toBe(false);
    expect(search.value).toBe("Math");
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "Willingness save failed",
    );
    expect(
      within(dialog).getAllByRole("button", { pressed: false }),
    ).toHaveLength(2);
    fireEvent.click(choice);
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      subjectId: "math",
      willing: true,
    });
    mocks.mutation = { isPending: true };
    view.rerender(content(locale));
    expect(close.disabled).toBe(true);
    await mocks.options.onSuccess?.();
    expect(mocks.invalidate).toHaveBeenCalledTimes(4);
    const query = mocks.query() as {
      data: { rows: { id: string; willing: boolean | null }[] };
    };
    query.data.rows.find((row) => row.id === "math")!.willing = true;
    mocks.options.onSettled?.();
    mocks.mutation = { isPending: false, isSuccess: true };
    view.rerender(content(locale));
    expect(dialog.getAttribute("aria-busy")).toBe("false");
    expect(
      within(dialog).getByRole("button", {
        name: labels.subjectAvailability.willingChoice,
        pressed: true,
      }),
    ).toBe(choice);
    expect(within(dialog).getByRole("status").textContent).toBe(
      labels.workflows.saved,
    );
    expect(query.data.rows.find((row) => row.id === "chem")!.willing).toBe(
      false,
    );
    fireEvent.click(choice);
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  },
);

it("registers owned writes through query-state changes and releases the retry controls", () => {
  const ready: unknown = mocks.query();
  const view = show();
  open();
  mocks.mutation = { isPending: true };
  mocks.query.mockReturnValue({});
  view.rerender(content());
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  mocks.query.mockReturnValue({
    error: { message: "Query failed" },
    refetch: mocks.refetch,
  });
  view.rerender(content());
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }).disabled,
  ).toBe(true);
  mocks.mutation = { isPending: false };
  view.rerender(content());
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
  mocks.query.mockReturnValue(ready);
  view.rerender(content());
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled,
  ).toBe(false);
});

it("does not register inherited busy state as its own write or latch either dialog", () => {
  const nested = (pending: boolean) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileDialog title="Parent" onClose={vi.fn()} pending={pending}>
        <SubjectWillingness />
      </ProfileDialog>
    </NextIntlClientProvider>
  );
  const view = render(nested(false));
  open();
  const parent = screen.getByRole("dialog", { name: "Parent" });
  const child = screen.getByRole("dialog", { name: "My Subject Willingness" });
  view.rerender(nested(true));
  expect(child.getAttribute("aria-busy")).toBe("true");
  expect(
    within(child).getByRole<HTMLButtonElement>("button", { name: "Close" })
      .disabled,
  ).toBe(true);
  view.rerender(nested(false));
  expect(child.getAttribute("aria-busy")).toBe("false");
  mocks.mutation = { isPending: true };
  view.rerender(nested(false));
  expect(parent.getAttribute("aria-busy")).toBe("true");
  mocks.mutation = { isPending: false };
  view.rerender(nested(false));
  expect(parent.getAttribute("aria-busy")).toBe("false");
  expect(child.getAttribute("aria-busy")).toBe("false");
  fireEvent.click(within(child).getByRole("button", { name: "Close" }));
  expect(
    screen.queryByRole("dialog", { name: "My Subject Willingness" }),
  ).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Edit willingness" }),
  );
});
