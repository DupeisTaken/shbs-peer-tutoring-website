// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AgendaEventRecipe } from "./agenda-event-recipe";

afterEach(cleanup);
it.each([
  ["en", en],
  ["zh", zh],
] as const)(
  "demonstrates closing synthetic attendance work while retaining the event (%s)",
  (locale, messages) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AgendaEventRecipe />
      </NextIntlClientProvider>,
    );
    const regular = document.getElementById("gallery-regular")!;
    expect(
      within(regular).getByText(messages.agendaEvents.needsAction),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: messages.sessionPlanning.record }),
    );
    expect(document.getElementById("gallery-regular")).toBe(regular);
    expect(
      within(regular).getByText(messages.agendaEvents.completed),
    ).toBeTruthy();
    expect(
      within(regular).queryByText(messages.agendaEvents.needsAction),
    ).toBeNull();
    expect(
      within(regular).queryByText(messages.agendaEvents.attendanceNeeded),
    ).toBeNull();
  },
);
