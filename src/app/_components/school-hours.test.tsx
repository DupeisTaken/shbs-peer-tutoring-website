/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { RouterOutputs } from "~/trpc/react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { SchoolHoursPanel } from "./school-hours-panel";
import {
  SchoolHoursPreview,
  SchoolHoursIndividuals,
  SchoolHoursBlockers,
  ProgramSchoolHoursPreview,
} from "./school-hours-preview";
import { SchoolHoursReport } from "./school-hours-report";
import { ReadOnlyProvider } from "./read-only";

const remote = vi.hoisted(() => ({
  settings: vi.fn(),
  baselinePreview: vi.fn(),
  preview: vi.fn(),
  report: vi.fn(),
  csv: vi.fn(),
  save: vi.fn(),
  reviewBaseline: vi.fn(),
  generate: vi.fn(),
  retry: vi.fn(),
  revokeLink: vi.fn(),
  reissueLink: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => [["schoolHours"]] }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const read = (
    name: "settings" | "baselinePreview" | "preview" | "report",
  ) => ({
    useQuery: (
      input: unknown,
      options: { enabled?: boolean; retry?: boolean; staleTime?: number } = {},
    ) =>
      useQuery({
        queryKey: [["schoolHours", name], { input, type: "query" }],
        queryFn: () => remote[name](input) as Promise<unknown>,
        ...options,
      }),
  });
  return {
    api: {
      useUtils: () => ({ schoolHours: { csv: { fetch: remote.csv } } }),
      schoolHours: {
        settings: read("settings"),
        baselinePreview: read("baselinePreview"),
        preview: read("preview"),
        report: read("report"),
        ...Object.fromEntries(
          (
            [
              "save",
              "reviewBaseline",
              "generate",
              "retry",
              "revokeLink",
              "reissueLink",
            ] as const
          ).map((name) => [
            name,
            { useMutation: () => ({ mutateAsync: remote[name] }) },
          ]),
        ),
      },
    },
  };
});

type Preview = RouterOutputs["schoolHours"]["preview"];
type Basis = RouterOutputs["schoolHours"]["baselinePreview"];
type Settings = RouterOutputs["schoolHours"]["settings"];
const timestamp = new Date("2026-10-30T04:00:00Z");
const zero = { earned: 0, extras: 0, deductions: 0, crew: 0 };
const config = {
  enabled: true,
  recipientEmails: ["school@example.test"],
  timeZone: "Asia/Shanghai",
  includeStatistics: false,
  dateOverrides: {},
  version: 1,
  baselineVersion: 1,
  openingReviewedAt: timestamp,
  nextMonth: "2026-10",
  nextDueAt: timestamp,
};
const counts = {
  queued: 0,
  retrying: 0,
  sending: 0,
  sent: 0,
  failed: 1,
  skipped: 0,
  blocked: 0,
};
const summary = {
  id: "saved",
  month: "2026-10",
  revision: 1,
  generatedAt: timestamp,
  predecessorId: null,
  supersedesId: null,
  supersededById: null,
  revokedAt: null,
  linkVersion: 2,
  head: true,
  deliveryCounts: counts,
  status: "ISSUED",
};
function settings(): Settings {
  return {
    config: { ...config, recipientEmails: [...config.recipientEmails] },
    canEdit: true,
    canApply: true,
    canGenerate: true,
    serviceHoursEnabled: true,
    optionalEmailEnabled: true,
    transportAvailable: true,
    headReportId: "saved",
    recentReports: [summary],
  };
}
function row(
  name: string,
  tutoring: number,
  crew: number,
): Preview["rows"][number] {
  const amount = tutoring + crew;
  return {
    beneficiaryId: name.toLowerCase(),
    exportName: name,
    schoolAccountKey: `account-${name.toLowerCase()}`,
    nameParts: {
      firstName: name,
      lastName: null,
      preferredName: null,
      alternativeNames: null,
      legacyName: name,
      confirmed: true,
    },
    current: { ...zero, earned: tutoring, crew },
    previous: { ...zero },
    change: { ...zero, earned: tutoring, crew },
    tutoringChange: tutoring,
    crewChange: crew,
    hoursToAdd: amount,
    monthAmount: amount,
    priorEditions: [],
    previousEditionAmount: null,
    previousMonthAmount: 3,
    monthComparison: amount - 3,
    unchanged: tutoring === 0 && crew === 0,
  };
}
function preview(month = "2026-10"): Preview {
  const rows = [
    row("Alex", 6, 1),
    row("Blair", 2, 0),
    row("Casey", 1, 1),
    row("Drew", 0.5, 0),
  ];
  return {
    schemaVersion: 1,
    month,
    revision: 1,
    generatedAt: timestamp,
    timeZone: "Asia/Shanghai",
    predecessorId: "saved",
    supersedesId: null,
    configVersion: 1,
    baselineVersion: 1,
    expectedHeadId: "saved",
    contentHash: "a".repeat(64),
    rows,
    totals: {
      people: 4,
      tutoringChange: 9.5,
      crewChange: 2,
      hoursToAdd: 11.5,
      monthAmount: 11.5,
    },
    blockers: [],
    includeStatistics: false,
    email: {
      subject: "The Program October Report is ready",
      html: '<p>Alex &lt;img src=x onerror=alert(1)&gt;</p><span aria-disabled="true">View Month Report (preview only)</span>',
      text: "Alex <img src=x onerror=alert(1)>: +7\nView Month Report (preview only)",
    },
  };
}
function basis(needsReview = false): Basis {
  return {
    contentHash: "b".repeat(64),
    baselineVersion: 1,
    headReportId: "saved",
    blockers: [],
    participants: [
      {
        beneficiaryId: "alex",
        exportName: "Alex",
        schoolAccountKey: needsReview ? null : "account-alex",
        current: { ...zero, earned: 6, crew: 1 },
        alreadyReported: needsReview ? null : { ...zero },
        needsReview,
        sourceCount: 2,
      },
    ],
  };
}
function report(): RouterOutputs["schoolHours"]["report"] {
  const snapshot = preview();
  return {
    ...snapshot,
    id: "saved",
    reason: null,
    linkVersion: 2,
    revokedAt: null,
    supersededById: null,
    linkUrl:
      "https://school.example.test/reports/service-hours/synthetic-token",
    deliveries: [
      {
        id: "delivery",
        recipient: "school@example.test",
        status: "FAILED",
        attempts: 1,
        lastError: "Safe diagnostic",
        completedAt: null,
        availableAt: timestamp,
      },
    ],
  };
}
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  remote.settings.mockResolvedValue(settings());
  remote.baselinePreview.mockResolvedValue(basis());
  remote.preview.mockImplementation(({ month }: { month: string }) =>
    Promise.resolve(preview(month)),
  );
  remote.report.mockResolvedValue(report());
  remote.csv.mockResolvedValue({
    filename: "school.csv",
    content: "Alex,0.016666666666666666",
  });
  remote.save.mockResolvedValue({ config: { ...config, version: 2 } });
  remote.reviewBaseline.mockResolvedValue({ baselineVersion: 2 });
  remote.generate.mockResolvedValue({
    reportId: "new",
    revision: 1,
    queued: 1,
  });
  remote.retry.mockResolvedValue({ queued: 1 });
  remote.revokeLink.mockResolvedValue({ revoked: true });
  remote.reissueLink.mockResolvedValue({
    linkVersion: 3,
    url: "https://school.example.test/new-link",
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function show(
  element: ReactNode = <SchoolHoursPanel />,
  locale: "en" | "zh" = "en",
  readOnly = false,
) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="Asia/Shanghai"
      >
        <ReadOnlyProvider value={readOnly}>{element}</ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
async function openDisclosure(text: string) {
  const summary = screen
    .getAllByText(text)
    .find((node) => node.tagName === "SUMMARY")!;
  const details = summary.closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await act(async () => {
    await Promise.resolve();
  });
}
async function openPanel() {
  await screen.findByText(new RegExp(`${en.schoolHours.title} ·`));
  const details = document.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByLabelText(en.schoolHours.enable);
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.schoolHours.preview,
      }).disabled,
    ).toBe(false),
  );
}
async function openBaseline() {
  const summary = await screen.findByText(
    new RegExp(`${en.schoolHours.baselineTitle} ·`),
  );
  await openDisclosure(summary.textContent);
}
async function loadPreview(month = "2026-10") {
  fireEvent.change(screen.getByLabelText(en.schoolHours.reportMonth), {
    target: { value: month },
  });
  fireEvent.click(screen.getByRole("button", { name: en.schoolHours.preview }));
  return screen.findByRole("table", { name: en.schoolHours.individualAmounts });
}
async function confirm(label: string) {
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
}
async function refreshSettings() {
  await act(async () => {
    await client.refetchQueries({ queryKey: [["schoolHours", "settings"]] });
  });
}

