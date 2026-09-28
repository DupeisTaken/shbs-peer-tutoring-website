// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import de from "../../../messages/de.json";
import el from "../../../messages/el.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import { FieldRequirement } from "./field-requirement";
import { PolicyAgreement } from "./policy-agreement";

afterEach(cleanup);

it.each(Object.entries({ en, zh, de, el, es, fr, ja, ko }))(
  "uses localized requirement text without duplicate markers in %s",
  (locale, messages) => {
    const { rerender } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <FieldRequirement state="required" />
        <FieldRequirement state="optional" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.signupFields.required)).toBeTruthy();
    expect(screen.getByText(messages.signupFields.optional)).toBeTruthy();
    // Field names must stay neutral when an administrator changes their requirement.
    for (const labels of [
      messages.public.signup.fields,
      messages.public.tutorSignup.fields,
      messages.public.crewSignup.fields,
      { latin: messages.identityUsername.preferredLatinName },
    ]) {
      for (const label of Object.values(labels)) {
        expect(label).not.toContain("*");
        expect(label).not.toMatch(
          /[（(](?:optional|opcional|可选|选填|任意|선택|προαιρετικό|optionnel|facultatif)[）)]/i,
        );
      }
    }
    rerender(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <FieldRequirement state="hidden" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(messages.signupFields.required)).toBeNull();
    expect(screen.queryByText(messages.signupFields.optional)).toBeNull();
  },
);

it("shows consent as required while preserving the policy-reading gate", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PolicyAgreement
        messageKey="public.signup.agree"
        appTitle="School"
        policy={{ title: "Policy", body: "Read these rules." }}
        checked={false}
        onChange={() => undefined}
      />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: /Required$/ })
      .disabled,
  ).toBe(true);
});
