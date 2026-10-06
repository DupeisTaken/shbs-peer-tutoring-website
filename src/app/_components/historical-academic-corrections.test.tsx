/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryObserver, type InvalidateQueryFilters, type InvalidateOptions } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { HistoricalAcademicCorrections } from "./historical-academic-corrections";
import {
  historicalCorrectionCsv,
  type HistoricalCorrectionInput,
} from "~/lib/historical-academics";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
  historicalInvalidate: vi.fn(),
  tuteesInvalidate: vi.fn(),
  historyInvalidate: vi.fn(),
  pending: false,
  fetching: false,
  fingerprint: "a".repeat(64),
}));
const record = () => ({
  recordId: "legacy-tutee:one",
  kind: "TUTEE",
  name: "Synthetic Learner",
  fingerprint: mocks.fingerprint,
  original: {
    rawGrade: null,
    schoolYear: "24-25",
    source: "LEGACY_TUTEE",
    originalConfirmedAt: null,
  },
  current: { rawGrade: null, schoolYear: "24-25" },
  revision: 0,
  correction: null,
  ownershipConflict: false,
  owners: [],
});
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      historicalAcademics: { invalidate: mocks.historicalInvalidate },
      admin: { tutees: { invalidate: mocks.tuteesInvalidate } },
      tuteeHistory: { invalidate: mocks.historyInvalidate },
    }),
    historicalAcademics: {
      list: {
        useQuery: () => ({
          data: { records: [record()], hasNext: false },
          refetch: mocks.refresh,
          isFetching: mocks.fetching,
        }),
      },
      preview: {
        useMutation: () => ({ mutateAsync: mocks.preview, isPending: false }),
      },
      correctBatch: {
        useMutation: () => ({
          mutateAsync: mocks.apply,
          isPending: mocks.pending,
        }),
      },
    },
  },
}));
function mount(coordinator = false, locale = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <HistoricalAcademicCorrections coordinator={coordinator} />
    </NextIntlClientProvider>,
  );
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  mocks.fingerprint = "a".repeat(64);
  mocks.pending = false;
  mocks.fetching = false;
  mocks.invalidate.mockResolvedValue(undefined);
  for (const invalidate of [mocks.historicalInvalidate, mocks.tuteesInvalidate, mocks.historyInvalidate])
    invalidate.mockImplementation(() => mocks.invalidate());
  mocks.preview.mockImplementation(
    async (input: HistoricalCorrectionInput) => ({
      ticket: "b".repeat(64),
      records: input.rows.map((row) => ({
        ...record(),
        proposed: { rawGrade: row.rawGrade, schoolYear: row.schoolYear },
        evidence: row.evidence,
        reason: row.reason,
      })),
    }),
  );
  mocks.apply.mockResolvedValue({ count: 1 });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function edit() {
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Synthetic Learner · legacy-tutee:one",
    }),
  );
  fireEvent.change(screen.getByLabelText("Historical grade (raw text)"), {
    target: { value: "初三" },
  });
  fireEvent.change(screen.getByLabelText("Correction evidence"), {
    target: { value: "Original register" },
  });
  fireEvent.change(screen.getByLabelText("Reason (at least 10 characters)"), {
    target: { value: "Corrected using original register" },
  });
}

it("waits for the refreshed records before allowing a CSV download", () => {
  mocks.fetching = true;
  const mounted = mount();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Download correction CSV",
    }).disabled,
  ).toBe(true);
  mocks.fetching = false;
  mounted.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <HistoricalAcademicCorrections coordinator={false} />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Download correction CSV",
    }).disabled,
  ).toBe(false);
});
async function preview() {
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Preview selected corrections" })
      .closest("form")!,
  );
  return screen.findByRole("dialog", { name: "Review Historical Corrections" });
}

it("previews exact drafts, retains them on close and requires acknowledgement before save", async () => {
  mount();
  edit();
  const opener = screen.getByRole("button", {
    name: "Preview selected corrections",
  });
  opener.focus();
  const dialog = await preview();
  expect(within(dialog).getByText("初三 · 24-25")).toBeTruthy();
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "Apply entire batch",
    }).disabled,
  ).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(
    screen.getByLabelText<HTMLInputElement>("Historical grade (raw text)")
      .value,
  ).toBe("初三");
  expect(mocks.apply).not.toHaveBeenCalled();
  const reopened = await preview();
  fireEvent.click(within(reopened).getByRole("checkbox"));
  fireEvent.click(
    within(reopened).getByRole("button", { name: "Apply entire batch" }),
  );
  await screen.findByText("Saved 1 historical corrections.");
  expect(mocks.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "WEBSITE",
      rows: [
        expect.objectContaining({
          expectedFingerprint: "a".repeat(64),
          rawGrade: "初三",
          schoolYear: "24-25",
        }),
      ],
    }),
  );
  expect(screen.queryByLabelText("Historical grade (raw text)")).toBeNull();
});

