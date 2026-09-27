// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { PreferredLatinName } from "./preferred-latin-name";
afterEach(cleanup);
it.each(["en", "zh"])(
  "offers an accessible, optional spelling for Unicode names in %s",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <PreferredLatinName name="王小明" value="" onChange={onChange} />
      </NextIntlClientProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: messages.identityUsername.preferredLatinName,
    });
    expect(input.required).toBe(false);
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.change(input, { target: { value: "Xiaoming Wang" } });
    expect(onChange).toHaveBeenCalledWith("Xiaoming Wang");
  },
);
it.each(["", "Alice Chen", "Élodie"])(
  "does not add a spelling prompt for %s",
  (name) => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PreferredLatinName name={name} value="" onChange={() => undefined} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  },
);