it.each(["en", "zh"] as const)(
  "shows individual account instructions without double-counting tutoring/Crew or leading with program totals (%s)",
  (locale) => {
    const copy = locale === "zh" ? zh.schoolHours : en.schoolHours;
    const view = render(
      show(
        <SchoolHoursIndividuals
          rows={preview().rows}
          revision={1}
          includeStatistics
        />,
        locale,
      ),
    );
    const table = screen.getByRole("table", { name: copy.individualAmounts });
    for (const [name, amount, tutoring, crew] of [
      ["Alex", "+7", "+6", "+1"],
      ["Blair", "+2", "+2", "0"],
      ["Casey", "+2", "+1", "+1"],
      ["Drew", "+0.5", "+0.5", "0"],
    ]) {
      const cells = within(
        within(table).getByText(name!).closest("tr")!,
      ).getAllByRole("cell");
      expect(cells.slice(1, 4).map((cell) => cell.textContent)).toEqual([
        amount,
        tutoring,
        crew,
      ]);
    }
    expect(view.container.textContent).not.toContain("11.5");
    expect(screen.getByText(copy.statistics).closest("details")!.open).toBe(
      false,
    );
    expect(screen.getByText(copy.applyInstructions)).toBeTruthy();
  },
);

it.each(["en", "zh"] as const)(
  "keeps the full person, exact amount, tutoring/Crew and evidence together in mobile cards (%s)",
  (locale) => {
    const copy = locale === "zh" ? zh.schoolHours : en.schoolHours;
    const person = {
      ...row('Alexandra "Alex" Anderson (艾力克斯)', 0.5, 0.25),
      schoolAccountKey: "SCHOOL-ACCOUNT-0123456789",
      change: { earned: 1, extras: 0.25, deductions: 0.75, crew: 0.25 },
    };
    render(
      show(
        <SchoolHoursIndividuals
          rows={[person, row("Fraction", -1 / 60, 0), row("NoChange", 0, 0)]}
          revision={1}
        />,
        locale,
      ),
    );
    const list = screen.getByRole("list", { name: copy.individualAmounts });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    const card = cards[0]!;
    expect(within(card).getByText(person.exportName)).toBeTruthy();
    expect(
      within(card).getByText(
        `${copy.schoolAccount}: ${person.schoolAccountKey}`,
      ),
    ).toBeTruthy();
    for (const [label, value] of [
      [copy.amountToApply, "+0.75"],
      [copy.tutoring, "+0.5"],
      [copy.crew, "+0.25"],
    ]) {
      expect(
        within(card).getByText(label!).nextElementSibling?.textContent,
      ).toBe(value);
    }
    expect(
      within(cards[1]!).getByText(copy.amountToApply).nextElementSibling
        ?.textContent,
    ).toBe(
      copy.approximateHours.replace("{hours}", "-0.0167") +
        copy.exactHours.replace("{hours}", "-0.016666666666666666"),
    );
    expect(within(list).queryByText("NoChange")).toBeNull();
    fireEvent.click(within(card).getByRole("button"));
    const dialog = screen.getByRole("dialog", { name: person.exportName });
    for (const [label, value] of [
      [copy.schoolAccount, person.schoolAccountKey],
      [copy.earnedChange, "+1"],
      [copy.extrasChange, "+0.25"],
      [copy.deductionsChange, "+0.75"],
      [copy.crewChange, "+0.25"],
      [copy.amountToApply, "+0.75"],
    ]) {
      expect(
        within(dialog).getByText(label!).nextElementSibling?.textContent,
      ).toBe(value);
    }
  },
);

