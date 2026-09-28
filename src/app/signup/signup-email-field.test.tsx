// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { SignupEmailField } from "./signup-email-field";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const renderField = (disabled = false) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SignupEmailField
        value=""
        onChange={() => undefined}
        disabled={disabled}
      />
    </NextIntlClientProvider>,
  );
const trigger = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Email for Sign In Required",
  });

it.each([en, zh])(
  "keeps translated naming and description accessible while the help is hidden",
  (messages) => {
    render(
      <NextIntlClientProvider
        locale={messages === en ? "en" : "zh"}
        messages={messages}
      >
        <SignupEmailField value="" onChange={() => undefined} />
      </NextIntlClientProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: `${messages.survey.emailLabel} ${messages.signupFields.required}`,
      description: messages.survey.emailHelp,
    });
    expect(input.required).toBe(true);
    expect(input.type).toBe("email");
    expect(input.autocomplete).toBe("email");
    expect(input.maxLength).toBe(254);
    expect(screen.queryByRole("tooltip")).toBeNull();
  },
);

it("opens on hover, stays open across the panel, and closes when leaving the region", () => {
  renderField();
  const button = trigger();
  fireEvent.mouseEnter(button);
  const panel = screen.getByRole("tooltip");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  fireEvent.mouseLeave(button, { relatedTarget: panel });
  fireEvent.mouseEnter(panel, { relatedTarget: button });
  expect(screen.getByRole("tooltip")).toBe(panel);
  fireEvent.mouseLeave(button.parentElement!, { relatedTarget: document.body });
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("pins hover help on click, survives pointer exit, and toggles off on another click", () => {
  renderField();
  const button = trigger();
  fireEvent.mouseEnter(button);
  fireEvent.click(button);
  fireEvent.mouseLeave(button.parentElement!, { relatedTarget: document.body });
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.click(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(button.type).toBe("button");
});

it("opens on direct click/tap and closes on an outside pointer interaction", () => {
  renderField();
  fireEvent.click(trigger());
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole("textbox"));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("opens on keyboard focus, respects Escape, and dismisses when tabbing to the input", () => {
  renderField();
  const button = trigger();
  act(() => button.focus());
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.keyDown(button, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(document.activeElement).toBe(button);
  act(() => screen.getByRole<HTMLInputElement>("textbox").focus());
  act(() => button.focus());
  expect(screen.getByRole("tooltip")).toBeTruthy();
  act(() => screen.getByRole<HTMLInputElement>("textbox").focus());
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("keeps preview fields disabled and prevents hover disclosure", () => {
  renderField(true);
  expect(trigger().disabled).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("textbox").disabled).toBe(true);
  fireEvent.mouseEnter(trigger());
  fireEvent.click(trigger());
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("flips below the label near the viewport top and repositions after scrolling", () => {
  let top = -80;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        top,
        bottom: top + 100,
        left: 24,
        right: 312,
        width: 288,
        height: 100,
      }) as DOMRect,
  );
  renderField();
  fireEvent.click(trigger());
  const panel = screen.getByRole("tooltip");
  expect(panel.dataset.placement).toBe("below");
  top = 100;
  fireEvent.scroll(window);
  expect(panel.dataset.placement).toBe("above");
});

it("continues reporting email edits without submitting the form", () => {
  const onChange = vi.fn();
  const submit = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <form onSubmit={submit}>
        <SignupEmailField value="" onChange={onChange} />
      </form>
    </NextIntlClientProvider>,
  );
  fireEvent.click(trigger());
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "student@example.test" },
  });
  expect(onChange).toHaveBeenCalledWith("student@example.test");
});
