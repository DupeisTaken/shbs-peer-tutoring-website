// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { CodeDisplay, CodeInput } from "./code-field";

afterEach(cleanup);
function mount(
  purpose: "invitation" | "email",
  props: Partial<React.ComponentProps<typeof CodeInput>> = {},
  locale: "en" | "zh" = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <CodeInput purpose={purpose} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("purpose-specific code entry", () => {
  it.each([
    ["invitation", 5],
    ["email", 4],
  ] as const)(
    "shows %s slots before typing and preserves leading zeros",
    (purpose, count) => {
      const { container } = mount(purpose);
      const input = screen.getByRole<HTMLInputElement>("textbox");
      expect(container.querySelectorAll(".code-positions span")).toHaveLength(
        count,
      );
      expect(input.getAttribute("inputmode")).toBe("numeric");
      expect(input.autocomplete).toBe("one-time-code");
      expect(input.getAttribute("aria-describedby")).toBeTruthy();
      fireEvent.change(input, { target: { value: "01" } });
      expect(input.value).toBe("01");
      expect(container.querySelectorAll('[data-filled="true"]')).toHaveLength(
        2,
      );
      expect(input.validity.valid).toBe(false);
      fireEvent.change(input, { target: { value: "0".repeat(count) } });
      expect(input.value).toBe("0".repeat(count));
      expect(input.validity.valid).toBe(true);
    },
  );

  it("supports full-code paste, selected correction and deletion without losing zeros", () => {
    mount("invitation");
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const paste = (text: string) =>
      fireEvent.paste(input, { clipboardData: { getData: () => text } });
    paste("00-123");
    expect(input.value).toBe("00123");
    input.setSelectionRange(2, 4);
    paste("90");
    expect(input.value).toBe("00903");
    fireEvent.change(input, { target: { value: "0090" } });
    expect(input.value).toBe("0090");
    expect(document.querySelectorAll('[data-filled="true"]')).toHaveLength(4);
  });

  it.each(["A1B2C", "A1B2C3D4E5F6"])(
    "keeps outstanding invitation %s intact through paste and correction",
    (legacy) => {
      mount("invitation");
      const input = screen.getByRole<HTMLInputElement>("textbox");
      fireEvent.paste(input, { clipboardData: { getData: () => legacy } });
      expect(input.value).toBe(legacy);
      expect(input.validity.valid).toBe(true);
      fireEvent.change(input, { target: { value: legacy.slice(0, 5) } });
      expect(input.value).toBe("A1B2C");
    },
  );

  it.each(["0123", "AB123", "A1B2C3", "A1B2C3D4E5F6"])(
    "accepts newly issued and outstanding emailed code %s",
    (code) => {
      mount("email");
      const input = screen.getByRole<HTMLInputElement>("textbox");
      fireEvent.change(input, { target: { value: code } });
      expect(input.value).toBe(code);
      expect(input.validity.valid).toBe(true);
    },
  );

  it("rejects invalid lengths and letters in a new four-position code", () => {
    mount("email");
    const input = screen.getByRole<HTMLInputElement>("textbox");
    for (const code of ["123", "ABCD", "1234567"]) {
      fireEvent.change(input, { target: { value: code } });
      expect(input.checkValidity()).toBe(false);
    }
  });

  it("offers a text keyboard for manually entering an outstanding alphanumeric code", () => {
    mount("invitation");
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.click(
      screen.getByRole("button", { name: en.codes.lettersKeyboard }),
    );
    expect(input.inputMode).toBe("text");
    fireEvent.change(input, { target: { value: "A1B2C" } });
    expect(input.value).toBe("A1B2C");
    fireEvent.click(
      screen.getByRole("button", { name: en.codes.numericKeyboard }),
    );
    expect(input.inputMode).toBe("numeric");
    expect(input.value).toBe("A1B2C");
  });

  it("retains the draft and focus target when pending or errors change", () => {
    const onValueChange = vi.fn();
    const view = mount("email", { value: "0123", onValueChange });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    input.focus();
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <CodeInput
          purpose="email"
          value="0123"
          disabled
          aria-invalid="true"
          aria-describedby="challenge-error"
          onValueChange={onValueChange}
        />
        <p id="challenge-error" role="alert">
          Incorrect code. Retry.
        </p>
      </NextIntlClientProvider>,
    );
    expect(input.value).toBe("0123");
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("challenge-error");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("uses translated purpose labels and exports the complete code as text", () => {
    mount("email", {}, "zh");
    expect(screen.getByLabelText(new RegExp(zh.codes.emailLabel))).toBeTruthy();
    cleanup();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CodeDisplay code="00123" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("00123").textContent).toBe("00123");
    expect(screen.getByText(en.codes.invitationLabel)).toBeTruthy();
  });
});