it("keeps stale drafts and their fingerprints despite background data refresh", async () => {
  const rendered = mount();
  edit();
  mocks.fingerprint = "c".repeat(64);
  rendered.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <HistoricalAcademicCorrections coordinator={false} />
    </NextIntlClientProvider>,
  );
  mocks.preview.mockRejectedValueOnce(new Error("HISTORICAL_STALE"));
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Preview selected corrections" })
      .closest("form")!,
  );
  await screen.findByRole("alert");
  expect(
    screen.getByLabelText<HTMLInputElement>("Historical grade (raw text)")
      .value,
  ).toBe("初三");
  expect(mocks.preview).toHaveBeenCalledWith(
    expect.objectContaining({
      rows: [expect.objectContaining({ expectedFingerprint: "a".repeat(64) })],
    }),
  );
});

it("retains drafts on queued approval and failed saves, and reports refresh failure after success", async () => {
  mount(true);
  edit();
  let dialog = await preview();
  mocks.apply.mockRejectedValueOnce({ data: { approvalId: "request-1" } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Submit entire batch for approval",
    }),
  );
  await screen.findByText(
    /Submitted for approval\. Live records are unchanged/,
  );
  expect(
    screen.getByLabelText<HTMLInputElement>("Historical grade (raw text)")
      .value,
  ).toBe("初三");
  dialog = await preview();
  mocks.apply.mockRejectedValueOnce(new Error("HISTORICAL_STALE"));
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Submit entire batch for approval",
    }),
  );
  await within(dialog).findByRole("alert");
  expect(
    screen.getByLabelText<HTMLInputElement>("Historical grade (raw text)")
      .value,
  ).toBe("初三");
  mocks.invalidate.mockRejectedValue(new Error("offline"));
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Submit entire batch for approval",
    }),
  );
  await screen.findByText(/Corrections were saved, but refreshing failed/);
  expect(screen.queryByLabelText("Historical grade (raw text)")).toBeNull();
});

it("uses the same preview for CSV and rejects missing stable columns", async () => {
  mount();
  const rows = [
    {
      recordId: record().recordId,
      expectedFingerprint: "a".repeat(64),
      rawGrade: null,
      schoolYear: null,
      evidence: "Archive",
      reason: "Missing grade in original",
    },
  ];
  const file = new File([""], "corrections.csv");
  Object.defineProperty(file, "text", {
    value: async () => historicalCorrectionCsv(rows),
  });
  fireEvent.change(screen.getByLabelText("Upload correction CSV"), {
    target: { files: [file] },
  });
  await screen.findByText("1 CSV rows ready for preview");
  fireEvent.click(screen.getByRole("button", { name: "Preview CSV" }));
  await screen.findByRole("dialog");
  expect(mocks.preview).toHaveBeenCalledWith({ method: "CSV", rows });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  const invalid = new File([""], "invalid.csv");
  Object.defineProperty(invalid, "text", {
    value: async () => "name,rawGrade\nSynthetic Learner,G8",
  });
  fireEvent.change(screen.getByLabelText("Upload correction CSV"), {
    target: { files: [invalid] },
  });
  await screen.findByRole("alert");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Preview CSV" })
      .disabled,
  ).toBe(true);
});

it("guards pending dialog dismissal and renders the Chinese workflow", async () => {
  const mounted = mount();
  edit();
  const dialog = await preview();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  let finish!: (value: { count: number }) => void;
  mocks.apply.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mocks.pending = true;
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Apply entire batch" }),
  );
  mounted.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <HistoricalAcademicCorrections coordinator={false} />
    </NextIntlClientProvider>,
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close" })
        .disabled,
    ).toBe(true),
  );
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  finish({ count: 1 });
  await screen.findByText("Saved 1 historical corrections.");
  cleanup();
  mocks.pending = false;
  mount(false, "zh");
  expect(
    screen.getByRole("heading", { name: "历史学业资料更正" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "预览 CSV" })).toBeTruthy();
});

