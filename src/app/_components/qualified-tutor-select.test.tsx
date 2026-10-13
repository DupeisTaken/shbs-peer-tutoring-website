/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import { QualifiedTutorSelect } from "./qualified-tutor-select";
const state = vi.hoisted(() => ({ active: true }));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      assignmentWorkloads: {
        useQuery: () => ({
          data: { termId: "term", tutors: [] },
          refetch: vi.fn(),
        }),
      },
      subjectEligibility: { useQuery: () => ({ data: [] }) },
      subjects: {
        useQuery: () => ({ data: [{ id: "math", active: state.active }] }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  state.active = true;
});
it("keeps companions on the control row with native labels, optgroups and described guidance", () => {
  const change = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        <QualifiedTutorSelect
          tutors={[{ id: "tutor", englishName: "Tutor" }]}
          subjectId="math"
          value=""
          onChange={change}
          label="Choose a tutor"
          leading={<span>Long subject label</span>}
          actions={<button>Assign</button>}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const control = screen.getByRole("combobox", { name: "Choose a tutor" });
  expect(control.getAttribute("aria-describedby")).toBeTruthy();
  expect(
    document.getElementById(
      control.getAttribute("aria-describedby")!.split(" ")[0]!,
    )?.textContent,
  ).toBeTruthy();
  expect(control.querySelectorAll("optgroup")).toHaveLength(2);
  expect(
    screen.getByText("Long subject label").parentElement?.className,
  ).toContain("lg:row-start-2");
  expect(
    screen.getByRole("button", { name: "Assign" }).parentElement?.className,
  ).toContain("lg:row-start-2");
  fireEvent.change(control, { target: { value: "tutor" } });
  expect(change).toHaveBeenCalledExactlyOnceWith("tutor");
});
it("keeps the original default field and disables inactive subjects", () => {
  state.active = false;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        <QualifiedTutorSelect
          tutors={[]}
          subjectId="math"
          value=""
          onChange={() => undefined}
          label="Tutor"
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(true);
  expect(screen.queryByRole("button")).toBeNull();
});
it("keeps blank participant options identifiable without changing assignment IDs or decorated labels", () => {
  const change = vi.fn();
  const tutors = [
    { id: "handled", englishName: "  ", username: "known.handle" },
    { id: "accountless", englishName: "" },
    { id: "decorated", englishName: "", username: "other.handle" },
  ];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        <QualifiedTutorSelect
          tutors={tutors}
          subjectId="math"
          value=""
          onChange={change}
          label="Tutor"
          optionLabel={(id) =>
            id === "decorated" ? "Other tutor · 2 sessions" : "  "
          }
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(
    screen
      .getByRole("option", { name: /known.handle — Workload unavailable/ })
      .getAttribute("value"),
  ).toBe("handled");
  expect(
    screen
      .getByRole("option", {
        name: `${en.participantNames.unnamed} — Workload unavailable`,
      })
      .getAttribute("value"),
  ).toBe("accountless");
  expect(
    screen.getByRole("option", {
      name: "Other tutor · 2 sessions — Workload unavailable",
    }),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "handled" },
  });
  expect(change).toHaveBeenCalledExactlyOnceWith("handled");
  expect(tutors[0]?.englishName).toBe("  ");
});