it.each(["en", "zh"] as const)(
  "keeps exact posting values visible beside approximate summaries without evidence controls (%s)",
  (locale) => {
    const copy = locale === "zh" ? zh.schoolHours : en.schoolHours;
    render(
      show(
        <SchoolHoursIndividuals
          rows={[
            row("Alex", 1.7500000000000002, 0),
            row("Iris", 3.5833333333333335, 0.5),
            row("Tiny", -1e-16, 0),
          ]}
          revision={1}
          showEvidence={false}
        />,
        locale,
      ),
    );
    for (const role of ["list", "table"]) {
      const individuals = within(
        screen.getByRole(role, { name: copy.individualAmounts }),
      );
      for (const [approximate, exact] of [
        ["+1.75", "+1.7500000000000002"],
        ["+4.0833", "+4.083333333333334"],
      ] as const) {
        expect(
          individuals.getAllByText(
            copy.approximateHours.replace("{hours}", approximate),
          ).length,
        ).toBeGreaterThan(0);
        expect(
          individuals.getAllByText(copy.exactHours.replace("{hours}", exact))
            .length,
        ).toBeGreaterThan(0);
      }
      expect(individuals.getAllByText("-1e-16")).toHaveLength(2);
      expect(
        individuals.queryByText(copy.approximateHours.replace("{hours}", "0")),
      ).toBeNull();
      // Sorting remains available; only private evidence controls are omitted.
      expect(
        individuals.queryByRole("button", { name: /View details:|查看详情:/ }),
      ).toBeNull();
    }
  },
);

it("labels blockers by their explicit participant identity and retains a safe fallback when unavailable", () => {
  render(
    show(
      <SchoolHoursBlockers
        blockers={[
          {
            code: "OWNER_MISSING",
            message: "Missing owner",
            beneficiaryId: "user:known",
          },
          {
            code: "OWNER_MISSING",
            message: "Missing owner",
            beneficiaryId: "user:unavailable",
          },
          {
            code: "OWNER_MISSING",
            message: "Missing owner",
            beneficiaryId: "user:blank",
          },
        ]}
        participants={[
          {
            beneficiaryId: "user:known",
            exportName: 'Alexander "Alex" Chen (陈安)',
          },
          { beneficiaryId: "user:blank", exportName: " " },
        ]}
      />,
    ),
  );
  expect(screen.getByText('Alexander "Alex" Chen (陈安)')).toBeTruthy();
  expect(screen.queryByText("user:known")).toBeNull();
  expect(screen.getByText("user:unavailable")).toBeTruthy();
  expect(screen.getByText("user:blank")).toBeTruthy();
});

it("uses preview participants for blocker labels without requiring a baseline query", () => {
  const snapshot = preview();
  snapshot.blockers = [
    {
      code: "OWNER_MISSING",
      message: "Missing owner",
      beneficiaryId: snapshot.rows[0]!.beneficiaryId,
    },
  ];
  render(show(<SchoolHoursPreview preview={snapshot} />));
  expect(
    screen.getByText(en.schoolHours.blockers.OWNER_MISSING).closest("li")!
      .textContent,
  ).toContain(snapshot.rows[0]!.exportName);
  expect(remote.baselinePreview).not.toHaveBeenCalled();
});

it("omits private evidence controls from both mobile cards and the desktop report when disabled", () => {
  render(
    show(
      <SchoolHoursIndividuals
        rows={[row("Alex", 0.5, 0.25)]}
        revision={1}
        showEvidence={false}
      />,
    ),
  );
  for (const role of ["list", "table"]) {
    const individuals = screen.getByRole(role, {
      name: en.schoolHours.individualAmounts,
    });
    expect(within(individuals).getByText("Alex")).toBeTruthy();
    expect(
      within(individuals).queryByRole("button", { name: /Alex/ }),
    ).toBeNull();
  }
});

