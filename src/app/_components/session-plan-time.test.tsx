// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { changePlannedClock, SessionPlanTimeFields } from "./session-plan-time";
afterEach(cleanup);
it("synchronizes either clock to 45 minutes without silently moving the date", () => {
  const value = { date: "2026-10-29", startMin: 900 };
  expect(changePlannedClock(value, "16:00", "start")).toEqual({
    ...value,
    startMin: 960,
  });
  expect(changePlannedClock(value, "16:00", "end")).toEqual({
    ...value,
    startMin: 915,
  });
  expect(changePlannedClock(value, "00:15", "end")).toBe(value);
  expect(changePlannedClock(value, "23:30", "start")).toBe(value);
  expect(changePlannedClock(value, "", "start")).toBe(value);
  expect(changePlannedClock(value, "00:00", "end")).toEqual({
    ...value,
    startMin: 1395,
  });
  expect(changePlannedClock(value, "12:99", "start")).toBe(value);
});
it.each(["en", "zh"] as const)(
  "labels and synchronizes %s planned clocks",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    function Editor() {
      const [value, setValue] = useState({ date: "2026-10-29", startMin: 900 });
      return <SessionPlanTimeFields value={value} onChange={setValue} />;
    }
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <Editor />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(messages.sessionPlanning.end), {
      target: { value: "17:00" },
    });
    expect(
      screen.getByLabelText<HTMLInputElement>(messages.sessionPlanning.start)
        .value,
    ).toBe("16:15");
    fireEvent.change(screen.getByLabelText(messages.sessionPlanning.start), {
      target: { value: "18:00" },
    });
    expect(
      screen.getByLabelText<HTMLInputElement>(messages.sessionPlanning.end)
        .value,
    ).toBe("18:45");
  },
);
