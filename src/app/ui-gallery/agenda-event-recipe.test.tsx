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
    expect(regular.className).toContain("border-l-yellow-400");
    expect(
      within(regular).getByText(messages.agendaEvents.needsAction),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: messages.sessionPlanning.record }),
    );
    expect(document.getElementById("gallery-regular")).toBe(regular);
    expect(regular.className).toContain("border-l-emerald-400");
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

it.each([
  ["en", en],
  ["zh", zh],
] as const)(
  "keeps paused guidance independent of attendance and exception review (%s)",
  (locale, messages) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AgendaEventRecipe />
      </NextIntlClientProvider>,
    );
    const paused = document.getElementById("gallery-paused")!;
    const unavailable = document.getElementById("gallery-unavailable-paused")!;
    expect(
      within(paused).getByText(messages.sessionPlanning.tutoringPausedHelp),
    ).toBeTruthy();
    expect(
      within(paused).queryByText(messages.agendaEvents.attendanceNeeded),
    ).toBeNull();
    expect(
      within(unavailable).getByText(messages.sessionPlanning.scheduleUnavailableHelp),
    ).toBeTruthy();
    expect(
      within(unavailable).getByText(messages.sessionPlanning.tutoringPausedHelp),
    ).toBeTruthy();
    expect(within(unavailable).queryByRole("button")).toBeNull();
    fireEvent.click(
      within(paused).getByRole("button", {
        name: messages.sessionPlanning.arrangeException,
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(
        messages.sessionPlanning.tutoringPauseProposal,
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: messages.sessionPlanning.cancel,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: messages.sessionPlanning.record }),
    );
    expect(document.getElementById("gallery-paused")).toBe(paused);
    expect(
      within(paused).getByText(messages.sessionPlanning.tutoringPausedHelp),
    ).toBeTruthy();
    expect(
      within(paused).getByRole("button", {
        name: messages.sessionPlanning.arrangeException,
      }),
    ).toBeTruthy();
  },
);