it("preserves offsetting and fractional component changes while filtering only truly unchanged normal rows", () => {
  const offset = {
    ...row("Offset", 1, -1),
    current: { ...zero, earned: 1 },
    change: { ...zero, earned: 1, crew: -1 },
    unchanged: false,
  };
  const fraction = row("Fraction", -1 / 60, 0);
  render(
    show(
      <SchoolHoursIndividuals
        rows={[offset, fraction, row("NoChange", 0, 0)]}
        revision={1}
      />,
    ),
  );
  const table = screen.getByRole("table");
  expect(within(table).getByText("Offset")).toBeTruthy();
  expect(
    within(table).getAllByText(
      en.schoolHours.exactHours.replace("{hours}", "-0.016666666666666666"),
    ),
  ).toHaveLength(2);
  expect(within(table).queryByText("NoChange")).toBeNull();
  expect(screen.queryByText(en.schoolHours.noChanges)).toBeNull();
});

it("distinguishes revision corrections from the corrected full month and keeps unchanged revision rows", async () => {
  const corrected = {
    ...row("Alex", 0.5, 0),
    monthAmount: 7.5,
    previousEditionAmount: 7,
    previousMonthAmount: 10,
    monthComparison: -2.5,
  };
  const unchanged = {
    ...row("Blair", 0, 0),
    monthAmount: 2,
    previousEditionAmount: 2,
  };
  render(
    show(<SchoolHoursIndividuals rows={[corrected, unchanged]} revision={2} />),
  );
  const table = screen.getByRole("table", {
    name: en.schoolHours.individualAmounts,
  });
  expect(within(table).getAllByText("+0.5")).toHaveLength(2);
  expect(
    within(table).getByText(
      en.schoolHours.correctedMonth.replace("{hours}", "+7.5"),
    ),
  ).toBeTruthy();
  expect(within(table).getByText(en.schoolHours.unchanged)).toBeTruthy();
  const cards = screen.getByRole("list", {
    name: en.schoolHours.individualAmounts,
  });
  expect(within(cards).getByText(en.schoolHours.unchanged)).toBeTruthy();
  expect(
    within(cards).getByText(
      en.schoolHours.correctedMonth.replace("{hours}", "+7.5"),
    ),
  ).toBeTruthy();
  expect(screen.getByText(en.schoolHours.revisionInstructions)).toBeTruthy();
  await openDisclosure(en.schoolHours.comparisons);
  const comparison = screen.getByRole("table", {
    name: en.schoolHours.comparisons,
  });
  expect(within(comparison).getByText("-2.5")).toBeTruthy();
  expect(screen.getByText(en.schoolHours.comparisonHelp)).toBeTruthy();
});

it("lets each individual choose exactly one correction when an intermediate revision was missed", async () => {
  const alex = {
    ...row("Alex", 0.2, 0),
    monthAmount: 7.7,
    previousEditionAmount: 7.5,
    priorEditions: [
      { revision: 1, monthAmount: 7, correctionToCurrent: 0.7 },
      { revision: 2, monthAmount: 7.5, correctionToCurrent: 0.2 },
    ],
  };
  render(show(<SchoolHoursIndividuals rows={[alex]} revision={3} />));
  const table = screen.getByRole("table", {
    name: en.schoolHours.individualAmounts,
  });
  expect(
    within(table).getByText(
      en.schoolHours.priorEditionCorrection
        .replace("{revision}", "2")
        .replace("{hours}", "+0.2"),
    ),
  ).toBeTruthy();
  await openDisclosure(en.schoolHours.comparisons);
  await openDisclosure("Alex");
  expect(screen.getByText(en.schoolHours.priorEditionHelp)).toBeTruthy();
  expect(
    screen.getByText(
      en.schoolHours.priorEditionCorrection
        .replace("{revision}", "1")
        .replace("{hours}", "+0.7"),
    ),
  ).toBeTruthy();
  const correctedMonthDisclosure = screen
    .getByText(en.schoolHours.priorEditionHelp)
    .closest("details")!;
  expect(
    within(correctedMonthDisclosure).getByText(
      en.schoolHours.correctedMonth.replace("{hours}", "+7.7"),
    ),
  ).toBeTruthy();
  expect(remote.generate).not.toHaveBeenCalled();
});

it("isolates exact escaped email HTML, supports manual tabs, and performs no writes", () => {
  const snapshot = preview();
  const view = render(show(<SchoolHoursPreview preview={snapshot} />));
  const reportTab = screen.getByRole("tab", {
    name: en.schoolHours.schoolReport,
  });
  reportTab.focus();
  fireEvent.keyDown(reportTab, { key: "ArrowRight" });
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: en.schoolHours.emailHtml }),
  );
  expect(reportTab.getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: en.schoolHours.emailHtml }));
  const frame = screen.getByTitle<HTMLIFrameElement>(
    en.schoolHours.emailPreview,
  );
  expect(frame.getAttribute("sandbox")).toBe("");
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(frame.getAttribute("srcdoc")).toBe(snapshot.email.html);
  const parsed = new DOMParser().parseFromString(frame.srcdoc, "text/html");
  expect(parsed.querySelectorAll("a[href],img,script")).toHaveLength(0);
  fireEvent.click(screen.getByRole("tab", { name: en.schoolHours.plainText }));
  expect(view.container.querySelector("pre")!.textContent).toBe(
    snapshot.email.text,
  );
  expect(view.container.querySelector("img")).toBeNull();
  for (const name of [
    "save",
    "reviewBaseline",
    "generate",
    "retry",
    "revokeLink",
    "reissueLink",
  ] as const)
    expect(remote[name]).not.toHaveBeenCalled();
});

