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
import { UIGallery } from "./gallery";

vi.mock("./navigation-recipes", () => ({ NavigationRecipes: () => null }));

beforeEach(() => {
  // jsdom does not implement native dialog modality; browser checks cover the inert background.
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
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

it("saves both names together and cancels to the last saved draft", () => {
  render(<UIGallery />);
  const name = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Display name",
  });
  const other = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Name in another language (optional)",
  });
  fireEvent.change(name, { target: { value: "Jordan Chen" } });
  fireEvent.change(other, { target: { value: "陈乔丹" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(screen.getByText("Profile saved in this example.")).toBeTruthy();
  fireEvent.change(name, { target: { value: "Discard this" } });
  fireEvent.change(other, { target: { value: "未保存" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(name.value).toBe("Jordan Chen");
  expect(other.value).toBe("陈乔丹");
  expect(screen.queryByText("Profile saved in this example.")).toBeNull();
});

it("shows saving, error and read-only states while keeping a failed draft available", () => {
  render(<UIGallery />);
  const state = screen.getByRole("combobox", { name: "Form state" });
  const name = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Display name",
  });
  fireEvent.change(name, { target: { value: "Unsaved draft" } });
  fireEvent.change(state, { target: { value: "pending" } });
  expect(name.matches(":disabled")).toBe(true);
  expect(
    screen
      .getByRole("group", { name: "Profile names" })
      .getAttribute("aria-busy"),
  ).toBe("true");
  fireEvent.change(state, { target: { value: "error" } });
  const failure = screen
    .getByRole("heading", { name: "Profile could not be saved." })
    .closest("section")!;
  expect(failure.getAttribute("role")).toBe("alert");
  expect(name.value).toBe("Unsaved draft");
  fireEvent.click(within(failure).getByRole("button", { name: "Try again" }));
  expect(screen.queryByText("Profile could not be saved.")).toBeNull();
  expect(name.value).toBe("Unsaved draft");
  // Recovery clears the error; the real form submission still enforces required fields.
  expect(screen.queryByText("Profile saved in this example.")).toBeNull();
  fireEvent.change(state, { target: { value: "readonly" } });
  expect(name.readOnly).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save profile" })
      .disabled,
  ).toBe(true);
  expect(
    screen.getByText(
      "You can review this profile, but you cannot edit it in this state.",
    ),
  ).toBeTruthy();
});

it("keeps selection, immediate switches and tab navigation distinct from saving", () => {
  render(<UIGallery />);
  fireEvent.click(screen.getByRole("button", { name: "Crew" }));
  expect(
    screen.getByRole("button", { name: "Crew" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.queryByText("Example audience updated.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Use this audience" }));
  expect(screen.getByText("Example audience updated.")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "Email reminders" }));
  expect(
    screen
      .getByRole("switch", { name: "Email reminders" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  const details = screen.getByRole("tab", { name: "Details" });
  act(() => details.focus());
  fireEvent.keyDown(details, { key: "ArrowRight" });
  const preview = screen.getByRole("tab", { name: "Preview" });
  expect(document.activeElement).toBe(preview);
  expect(preview.getAttribute("aria-selected")).toBe("false");
  fireEvent.click(preview);
  expect(preview.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toContain(
    "Preview: an orientation meeting",
  );
  expect(screen.queryByText("Profile saved in this example.")).toBeNull();
});

it("uses the shared dialog and restores focus after cancel or confirmation", () => {
  render(<UIGallery />);
  const trigger = screen.getAllByRole("button", {
    name: "Review archive action",
  })[0]!;
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: "Archive orientation meeting?",
  });
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.click(cancel);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Archive meeting",
    }),
  );
  expect(screen.getByText("Example meeting archived.")).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
});

it("previews every theme without persisting it and translates long example labels", () => {
  document.documentElement.dataset.theme = "rose";
  const { unmount } = render(<UIGallery />);
  const cookieBefore = document.cookie;
  const themes = screen.getByRole("combobox", { name: "Accent theme" });
  for (const value of ["indigo", "violet", "emerald", "rose", "amber", "sky"]) {
    fireEvent.change(themes, { target: { value } });
    expect(document.documentElement.dataset.theme).toBe(value);
  }
  fireEvent.change(screen.getByRole("combobox", { name: "Example language" }), {
    target: { value: "zh" },
  });
  expect(screen.getByRole("main").getAttribute("lang")).toBe("zh-CN");
  expect(screen.getByRole("button", { name: "使用所选参加人员" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "辅导伙伴" })).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "示例教室可用时间" }).tabIndex,
  ).toBe(0);
  expect(document.cookie).toBe(cookieBefore);
  unmount();
  expect(document.documentElement.dataset.theme).toBe("rose");
});

it("replaces a failed schedule with the empty result when retried", () => {
  render(<UIGallery />);
  const error = screen
    .getByRole("heading", { name: "Schedule could not be loaded" })
    .closest("section")!;
  fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
  expect(screen.queryByText("Schedule could not be loaded")).toBeNull();
  expect(
    screen.getByText("Example schedule loaded. There are no meetings yet."),
  ).toBeTruthy();
});

it("demonstrates summary-only rows and rightmost text links with translated detail submenus", () => {
  render(<UIGallery />);
  const table = screen.getByRole("table", { name: "Manage records" });
  expect(table.textContent).not.toContain("Bring questions");
  const trigger = within(table).getByRole("button", {
    name: "View details: Orientation meeting",
  });
  expect(trigger.closest("td")).toBe(trigger.closest("tr")?.lastElementChild);
  expect(trigger.className).toContain("table-action-link");
  fireEvent.click(trigger);
  expect(
    within(
      screen.getByRole("dialog", { name: "Orientation meeting" }),
    ).getByText(/Bring questions/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Example language" }), {
    target: { value: "zh" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "查看详情: 新成员介绍会议" }),
  );
  expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
});
