/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { RecipeGallery } from "./recipes";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(["en", "zh"] as const)(
  "keeps the %s failed draft beside a completed independent section",
  (locale) => {
    vi.useFakeTimers();
    render(<RecipeGallery locale={locale} state="normal" />);
    const english = locale === "en";
    fireEvent.click(
      screen.getByRole("button", {
        name: english ? "Open wide participant editor" : "打开宽版参与者编辑器",
      }),
    );
    const dialog = screen.getByRole("dialog");
    const draft = within(dialog).getByLabelText<HTMLInputElement>(
      english ? "Draft note" : "草稿备注",
    );
    fireEvent.change(draft, { target: { value: "Keep the failed draft" } });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: english ? "Simulate a failed save" : "模拟保存失败",
      }),
    );
    act(() => {
      vi.advanceTimersByTime(900);
    });
    const savedDraft = within(dialog).getByLabelText<HTMLInputElement>(
      english ? "Independent profile draft" : "独立个人资料草稿",
    );
    fireEvent.change(savedDraft, { target: { value: "Committed section" } });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: english ? "Save the other section" : "保存另一部分",
      }),
    );
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    expect(
      within(dialog).getByText((english ? en : zh).accountProfile.sectionSaved),
    ).toBeTruthy();
    expect(draft.value).toBe("Keep the failed draft");
    expect(draft.matches(":disabled")).toBe(false);
    expect(savedDraft.matches(":disabled")).toBe(true);
    expect(dialog.getAttribute("aria-busy")).toBe("false");
    expect(savedDraft.closest("fieldset")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: (english ? en : zh).accountProfile.close,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("keeps a nested wide editor draft through Escape and pending failure", () => {
  vi.useFakeTimers();
  render(<RecipeGallery locale="en" state="normal" />);
  const opener = screen.getByRole("button", {
    name: "Open wide participant editor",
  });
  opener.focus();
  fireEvent.click(opener);
  const editor = screen.getByRole("dialog", {
    name: "Participant editor example",
  });
  fireEvent.change(within(editor).getByLabelText("Draft note"), {
    target: { value: "Unsaved note" },
  });
  const review = within(editor).getByRole("button", {
    name: "Review participant change",
  });
  review.focus();
  fireEvent.click(review);
  fireEvent(
    screen.getByRole("dialog", { name: "Review participant change" }),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(review);
  fireEvent.click(
    within(editor).getByRole("button", { name: "Simulate a failed save" }),
  );
  expect(
    within(editor).getByRole<HTMLButtonElement>("button", { name: "Close" })
      .disabled,
  ).toBe(true);
  fireEvent(editor, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(900);
  });
  expect(within(editor).getByRole("alert").textContent).toContain(
    "draft is retained",
  );
  expect(
    within(editor).getByLabelText<HTMLInputElement>("Draft note").value,
  ).toBe("Unsaved note");
  fireEvent.click(within(editor).getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(opener);
});

it("keeps participant drafts mounted across failure, pending and read-only states", () => {
  const view = render(<RecipeGallery locale="en" state="normal" />);
  const firstName = screen.getByRole<HTMLInputElement>("textbox", {
    name: /First Name/,
  });
  fireEvent.change(firstName, { target: { value: "Jordan" } });
  view.rerender(<RecipeGallery locale="en" state="error" />);
  expect(firstName.value).toBe("Jordan");
  expect(screen.getByRole("alert").textContent).toContain("draft is retained");
  view.rerender(<RecipeGallery locale="en" state="pending" />);
  expect(firstName.matches(":disabled")).toBe(true);
  view.rerender(<RecipeGallery locale="en" state="readonly" />);
  expect(firstName.matches(":disabled")).toBe(true);
  expect(firstName.value).toBe("Jordan");
});

it("invalidates preview and acknowledgement when its selected change changes", () => {
  render(<RecipeGallery locale="en" state="normal" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare example review" }),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Apply example change",
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "I reviewed this example change" }),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Requested room name" }),
    { target: { value: "science" } },
  );
  expect(screen.queryByRole("region", { name: "Review room name" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare example review" }),
  );
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "I reviewed this example change",
    }).checked,
  ).toBe(false);
});

it("demonstrates unknown willingness and retains draft text after a background retry", () => {
  render(<RecipeGallery locale="en" state="normal" />);
  expect(screen.getByText("No answer recorded")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "No" }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(screen.queryByText("No answer recorded")).toBeNull();
  expect(
    screen.getByRole("button", { name: "No" }).getAttribute("aria-pressed"),
  ).toBe("true");
  const draft = screen.getByLabelText<HTMLInputElement>("Draft note");
  fireEvent.change(draft, { target: { value: "Still editing" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Simulate background failure" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  expect(draft.value).toBe("Still editing");
  expect(screen.getByRole("status").textContent).toContain(
    "draft is unchanged",
  );
});

it("translates the recipe compositions and keeps policy reading separate from consent", () => {
  render(<RecipeGallery locale="zh" state="normal" />);
  fireEvent.click(screen.getByRole("button", { name: "打开政策阅读器" }));
  const reader = screen.getByRole("dialog", { name: "示例项目政策" });
  expect(within(reader).getByRole("region").className).toContain(
    "overflow-y-auto",
  );
  expect(within(reader).queryByRole("checkbox")).toBeNull();
  expect(within(reader).getAllByRole("button")).toHaveLength(1);
});
