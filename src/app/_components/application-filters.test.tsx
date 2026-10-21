// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  emptyApplicationFilters,
  matchesApplicationFilters,
} from "~/lib/application-filters";
import { ApplicationFilters } from "./application-filters";

const applications = [
  {
    name: "Alex Chen",
    email: "alex@example.test",
    status: "INTERVIEW",
    type: "INITIAL",
    subjectIntents: [{ subjectId: "math-ap" }],
  },
  {
    name: "Alex Lin",
    email: "lin@example.test",
    status: "ACCEPTED",
    type: "ADDITIONAL_SUBJECT",
    subjectIntents: [{ subjectId: "math-standard" }],
  },
  {
    name: "Bea Wu",
    email: "bea@example.test",
    status: "INTERVIEW",
    type: "INITIAL",
    subjectIntents: [{ subjectId: "math-standard" }],
  },
];

function Harness() {
  const [filters, setFilters] = useState(emptyApplicationFilters);
  return (
    <ApplicationFilters
      value={filters}
      onChange={setFilters}
      subjects={[
        { id: "math-ap", label: "Math · AP" },
        { id: "math-standard", label: "Math · Standard" },
      ]}
      count={
        applications.filter((row) => matchesApplicationFilters(row, filters))
          .length
      }
      total={applications.length}
    />
  );
}

afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "keeps %s filters independent, announces their combined result and resets every field",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const labels = messages.admin.applications.filters;
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <Harness />
      </NextIntlClientProvider>,
    );
    const search = screen.getByRole<HTMLInputElement>("searchbox", {
      name: labels.search,
    });
    const status = screen.getByRole<HTMLSelectElement>("combobox", {
      name: labels.status,
    });
    const type = screen.getByRole<HTMLSelectElement>("combobox", {
      name: labels.type,
    });
    const subject = screen.getByRole<HTMLSelectElement>("combobox", {
      name: labels.subject,
    });
    const reset = screen.getByRole<HTMLButtonElement>("button", {
      name: labels.reset,
    });
    const countText = (count: number) =>
      labels.count.replace("{count}", String(count)).replace("{total}", "3");
    expect(screen.getByRole("region", { name: labels.heading })).toBeTruthy();
    expect(reset.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe(countText(3));

    fireEvent.change(search, { target: { value: "Alex" } });
    expect(screen.getByRole("status").textContent).toBe(countText(2));
    fireEvent.change(status, { target: { value: "INTERVIEW" } });
    fireEvent.change(type, { target: { value: "INITIAL" } });
    fireEvent.change(subject, { target: { value: "math-ap" } });
    expect(screen.getByRole("status").textContent).toBe(countText(1));
    expect(search.value).toBe("Alex");
    expect(status.value).toBe("INTERVIEW");
    expect(type.value).toBe("INITIAL");

    // Distinct subject IDs remain distinct even when the course name matches.
    fireEvent.change(subject, { target: { value: "math-standard" } });
    expect(screen.getByRole("status").textContent).toBe(countText(0));
    fireEvent.click(reset);
    for (const control of [search, status, type, subject])
      expect(control.value).toBe("");
    expect(screen.getByRole("status").textContent).toBe(countText(3));
    expect(reset.disabled).toBe(true);
  },
);