it("keeps Communication preview lazy and read-only, handles month changes and denies late private results", async () => {
  let complete: (value: Preview) => void = () => undefined;
  remote.preview.mockImplementationOnce(
    () =>
      new Promise<Preview>((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(show(<ProgramSchoolHoursPreview />));
  expect(remote.settings).not.toHaveBeenCalled();
  await openDisclosure(en.schoolHours.emailPreview);
  await screen.findByLabelText(en.schoolHours.reportMonth);
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.schoolHours.preview,
      }).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText(en.schoolHours.reportMonth), {
    target: { value: "2026-09" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.schoolHours.preview }));
  await waitFor(() => expect(remote.preview).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText(en.schoolHours.reportMonth), {
    target: { value: "2026-10" },
  });
  await act(async () => {
    complete(preview("2026-09"));
  });
  expect(screen.queryByRole("table")).toBeNull();
  await loadPreview();
  view.rerender(show(<ProgramSchoolHoursPreview denied />));
  await screen.findByText(en.schoolHours.denied);
  expect(screen.queryByText("Alex")).toBeNull();
  expect(
    client.getQueryData([
      ["schoolHours", "preview"],
      { input: { month: "2026-10" }, type: "query" },
    ]),
  ).toBeUndefined();
  expect(remote.generate).not.toHaveBeenCalled();
});

it("mounts no school reads for read-only viewers and labels feature-disabled preview", async () => {
  const view = render(
    show(
      <>
        <SchoolHoursPanel />
        <ProgramSchoolHoursPreview />
        <SchoolHoursReport id="saved" />
      </>,
      "en",
      true,
    ),
  );
  expect(remote.settings).not.toHaveBeenCalled();
  expect(remote.report).not.toHaveBeenCalled();
  view.unmount();
  remote.settings.mockResolvedValue({
    ...settings(),
    serviceHoursEnabled: false,
  });
  render(show(<ProgramSchoolHoursPreview />));
  await openDisclosure(en.schoolHours.emailPreview);
  await screen.findByText(en.schoolHours.featureOff);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolHours.preview,
    }).disabled,
  ).toBe(true);
  expect(remote.preview).not.toHaveBeenCalled();
});

it("defaults to the current local month, independently of accounting-month closure or roster filters", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T10:30:00Z"));
  remote.settings.mockResolvedValue({
    ...settings(),
    config: { ...config, timeZone: "Pacific/Kiritimati" },
  });
  render(show());
  await openPanel();
  expect(
    screen.getByLabelText<HTMLInputElement>(en.schoolHours.reportMonth).value,
  ).toBe("2026-11");
  expect(
    screen.getByLabelText<HTMLInputElement>(en.schoolHours.reportMonth).max,
  ).toBe("");
  expect(screen.queryByText(en.monthlyHours.title)).toBeNull();
});

it("requires explicit per-person mapping and all opening values, then preserves them on rejected review", async () => {
  remote.baselinePreview.mockResolvedValue(basis(true));
  remote.reviewBaseline.mockRejectedValue(new Error("Conflict"));
  render(show());
  await openPanel();
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.schoolHours.reviewPerson}: Alex`,
    }),
  );
  const person = screen.getByRole("dialog", { name: "Alex" });
  for (const label of ["earned", "extras", "deductions", "crew"] as const)
    expect(
      within(person).getByLabelText<HTMLInputElement>(en.schoolHours[label])
        .value,
    ).toBe("");
  fireEvent.change(
    within(person).getByLabelText(en.schoolHours.schoolAccount),
    { target: { value: "school-Alex" } },
  );
  fireEvent.click(
    within(person).getByLabelText(en.schoolHours.personAcknowledgement),
  );
  fireEvent.change(within(person).getByLabelText(en.schoolHours.earned), {
    target: { value: "4" },
  });
  fireEvent.change(within(person).getByLabelText(en.schoolHours.extras), {
    target: { value: "0" },
  });
  fireEvent.change(within(person).getByLabelText(en.schoolHours.deductions), {
    target: { value: "0" },
  });
  fireEvent.click(
    within(person).getByRole("button", { name: en.tablePatterns.close }),
  );
  fireEvent.change(screen.getByLabelText(en.schoolHours.baselineReason), {
    target: { value: "Compared with school records" },
  });
  fireEvent.click(
    screen.getByLabelText(en.schoolHours.baselineAcknowledgement),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolHours.confirmBaseline,
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.schoolHours.reviewPerson}: Alex`,
    }),
  );
  fireEvent.change(screen.getByLabelText(en.schoolHours.crew), {
    target: { value: "0" },
  });
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Alex" })).getByRole("button", {
      name: en.tablePatterns.close,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.confirmBaseline }),
  );
  expect(remote.reviewBaseline).not.toHaveBeenCalled();
  await confirm(en.schoolHours.confirmBaseline);
  await waitFor(() =>
    expect(remote.reviewBaseline).toHaveBeenCalledWith({
      expectedContentHash: "b".repeat(64),
      expectedBaselineVersion: 1,
      reason: "Compared with school records",
      acknowledged: true,
      participants: [
        {
          beneficiaryId: "alex",
          schoolAccountKey: "school-Alex",
          earned: 4,
          extras: 0,
          deductions: 0,
          crew: 0,
          reviewed: true,
        },
      ],
    }),
  );
  await screen.findByText(en.schoolHours.writeFailed);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.schoolHours.baselineReason)
      .value,
  ).toBe("Compared with school records");
});

