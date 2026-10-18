/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { QualifiedTutorSelect } from "./qualified-tutor-select";
const state = vi.hoisted(() => ({
  active: true,
  loading: false,
  error: null as Error | null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      assignmentWorkloads: {
        useQuery: () => ({
          data: { termId: "term", tutors: [] },
          refetch: vi.fn(),
        }),
      },
      subjectEligibility: {
        useQuery: () => ({
          data: [],
          isLoading: state.loading,
          error: state.error,
        }),
      },
      subjects: {
        useQuery: () => ({ data: [{ id: "math", active: state.active }] }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  state.active = true;
  state.loading = false;
  state.error = null;
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
      .getByRole("option", { name: /known.handle \(\?\)/ })
      .getAttribute("value"),
  ).toBe("handled");
  expect(
    screen
      .getByRole("option", {
        name: `${en.participantNames.unnamed} (?)`,
      })
      .getAttribute("value"),
  ).toBe("accountless");
  expect(
    screen.getByRole("option", {
      name: "Other tutor · 2 sessions (?)",
    }),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "handled" },
  });
  expect(change).toHaveBeenCalledExactlyOnceWith("handled");
  expect(tutors[0]?.englishName).toBe("  ");
});

it.each(["en", "zh"] as const)(
  "composes a feature-owned %s grid without losing native labels, guidance or retained tutors",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QualifiedTutorSelect
            className="lg:col-start-2 lg:grid-rows-subgrid"
            tutors={[{ id: "current", englishName: "Current Tutor" }]}
            subjectId="math"
            value="retained"
            retainedTutor={{ id: "retained", englishName: "Previous Tutor" }}
            onChange={() => undefined}
            label="Choose a tutor for Mathematics"
            actions={<button>Assign Mathematics</button>}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const control = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Choose a tutor for Mathematics",
    });
    const root = control.closest("label")!.parentElement!;
    expect(root.className).toContain("grid w-full min-w-0");
    expect(root.className).toContain("lg:col-start-2 lg:grid-rows-subgrid");
    expect(
      root.contains(screen.getByRole("button", { name: "Assign Mathematics" })),
    ).toBe(true);
    expect(control.value).toBe("retained");
    expect(
      screen.getByRole<HTMLOptionElement>("option", {
        name: "Previous Tutor (?)",
      }).disabled,
    ).toBe(true);
    expect(control.querySelectorAll("optgroup")).toHaveLength(2);
    for (const id of control.getAttribute("aria-describedby")!.split(" ")) {
      expect(document.getElementById(id)?.textContent).toBeTruthy();
    }
  },
);

it.each(["loading", "failed"] as const)(
  "keeps a composed selector disabled with readable guidance while qualification reads are %s",
  (readState) => {
    state.loading = readState === "loading";
    state.error = readState === "failed" ? new Error("Offline") : null;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={en}>
          <QualifiedTutorSelect
            className="lg:grid-rows-subgrid"
            tutors={[{ id: "tutor", englishName: "Tutor" }]}
            subjectId="math"
            value="tutor"
            onChange={() => undefined}
            label="Tutor"
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const control = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Tutor",
    });
    expect(control.disabled).toBe(true);
    expect(control.value).toBe("tutor");
    expect(
      screen.getByText(
        en.assignmentQualification[
          readState === "loading" ? "loading" : "loadError"
        ],
      ),
    ).toBeTruthy();
    if (readState === "failed") expect(screen.getByRole("alert")).toBeTruthy();
  },
);
