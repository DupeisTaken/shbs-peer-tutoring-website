/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { PersonNameFields } from "./person-name-fields";
import { nameDraft } from "~/lib/person-name";
afterEach(cleanup);

it.each([en, zh])(
  "permits native submission only while the legacy Latin identity is unchanged",
  (messages) => {
    function Form() {
      const [value, setValue] = useState(nameDraft());
      return (
        <form>
          <PersonNameFields
            value={value}
            originalValue={nameDraft()}
            legacyName="张小明"
            onChange={setValue}
          />
          <button>Save</button>
        </form>
      );
    }
    const { container } = render(
      <NextIntlClientProvider
        locale={messages === zh ? "zh" : "en"}
        messages={messages}
      >
        <Form />
      </NextIntlClientProvider>,
    );
    const form = container.querySelector("form")!;
    const first =
      container.querySelector<HTMLInputElement>('[name="firstName"]')!;
    expect(form.checkValidity()).toBe(true);
    expect(first.required).toBe(false);
    fireEvent.change(container.querySelector('[name="alternativeNames"]')!, {
      target: { value: "小明" },
    });
    expect(form.checkValidity()).toBe(true);
    fireEvent.change(container.querySelector('[name="preferredName"]')!, {
      target: { value: "Alex" },
    });
    expect(first.required).toBe(true);
    expect(form.checkValidity()).toBe(false);
    fireEvent.change(first, { target: { value: "Alexander" } });
    expect(form.checkValidity()).toBe(true);
  },
);

it.each([false, true])(
  "labels all four fields and preserves requirement semantics (Chinese=%s)",
  (chinese) => {
    const messages = chinese ? zh : en;
    render(
      <NextIntlClientProvider
        locale={chinese ? "zh" : "en"}
        messages={messages}
      >
        <PersonNameFields
          value={nameDraft()}
          onChange={vi.fn()}
          legacyName="Mary Ann Smith"
        />
      </NextIntlClientProvider>,
    );
    const first = screen.getByLabelText<HTMLInputElement>(
      `${messages.personName.firstName} ${messages.signupFields.required}`,
    );
    expect(first.required).toBe(true);
    expect(first.value).toBe(""); // Preserve the original without guessing where a multi-part given name ends.
    expect(
      screen.getByText(
        messages.personName.legacy.replace("{name}", "Mary Ann Smith"),
      ),
    ).toBeTruthy();
    for (const field of [
      "lastName",
      "preferredName",
      "alternativeNames",
    ] as const) {
      expect(
        screen.getByLabelText<HTMLInputElement>(
          `${messages.personName[field]} ${messages.signupFields.optional}`,
        ).required,
      ).toBe(false);
    }
  },
);
it("reports a non-Latin preferred name on blur while allowing another writing system", () => {
  function Form() {
    const [value, setValue] = useState(
      nameDraft({ firstName: "José", alternativeNames: "何塞" }),
    );
    return <PersonNameFields value={value} onChange={setValue} />;
  }
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Form />
    </NextIntlClientProvider>,
  );
  const input = screen.getByLabelText<HTMLInputElement>(
    "Preferred Name Optional",
  );
  fireEvent.change(input, { target: { value: "何塞" } });
  fireEvent.blur(input);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(en.profilePolicy.latinRequired)).toBeTruthy();
  fireEvent.change(input, { target: { value: "Zoë" } });
  expect(input.getAttribute("aria-invalid")).toBeNull();
  expect(
    screen.getByLabelText<HTMLInputElement>("Name in Another Language Optional")
      .value,
  ).toBe("何塞");
});

it.each([en, zh])(
  "native validity rejects invalid Latin fields before submit and updates with external drafts",
  (messages) => {
    const onChange = vi.fn();
    const locale = messages === zh ? "zh" : "en";
    const tree = (
      firstName: string,
      lastName: string,
      preferredName: string,
    ) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <form>
          <PersonNameFields
            value={nameDraft({
              firstName,
              lastName,
              preferredName,
              alternativeNames: "张小明",
            })}
            onChange={onChange}
          />
        </form>
      </NextIntlClientProvider>
    );
    const view = render(tree("无效", "", ""));
    const form = view.container.querySelector("form")!;
    for (const [index, values] of [
      [0, ["无效", "", ""]],
      [1, ["José", "张", ""]],
      [2, ["José", "Smith", "小明"]],
    ] as const) {
      view.rerender(tree(values[0], values[1], values[2]));
      const inputs = view.container.querySelectorAll<HTMLInputElement>("input");
      expect(inputs[index]!.validity.customError).toBe(true);
      expect(inputs[index]!.validationMessage).toBe(
        messages.profilePolicy.latinRequired,
      );
      expect(form.checkValidity()).toBe(false);
      expect(inputs[3]!.validity.customError).toBe(false);
    }
    // External reset/correction must clear custom validity as well as the values.
    view.rerender(tree("José", "O’Neil", "Zoë"));
    expect(form.checkValidity()).toBe(true);
    view.rerender(tree("Ada", "", ""));
    expect(form.checkValidity()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  },
);