it("surfaces identity blockers and invalidates a review when source evidence changes", async () => {
  remote.baselinePreview.mockResolvedValue({
    ...basis(true),
    blockers: [
      {
        code: "OWNER_MISSING",
        message: "Missing owner",
        beneficiaryId: "alex",
      },
    ],
  });
  render(show());
  await openPanel();
  expect(screen.getByText(en.schoolHours.blockers.OWNER_MISSING)).toBeTruthy();
  expect(
    screen.getByText(en.schoolHours.blockers.OWNER_MISSING).closest("li")!
      .textContent,
  ).toContain("Alex");
  expect(screen.queryByText("alex")).toBeNull();
  remote.baselinePreview.mockResolvedValue({
    ...basis(true),
    contentHash: "c".repeat(64),
  });
  await act(async () => {
    await client.refetchQueries({
      queryKey: [["schoolHours", "baselinePreview"]],
    });
  });
  await screen.findByText(en.schoolHours.staleBaseline);
  expect(
    screen
      .getByLabelText<HTMLTextAreaElement>(en.schoolHours.baselineReason)
      .matches(":disabled"),
  ).toBe(true);
  expect(remote.reviewBaseline).not.toHaveBeenCalled();
});

it("allows a reviewed opening balance to be corrected before the first issue using only recorded opening values", async () => {
  const opening = {
    ...basis(),
    headReportId: null,
    participants: [
      {
        ...basis().participants[0]!,
        current: { ...zero, earned: 28.041666666666668 },
        alreadyReported: {
          earned: 1.7500000000000002,
          extras: 1,
          deductions: 0.5,
          crew: 0.25,
        },
      },
    ],
  };
  remote.baselinePreview.mockResolvedValue(opening);
  render(show());
  await openPanel();
  const sourceSummary = en.schoolHours.approximateHours.replace(
    "{hours}",
    "28.0417",
  );
  const sourceExact = en.schoolHours.exactHours.replace(
    "{hours}",
    "28.041666666666668",
  );
  expect(screen.getByTitle(sourceExact).textContent).toBe(
    `${sourceSummary}; ${sourceExact}`,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: `${en.schoolHours.reviewPerson}: Alex`,
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Alex" });
  for (const [key, value] of [
    ["earned", "1.7500000000000002"],
    ["extras", "1"],
    ["deductions", "0.5"],
    ["crew", "0.25"],
  ] as const)
    expect(
      within(dialog).getByLabelText<HTMLInputElement>(en.schoolHours[key])
        .value,
    ).toBe(value);
  expect(
    within(dialog).getByLabelText<HTMLInputElement>(
      en.schoolHours.personAcknowledgement,
    ).checked,
  ).toBe(false);
  expect(within(dialog).getAllByText("28.041666666666668")).toHaveLength(2);
  expect(
    within(dialog).getByLabelText(en.schoolHours.earned).getAttribute("step"),
  ).toBe("any");
  fireEvent.change(within(dialog).getByLabelText(en.schoolHours.earned), {
    target: { value: "3.5833333333333335" },
  });
  fireEvent.change(
    within(dialog).getByLabelText(en.schoolHours.schoolAccount),
    { target: { value: "corrected-account" } },
  );
  fireEvent.click(
    within(dialog).getByLabelText(en.schoolHours.personAcknowledgement),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.tablePatterns.close }),
  );
  fireEvent.change(screen.getByLabelText(en.schoolHours.baselineReason), {
    target: { value: "Verified revised school records before first issue" },
  });
  fireEvent.click(
    screen.getByLabelText(en.schoolHours.baselineAcknowledgement),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.confirmBaseline }),
  );
  await confirm(en.schoolHours.confirmBaseline);
  await waitFor(() =>
    expect(remote.reviewBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedContentHash: opening.contentHash,
        participants: [
          {
            beneficiaryId: "alex",
            schoolAccountKey: "corrected-account",
            earned: 3.5833333333333335,
            extras: 1,
            deductions: 0.5,
            crew: 0.25,
            reviewed: true,
          },
        ],
      }),
    ),
  );
});

it.each(["en", "zh"] as const)(
  "condenses committed opening balances before recurring report controls (%s)",
  async (locale) => {
    const copy = locale === "zh" ? zh.schoolHours : en.schoolHours;
    render(show(<SchoolHoursPanel />, locale));
    const heading = await screen.findByText(new RegExp(`${copy.title} ·`));
    await openDisclosure(heading.textContent);
    const summary = await screen.findByText(
      new RegExp(`${copy.baselineTitle} ·`),
    );
    expect(summary.closest("details")!.open).toBe(false);
    expect(summary.textContent).toContain(
      copy.baselineSummary.replace("{review}", "0").replace("{committed}", "1"),
    );
    expect(
      screen.queryByRole("table", { name: copy.baselineTitle }),
    ).toBeNull();
    expect(screen.getByLabelText(copy.recipients)).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.preview })).toBeTruthy();
    await openDisclosure(summary.textContent);
    expect(
      screen.getByRole("table", { name: copy.baselineTitle }),
    ).toBeTruthy();
    expect(remote.reviewBaseline).not.toHaveBeenCalled();
  },
);

it.each(["unreviewed", "first issue", "blocker"] as const)(
  "opens opening balances when attention is needed (%s)",
  async (state) => {
    const opening = basis(state === "unreviewed");
    if (state === "first issue") opening.headReportId = null;
    if (state === "blocker")
      opening.blockers = [
        {
          code: "OWNER_MISSING",
          message: "Missing owner",
          beneficiaryId: "alex",
        },
      ];
    remote.baselinePreview.mockResolvedValue(opening);
    render(show());
    await openPanel();
    const summary = await screen.findByText(
      new RegExp(`${en.schoolHours.baselineTitle} ·`),
    );
    expect(summary.closest("details")!.open).toBe(true);
    expect(
      screen.getByRole("table", { name: en.schoolHours.baselineTitle }),
    ).toBeTruthy();
    if (state === "blocker")
      expect(summary.textContent).toContain(
        en.schoolHours.baselineIssues.replace("{count}", "1"),
      );
  },
);