it("preserves separate website edits when a CSV batch is saved", async () => {
  mount();
  edit();
  const rows = [
    {
      recordId: record().recordId,
      expectedFingerprint: "a".repeat(64),
      rawGrade: "Year 13",
      schoolYear: "23-24",
      evidence: "CSV register",
      reason: "Correction from a separate register",
    },
  ];
  const file = new File([""], "corrections.csv");
  Object.defineProperty(file, "text", {
    value: async () => historicalCorrectionCsv(rows),
  });
  fireEvent.change(screen.getByLabelText("Upload correction CSV"), {
    target: { files: [file] },
  });
  await screen.findByText("1 CSV rows ready for preview");
  fireEvent.click(screen.getByRole("button", { name: "Preview CSV" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Apply entire batch" }),
  );
  await screen.findByText("Saved 1 historical corrections.");
  expect(
    screen.getByLabelText<HTMLInputElement>("Historical grade (raw text)")
      .value,
  ).toBe("初三");
  expect(screen.queryByText("1 CSV rows ready for preview")).toBeNull();
});

it("preserves a separate CSV draft when website corrections are saved", async () => {
  mount();
  edit();
  const rows = [
    {
      recordId: record().recordId,
      expectedFingerprint: "a".repeat(64),
      rawGrade: "Year 13",
      schoolYear: "23-24",
      evidence: "CSV register",
      reason: "Correction from a separate register",
    },
  ];
  const file = new File([""], "corrections.csv");
  Object.defineProperty(file, "text", {
    value: async () => historicalCorrectionCsv(rows),
  });
  fireEvent.change(screen.getByLabelText("Upload correction CSV"), {
    target: { files: [file] },
  });
  await screen.findByText("1 CSV rows ready for preview");
  const dialog = await preview();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Apply entire batch" }),
  );
  await screen.findByText("Saved 1 historical corrections.");
  expect(screen.queryByLabelText("Historical grade (raw text)")).toBeNull();
  expect(screen.getByText("1 CSV rows ready for preview")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Preview CSV" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Preview CSV" }));
  await screen.findByRole("dialog");
  expect(mocks.preview).toHaveBeenLastCalledWith({ method: "CSV", rows });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function applyPreview() {
  const dialog = await preview();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  return within(dialog).getByRole<HTMLButtonElement>("button", { name: "Apply entire batch" });
}

it("admits only one same-frame write and protects the review without waiting for mutation state", async () => {
  const write = deferred<{ count: number }>();
  mocks.apply.mockReturnValueOnce(write.promise);
  mount();
  edit();
  const apply = await applyPreview();
  act(() => { apply.click(); apply.click(); });
  expect(mocks.apply).toHaveBeenCalledTimes(1);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled).toBe(true);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () => write.resolve({ count: 1 }));
  await screen.findByText("Saved 1 historical corrections.");
  expect(mocks.apply).toHaveBeenCalledTimes(1);
});

it.each(["failure-first", "failure-last", "synchronous-failure"] as const)(
  "owns every post-save refresh and retries reads without replay (%s)",
  async (order) => {
    const first = deferred<void>();
    const second = deferred<void>();
    mocks.historicalInvalidate.mockImplementationOnce(() => {
      if (order === "synchronous-failure") throw new Error("offline");
      return first.promise;
    });
    mocks.tuteesInvalidate.mockReturnValueOnce(second.promise);
    mount();
    edit();
    fireEvent.click(await applyPreview());
    await screen.findByText("Saved 1 historical corrections.");
    expect(mocks.historyInvalidate).toHaveBeenCalledTimes(1);
    if (order === "failure-first") await act(async () => first.reject(new Error("offline")));
    if (order === "failure-last") await act(async () => second.resolve());
    expect(screen.queryByText(/Corrections were saved, but refreshing failed/)).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Refresh records" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Download correction CSV" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Synthetic Learner · legacy-tutee:one" }).disabled).toBe(true);
    if (order === "failure-last") await act(async () => first.reject(new Error("offline")));
    else await act(async () => second.resolve());
    await screen.findByText(/Corrections were saved, but refreshing failed/);
    expect(screen.queryByLabelText("Historical grade (raw text)")).toBeNull();
    // Recovery is a second complete read group, never a repeated correction.
    fireEvent.click(screen.getByRole("button", { name: "Refresh records" }));
    await waitFor(() => expect(screen.queryByText(/Corrections were saved, but refreshing failed/)).toBeNull());
    for (const invalidate of [mocks.historicalInvalidate, mocks.tuteesInvalidate, mocks.historyInvalidate])
      expect(invalidate).toHaveBeenCalledTimes(2);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  },
);

it("reports a real QueryClient read error only after both active record variants settle", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = deferred<string>();
  const second = deferred<string>();
  const firstRead = vi.fn(() => first.promise);
  const secondRead = vi.fn(() => second.promise);
  const observers = [firstRead, secondRead].map((queryFn, index) => new QueryObserver(client, {
    queryKey: ["historicalAcademics", index], queryFn, initialData: "cached", staleTime: Infinity,
  }));
  const stops = observers.map((observer) => observer.subscribe(() => undefined));
  mocks.historicalInvalidate.mockImplementation((_input: undefined, filters: InvalidateQueryFilters, options: InvalidateOptions) =>
    client.invalidateQueries({ queryKey: ["historicalAcademics"], ...filters }, options),
  );
  try {
    mount();
    edit();
    fireEvent.click(await applyPreview());
    await screen.findByText("Saved 1 historical corrections.");
    await act(async () => first.reject(new Error("actual read failure")));
    expect(screen.queryByText(/Corrections were saved, but refreshing failed/)).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Refresh records" }).disabled).toBe(true);
    await act(async () => second.resolve("fresh"));
    await screen.findByText(/Corrections were saved, but refreshing failed/);
    expect(observers[0]!.getCurrentResult().data).toBe("cached");
    firstRead.mockResolvedValue("recovered");
    fireEvent.click(screen.getByRole("button", { name: "Refresh records" }));
    await waitFor(() => expect(screen.queryByText(/Corrections were saved, but refreshing failed/)).toBeNull());
    expect(observers[0]!.getCurrentResult().data).toBe("recovered");
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  } finally {
    stops.forEach((stop) => stop());
    client.clear();
  }
});