it("retains an opening-review draft when its disclosure is collapsed and reopened", async () => {
  remote.baselinePreview.mockResolvedValue(basis(true));
  render(show());
  await openPanel();
  fireEvent.change(screen.getByLabelText(en.schoolHours.baselineReason), {
    target: { value: "Checked original school records" },
  });
  const summary = screen.getByText(
    new RegExp(`${en.schoolHours.baselineTitle} ·`),
  );
  const disclosure = summary.closest("details")!;
  disclosure.open = false;
  fireEvent(disclosure, new Event("toggle"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(disclosure.open).toBe(false);
  await openDisclosure(summary.textContent);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.schoolHours.baselineReason)
      .value,
  ).toBe("Checked original school records");
  expect(remote.reviewBaseline).not.toHaveBeenCalled();
});

it("keeps committed opening values immutable after the first issue", async () => {
  render(show());
  await openPanel();
  await openBaseline();
  expect(
    screen.queryByRole("button", {
      name: `${en.schoolHours.reviewPerson}: Alex`,
    }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: `${en.schoolHours.details}: Alex` }),
  );
  expect(
    within(screen.getByRole("dialog", { name: "Alex" })).queryByRole(
      "spinbutton",
    ),
  ).toBeNull();
  expect(remote.reviewBaseline).not.toHaveBeenCalled();
});

it("retains drafts and submits external recipients and local date overrides only after confirmation", async () => {
  render(show());
  await openPanel();
  await loadPreview();
  fireEvent.change(screen.getByLabelText(en.schoolHours.recipients), {
    target: {
      value: "office@example.test\nsecond@example.test\noffice@example.test",
    },
  });
  expect(
    screen.queryByRole("table", { name: en.schoolHours.individualAmounts }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText(en.schoolHours.overrideMonth), {
    target: { value: "2026-10" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.addOverride }),
  );
  const override = screen.getByLabelText<HTMLInputElement>(
    en.schoolHours.overrideFor.replace("{month}", "2026-10"),
  );
  expect(override.value).toBe("2026-10-31T12:00");
  fireEvent.change(override, { target: { value: "2026-10-30T13:15" } });
  fireEvent.click(screen.getByRole("button", { name: en.schoolHours.save }));
  expect(remote.save).not.toHaveBeenCalled();
  await confirm(en.schoolHours.save);
  await waitFor(() =>
    expect(remote.save).toHaveBeenCalledWith({
      enabled: true,
      recipientEmails: ["office@example.test", "second@example.test"],
      timeZone: "Asia/Shanghai",
      includeStatistics: false,
      dateOverrides: { "2026-10": "2026-10-30T13:15" },
      expectedVersion: 1,
    }),
  );
  expect(remote.generate).not.toHaveBeenCalled();
});

it("limits Coordinators to proposals, excluding baseline confirmation and generation", async () => {
  remote.settings.mockResolvedValue({
    ...settings(),
    canApply: false,
    canGenerate: false,
  });
  remote.baselinePreview.mockResolvedValue(basis(true));
  render(show());
  await openPanel();
  await loadPreview();
  expect(screen.getByText(en.schoolHours.adminReviewRequired)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.schoolHours.confirmBaseline }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.schoolHours.issue }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText(en.schoolHours.recipients), {
    target: { value: "office@example.test" },
  });
  expect(
    screen.getByRole("button", { name: en.schoolHours.requestSave }),
  ).toBeTruthy();
});

it("rejects an override outside its labelled month without a mutation or review", async () => {
  render(show());
  await openPanel();
  fireEvent.change(screen.getByLabelText(en.schoolHours.overrideMonth), {
    target: { value: "2026-11" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.addOverride }),
  );
  fireEvent.change(
    screen.getByLabelText(
      en.schoolHours.overrideFor.replace("{month}", "2026-11"),
    ),
    { target: { value: "2026-10-29T12:00" } },
  );
  // Exercise the domain-facing guard too, independent of native min/max validation.
  fireEvent.submit(
    screen.getByRole("button", { name: en.schoolHours.save }).closest("form")!,
  );
  await screen.findByText(en.schoolHours.invalidSchedule);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(remote.save).not.toHaveBeenCalled();
});

it("issues the reviewed hash/head/baseline once and treats refresh failure as read-only recovery", async () => {
  render(show());
  await openPanel();
  await loadPreview();
  fireEvent.click(screen.getByRole("button", { name: en.schoolHours.issue }));
  const dialog = await screen.findByRole("dialog");
  remote.settings.mockRejectedValue(new Error("Read unavailable"));
  const confirmButton = within(dialog).getByRole("button", {
    name: en.schoolHours.confirmIssue,
  });
  fireEvent.click(confirmButton);
  fireEvent.click(confirmButton);
  await waitFor(() => expect(remote.generate).toHaveBeenCalledTimes(1));
  expect(remote.generate).toHaveBeenCalledWith({
    month: "2026-10",
    expectedVersion: 1,
    expectedBaselineVersion: 1,
    expectedHeadId: "saved",
    expectedContentHash: "a".repeat(64),
    requestId: expect.any(String) as unknown,
  });
  await screen.findByText(en.actionReview.refreshFailed);
  remote.settings.mockResolvedValue(settings());
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.actionReview.retry,
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.actionReview.refreshFailed)).toBeNull(),
  );
  expect(remote.generate).toHaveBeenCalledTimes(1);
});

it("requires a correction reason and invalidates a preview after baseline/config changes", async () => {
  remote.preview.mockResolvedValue({ ...preview(), revision: 2 });
  render(show());
  await openPanel();
  await loadPreview();
  const revise = screen.getByRole<HTMLButtonElement>("button", {
    name: en.schoolHours.revise,
  });
  expect(revise.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(en.schoolHours.revisionReason), {
    target: { value: "Late attendance" },
  });
  expect(revise.disabled).toBe(false);
  remote.settings.mockResolvedValue({
    ...settings(),
    config: { ...config, baselineVersion: 2 },
  });
  await refreshSettings();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: en.schoolHours.revise }),
    ).toBeNull(),
  );
  expect(remote.generate).not.toHaveBeenCalled();
});

it.each(["panel", "communication"] as const)(
  "hides a preview when the committed head changes without any version change (%s)",
  async (place) => {
    render(
      show(
        place === "panel" ? (
          <SchoolHoursPanel />
        ) : (
          <ProgramSchoolHoursPreview />
        ),
      ),
    );
    if (place === "panel") await openPanel();
    else {
      await openDisclosure(en.schoolHours.emailPreview);
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>("button", {
            name: en.schoolHours.preview,
          }).disabled,
        ).toBe(false),
      );
    }
    await loadPreview();
    remote.settings.mockResolvedValue({
      ...settings(),
      headReportId: "another-issued-report",
    });
    await refreshSettings();
    await waitFor(() =>
      expect(
        screen.queryByRole("table", { name: en.schoolHours.individualAmounts }),
      ).toBeNull(),
    );
    expect(remote.generate).not.toHaveBeenCalled();
  },
);

it.each(["revoked", "disabled", "superseded"] as const)(
  "prevents known-unsendable history retries (%s)",
  async (state) => {
    remote.settings.mockResolvedValue({
      ...settings(),
      config: { ...config, enabled: state !== "disabled" },
      recentReports: [
        {
          ...summary,
          revokedAt: state === "revoked" ? timestamp : null,
          supersededById: state === "superseded" ? "newer" : null,
        },
      ],
    });
    render(show());
    await openPanel();
    const button = screen.queryByRole<HTMLButtonElement>("button", {
      name: en.schoolHours.retryDelivery,
    });
    if (state === "superseded") expect(button).toBeNull();
    else expect(button!.disabled).toBe(true);
    expect(remote.retry).not.toHaveBeenCalled();
  },
);

it("copies an absolute external report link when the staff API supplies a relative route", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  remote.report.mockResolvedValue({
    ...report(),
    linkUrl: "/reports/service-hours/synthetic-token",
  });
  render(show(<SchoolHoursReport id="saved" />));
  await screen.findByRole("button", { name: en.schoolHours.copyLink });
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.copyLink }),
  );
  await waitFor(() =>
    expect(copy).toHaveBeenCalledWith(
      new URL("/reports/service-hours/synthetic-token", window.location.origin)
        .href,
    ),
  );
  await screen.findByText(en.schoolHours.copied);
});

it("uses the guarded current link version when revoking the saved edition", async () => {
  render(show(<SchoolHoursReport id="saved" />));
  await screen.findByRole("table", { name: en.schoolHours.individualAmounts });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.schoolHours.revokeLink,
      }).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.revokeLink }),
  );
  await confirm(en.schoolHours.revokeLink);
  await waitFor(() =>
    expect(remote.revokeLink).toHaveBeenCalledWith({
      id: "saved",
      expectedLinkVersion: 2,
    }),
  );
  expect(remote.generate).not.toHaveBeenCalled();
});

it("reissues a guarded link and allows deliberate delivery retry after refreshed failure without duplicate admission", async () => {
  render(show(<SchoolHoursReport id="saved" />));
  await screen.findByRole("table", { name: en.schoolHours.individualAmounts });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.schoolHours.reissueLink,
      }).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.reissueLink }),
  );
  await confirm(en.schoolHours.reissueLink);
  await waitFor(() =>
    expect(remote.reissueLink).toHaveBeenCalledWith({
      id: "saved",
      expectedLinkVersion: 2,
    }),
  );
  await screen.findByText(en.actionReview.applied);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.actionReview.close,
    }),
  );
  for (const count of [1, 2]) {
    fireEvent.click(
      screen.getByRole("button", { name: en.schoolHours.retryDelivery }),
    );
    const dialog = await screen.findByRole("dialog");
    const button = within(dialog).getByRole("button", {
      name: en.schoolHours.retryDelivery,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(remote.retry).toHaveBeenCalledTimes(count));
    await screen.findByText(en.schoolHours.retryQueued);
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.actionReview.close }),
    );
  }
  expect(remote.retry).toHaveBeenLastCalledWith({ id: "saved" });
  expect(remote.generate).not.toHaveBeenCalled();
});

it("hides saved data and drops a late CSV after a staff permission denial", async () => {
  let complete: (value: { filename: string; content: string }) => void = () =>
    undefined;
  remote.csv.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const create = vi.fn(() => "blob:school");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  render(show(<SchoolHoursReport id="saved" />));
  await screen.findByRole("table", { name: en.schoolHours.individualAmounts });
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.downloadCsv }),
  );
  await waitFor(() => expect(remote.csv).toHaveBeenCalledTimes(1));
  remote.report.mockRejectedValue({ data: { code: "FORBIDDEN" } });
  await act(async () => {
    await client.refetchQueries({ queryKey: [["schoolHours", "report"]] });
  });
  await screen.findByText(en.schoolHours.denied);
  expect(screen.queryByText("Alex")).toBeNull();
  await act(async () => {
    complete({ filename: "private.csv", content: "private data" });
  });
  expect(create).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: en.schoolHours.revokeLink }),
  ).toBeNull();
});
