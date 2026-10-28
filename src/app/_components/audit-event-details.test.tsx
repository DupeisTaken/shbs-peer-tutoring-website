/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AuditEventDetails } from "./audit-event-details";
import { TableDetails } from "./ui/summary-table";

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      auditLogDetail: {
        useQuery: mocks.query,
        _def: () => ({ path: ["admin", "auditLogDetail"] }),
      },
    },
  },
}));

it.each(["en", "zh"])(
  "explains a pairing through unchanged captured names, schedule and typed room states (%s)",
  (locale) => {
    const details = {
      evidenceVersion: 1,
      outcome: "APPLIED",
      changes: [
        {
          entity: "Tutor",
          before: [{ id: "tutor", englishName: "Recorded Tutor" }],
          after: [{ id: "tutor", englishName: "Recorded Tutor" }],
        },
        {
          entity: "TimeSlot",
          before: [{ id: "slot", dayOfWeek: 1, startMin: 900, endMin: 950 }],
          after: [{ id: "slot", dayOfWeek: 1, startMin: 900, endMin: 950 }],
        },
        {
          entity: "Pairing",
          before: [
            {
              id: "pairing",
              tutorId: "tutor",
              timeSlotId: "slot",
              subject: "ACTIVE",
              roomMode: "FIXED",
            },
          ],
          after: [
            {
              id: "pairing",
              tutorId: "tutor",
              timeSlotId: "slot",
              subject: "ACTIVE",
              roomMode: "AUTO",
            },
          ],
        },
      ],
    };
    const original = structuredClone(details);
    mocks.query.mockReturnValue(result({ ...event, details }));
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={locale === "en" ? en : zh}
        >
          <AuditEventDetails id="event-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const summary = within(
      screen.getByRole("region", {
        name: locale === "en" ? "Recorded Changes" : "记录的变更",
      }),
    );
    const heading = summary.getByRole("button");
    expect(heading.textContent).toContain("Recorded Tutor");
    expect(heading.textContent).toContain("ACTIVE");
    expect(heading.textContent).toContain("15:00–15:50");
    expect(heading.textContent).not.toContain("tutorId");
    expect(
      summary.getByText(locale === "en" ? "Fixed room" : "固定教室"),
    ).toBeTruthy();
    expect(
      summary.getByText(
        locale === "en" ? "Automatic room allocation" : "自动分配教室",
      ),
    ).toBeTruthy();
    expect(
      summary.getByText(
        locale === "en" ? "Recorded path: /roomMode" : "记录路径：/roomMode",
      ),
    ).toBeTruthy();
    expect(details).toEqual(original);
  },
);

it.each(["ATTEMPT", "REVERSAL", "FUTURE_KIND"])(
  "keeps audit kind %s readable without losing stored metadata",
  (kind) => {
    mocks.query.mockReturnValue(
      result({
        ...event,
        kind,
        details: { evidenceVersion: 1, outcome: "FAILED", applied: false },
      }),
    );
    render(<AuditEventDetails id="event-1" />, { wrapper });
    expect(screen.getByText(`(${kind})`)).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getAllByText("FAILED").length).toBeGreaterThan(0);
  },
);

it.each(
  ["en", "zh"].flatMap((locale) => [
    {
      locale,
      scenario: "added empty object",
      details: { after: {} },
      nullCount: 0,
    },
    {
      locale,
      scenario: "removed empty object",
      details: { before: {} },
      nullCount: 0,
    },
    {
      locale,
      scenario: "null to empty object",
      details: { before: null, after: {} },
      nullCount: 1,
    },
    {
      locale,
      scenario: "undo-only added object",
      details: { after: { undoData: { private: "never-display" } } },
      nullCount: 0,
    },
    {
      locale,
      scenario: "undo-only removed object",
      details: { before: { undoData: { private: "never-display" } } },
      nullCount: 0,
    },
  ]),
)(
  "keeps $scenario explicit in the $locale semantic summary",
  ({ locale, details, nullCount }) => {
    const copy = locale === "en" ? en : zh;
    const original = structuredClone(details);
    mocks.query.mockReturnValue(result({ ...event, entity: "Tutor", details }));
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={copy}
        >
          <AuditEventDetails id="event-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.auditEventDetails.summaryTitle }),
    );
    expect(summary.getByText(copy.auditEventDetails.emptyObject)).toBeTruthy();
    expect(
      summary.queryAllByText(copy.auditEventDetails.nullValue),
    ).toHaveLength(nullCount);
    expect(screen.queryByText(/never-display/)).toBeNull();
    const exact = fullEvidence(copy.auditEventDetails.fullEvidence);
    const raw = exact
      .getByText(copy.auditEventDetails.rawEvidence)
      .closest("details")!;
    raw.open = true;
    fireEvent(raw, new Event("toggle"));
    expect(raw.querySelector("pre")!.textContent).toBe(
      JSON.stringify(
        details,
        (key, value: unknown) => (key === "undoData" ? undefined : value),
        2,
      ),
    );
    expect(details).toEqual(original);
  },
);

it.each(["en", "zh"])(
  "does not reinterpret an unknown nested object as its containing Tutor schema (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const details = {
      before: { metadata: {} },
      after: {
        metadata: {
          newObject: {
            status: "ACTIVE",
            name: "Literal recorded text",
            undoData: "secret-nested-undo",
          },
        },
      },
    };
    mocks.query.mockReturnValue(result({ ...event, entity: "Tutor", details }));
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={copy}
        >
          <AuditEventDetails id="event-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.auditEventDetails.summaryTitle }),
    );
    expect(summary.getByText("ACTIVE")).toBeTruthy();
    expect(summary.getByText("status")).toBeTruthy();
    expect(summary.getByText("Literal recorded text")).toBeTruthy();
    expect(summary.queryByText(/secret-nested-undo/)).toBeNull();
    expect(summary.queryByText(locale === "en" ? "Active" : "活跃")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "distinguishes ambiguous captured names from a missing reference (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const details = {
      evidenceVersion: 1,
      changes: [
        {
          entity: "Tutor",
          before: [
            { id: "conflicting", englishName: "First conflicting tutor" },
          ],
          after: [
            { id: "conflicting", englishName: "First conflicting tutor" },
          ],
        },
        {
          entity: "Tutor",
          before: [
            { id: "conflicting", englishName: "Second conflicting tutor" },
          ],
          after: [
            { id: "conflicting", englishName: "Second conflicting tutor" },
          ],
        },
        {
          entity: "Pairing",
          before: { id: "pairing", tutorId: "unrecorded" },
          after: { id: "pairing", tutorId: "conflicting" },
        },
      ],
    };
    const original = structuredClone(details);
    mocks.query.mockReturnValue(result({ ...event, details }));
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={copy}
        >
          <AuditEventDetails id="event-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.auditEventDetails.summaryTitle }),
    );
    const entity = copy.auditEventDetails.presentation.entities.Tutor;
    expect(
      summary.getByText(
        copy.approvals.review.referenceMissing.replace("{entity}", entity),
      ),
    ).toBeTruthy();
    expect(
      summary.getByText(
        copy.approvals.review.referenceAmbiguous.replace("{entity}", entity),
      ),
    ).toBeTruthy();
    expect(
      summary.getByText(
        copy.approvals.review.recordId.replace("{id}", "conflicting"),
      ),
    ).toBeTruthy();
    expect(summary.queryByText("First conflicting tutor")).toBeNull();
    expect(summary.queryByText("Second conflicting tutor")).toBeNull();
    const exact = fullEvidence(copy.auditEventDetails.fullEvidence);
    expect(exact.getAllByText(/First conflicting tutor/)).toHaveLength(2);
    expect(exact.getAllByText(/Second conflicting tutor/)).toHaveLength(2);
    expect(details).toEqual(original);
  },
);
let client: QueryClient;

it.each(
  ["en", "zh"].flatMap((locale) => [
    {
      locale,
      entity: "Pairing",
      field: "roomId",
      target: "Room",
      before: null,
      after: "",
    },
    {
      locale,
      entity: "Pairing",
      field: "roomId",
      target: "Room",
      before: "",
      after: null,
    },
    {
      locale,
      entity: "Tutor",
      field: "id",
      target: "Tutor",
      before: null,
      after: "",
    },
  ]),
)(
  "preserves empty $entity.$field identifiers separately from null in $locale",
  ({ locale, entity, field, target, before, after }) => {
    const copy = locale === "en" ? en : zh;
    const details = { before: { [field]: before }, after: { [field]: after } };
    const original = structuredClone(details);
    mocks.query.mockReturnValue(result({ ...event, entity, details }));
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={copy}
        >
          <AuditEventDetails id="event-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.auditEventDetails.summaryTitle }),
    );
    expect(summary.getByText(copy.auditEventDetails.emptyString)).toBeTruthy();
    expect(summary.getByText(copy.auditEventDetails.nullValue)).toBeTruthy();
    const targetName =
      copy.auditEventDetails.presentation.entities[target as "Room" | "Tutor"];
    expect(
      summary.queryByText(
        copy.approvals.review.referenceMissing.replace("{entity}", targetName),
      ),
    ).toBeNull();
    const exact = fullEvidence(copy.auditEventDetails.fullEvidence);
    const raw = exact
      .getByText(copy.auditEventDetails.rawEvidence)
      .closest("details")!;
    raw.open = true;
    fireEvent(raw, new Event("toggle"));
    expect(JSON.parse(raw.querySelector("pre")!.textContent)).toEqual(details);
    expect(details).toEqual(original);
  },
);

const event = {
  id: "event-1",
  userId: "actor-1",
  userName: "Recorded Alex",
  kind: "ACTION",
  operation: "program.setProfilePolicy",
  entity: "ProgramSettings",
  entityId: "settings-1",
  action: "Update name display",
  approvalId: "approval-1",
  details: null as unknown,
  createdAt: new Date("2026-10-09T01:23:45.678Z"),
  undone: false,
  undoneAt: null as Date | null,
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      {children}
    </NextIntlClientProvider>
  </QueryClientProvider>
);
function result(
  data: unknown = event,
  error: unknown = null,
  isFetching = false,
) {
  return { data, error, isFetching, refetch: mocks.refetch };
}
/** Exact evidence is a deliberate second layer beneath the readable summary. */
function fullEvidence(label = "Full recorded evidence") {
  const toggle = screen.getByRole("button", { name: new RegExp(`^${label}`) });
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  return within(
    document.getElementById(toggle.getAttribute("aria-controls")!)!,
  );
}
function technicalDetails(label = "Technical details") {
  const toggle = screen.getByRole("button", { name: new RegExp(`^${label}`) });
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  return within(
    document.getElementById(toggle.getAttribute("aria-controls")!)!,
  );
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.query.mockReturnValue(result());
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
  vi.clearAllMocks();
});

it("highlights immutable before/after differences with textual markers and preserves exact original values", () => {
  const evidence = {
    before: { enabled: false, count: 0, missingLater: "Original exact value" },
    after: { enabled: true, count: 0, added: null },
  };
  const original = structuredClone(evidence);
  mocks.query.mockReturnValue(result({ ...event, details: evidence }));
  render(<AuditEventDetails id="event-1" />, { wrapper });
  expect(
    screen.getByText("Value changes: 1 changed · 1 added · 1 removed"),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Before" })).toBeNull();
  const exact = fullEvidence();
  const before = within(exact.getByRole("region", { name: "Before" }));
  const after = within(exact.getByRole("region", { name: "After" }));
  expect(before.getByText("Original exact value")).toBeTruthy();
  expect(before.getByText("Removed")).toBeTruthy();
  expect(after.getByText("Added")).toBeTruthy();
  expect(before.getByText("Changed")).toBeTruthy();
  expect(after.getByText("Changed")).toBeTruthy();
  expect(evidence).toEqual(original);
});

it("highlights canonical nested changes while retaining entity/write/count context and immutable originals", () => {
  const details = {
    evidenceVersion: 1,
    entity: "TutorMeeting",
    write: "updateMany",
    affectedCount: 1,
    changes: [
      {
        before: {
          status: "PRESENT",
          preserved: "Original recorded context",
          undoData: "private implementation",
        },
        after: {
          status: "EXCUSED_ABSENT",
          preserved: "Original recorded context",
          reason: "Recorded long reason\nsecond line",
        },
      },
    ],
  };
  const original = structuredClone(details);
  mocks.query.mockReturnValue(result({ ...event, details }));
  render(<AuditEventDetails id="event-1" />, { wrapper });
  const exact = fullEvidence();
  expect(exact.getByText("TutorMeeting")).toBeTruthy();
  expect(exact.getByText("updateMany")).toBeTruthy();
  expect(exact.getByText("affectedCount")).toBeTruthy();
  expect(exact.getByText("PRESENT")).toBeTruthy();
  expect(exact.getByText("EXCUSED_ABSENT")).toBeTruthy();
  expect(exact.getAllByText("Changed")).toHaveLength(2);
  expect(exact.getByText("Added")).toBeTruthy();
  expect(screen.queryByText("private implementation")).toBeNull();
  expect(details).toEqual(original);
});

it("loads only when details open, refreshes on reopening and returns keyboard focus", () => {
  render(
    <TableDetails title="Recorded change" longReader>
      <AuditEventDetails id="event-1" />
    </TableDetails>,
    { wrapper },
  );
  expect(mocks.query).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", {
    name: "View details: Recorded change",
  });
  trigger.focus();
  fireEvent.click(trigger);
  expect(mocks.query).toHaveBeenCalledWith(
    { id: "event-1" },
    { refetchOnMount: "always", enabled: true },
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Recorded Alex")).toBeTruthy();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  mocks.query.mockClear();
  fireEvent.click(trigger);
  expect(mocks.query).toHaveBeenCalledTimes(1);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("shows exact stored identifiers, milliseconds, undo time and a linked approval", () => {
  mocks.query.mockReturnValue(
    result({
      ...event,
      undone: true,
      undoneAt: new Date("2026-10-09T02:34:56.789Z"),
      undoData: { password: "never-display" },
    }),
  );
  render(<AuditEventDetails id="event-1" />, { wrapper });
  const technical = technicalDetails();
  for (const text of [
    "actor-1",
    "event-1",
    "program.setProfilePolicy",
    "ProgramSettings",
    "settings-1",
    "2026-10-09T01:23:45.678Z",
    "2026-10-09T02:34:56.789Z",
  ])
    expect(screen.getByText(text)).toBeTruthy();
  expect(technical.getByText("Undone")).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Recorded event" })).getByText(
      "Undone",
    ),
  ).toBeTruthy();
  const time = screen.getByText(
    "2026-10-09T01:23:45.678Z",
  ).previousElementSibling;
  expect(time?.getAttribute("datetime")).toBe("2026-10-09T01:23:45.678Z");
  expect(time?.textContent).toContain(":45");
  expect(
    screen
      .getByRole("link", { name: "Open approval · approval-1" })
      .getAttribute("href"),
  ).toBe("/admin/approvals?request=approval-1");
  expect(screen.queryByText(/never-display/)).toBeNull();
});

it.each(["en", "zh"])(
  "keeps essential changes before independently collapsed technical provenance (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const details = {
      evidenceVersion: 1,
      outcome: "APPLIED",
      before: { enabled: false },
      after: { enabled: true },
    };
    const original = structuredClone(details);
    mocks.query.mockReturnValue(result({ ...event, details }));
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={copy}
        >
          <AuditEventDetails id="event-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const upfront = within(
      screen.getByRole("region", { name: copy.auditEventDetails.event }),
    );
    expect(upfront.getByText(event.action)).toBeTruthy();
    expect(upfront.getByText(event.userName)).toBeTruthy();
    expect(
      upfront.getByText(copy.auditFilters.kinds.ACTION, { selector: "dd" }),
    ).toBeTruthy();
    expect(
      upfront.getByText(
        copy.auditEventDetails.presentation.entities.ProgramSettings,
      ),
    ).toBeTruthy();
    expect(
      upfront.getByText(copy.auditEventDetails.presentation.outcomes.APPLIED),
    ).toBeTruthy();
    expect(upfront.queryByText(event.userId)).toBeNull();
    expect(upfront.queryByText(event.id)).toBeNull();
    expect(upfront.queryByText(event.operation)).toBeNull();
    expect(upfront.queryByText(event.entityId)).toBeNull();
    expect(upfront.queryByText(copy.auditEventDetails.notUndone)).toBeNull();
    const summary = screen.getByRole("region", {
      name: copy.auditEventDetails.summaryTitle,
    });
    expect(
      within(summary).getByText(copy.auditEventDetails.falseValue),
    ).toBeTruthy();
    expect(
      within(summary).getByText(copy.auditEventDetails.trueValue),
    ).toBeTruthy();
    const technical = screen.getByRole("button", {
      name: new RegExp(`^${copy.auditEventDetails.technicalDetails}`),
    });
    const panel = document.getElementById(
      technical.getAttribute("aria-controls")!,
    )!;
    expect(panel.hidden).toBe(true);
    expect(
      summary.compareDocumentPosition(technical) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    const full = screen.getByRole("button", {
      name: new RegExp(`^${copy.auditEventDetails.fullEvidence}`),
    });
    const comparison = within(summary).getByRole("button");
    expect(comparison.getAttribute("aria-expanded")).toBe("true");
    expect(full.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(technical);
    expect(panel.hidden).toBe(false);
    const exact = within(panel);
    for (const text of [
      event.userId,
      event.id,
      event.operation,
      event.entity,
      event.entityId,
    ])
      expect(exact.getByText(text)).toBeTruthy();
    expect(exact.getByRole("link").getAttribute("href")).toBe(
      "/admin/approvals?request=approval-1",
    );
    expect(comparison.getAttribute("aria-expanded")).toBe("true");
    expect(full.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(technical);
    expect(panel.hidden).toBe(true);
    fireEvent.click(full);
    expect(full.getAttribute("aria-expanded")).toBe("true");
    expect(technical.getAttribute("aria-expanded")).toBe("false");
    expect(comparison.getAttribute("aria-expanded")).toBe("true");
    expect(details).toEqual(original);
  },
);

it("renders legacy missing evidence explicitly without inventing a before value", () => {
  mocks.query.mockReturnValue(
    result({
      ...event,
      userName: null,
      userId: null,
      operation: null,
      entity: null,
      entityId: null,
      approvalId: null,
    }),
  );
  render(<AuditEventDetails id="event-1" />, { wrapper });
  expect(
    screen.getByText("No detailed evidence was recorded for this event."),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Recorded event" })).getAllByText(
      "Not recorded",
    ),
  ).toHaveLength(2);
  expect(technicalDetails().getAllByText("Not recorded")).toHaveLength(6);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("region", { name: "Before" })).toBeNull();
});

it("distinguishes missing, null, false, zero and empty evidence in saved comparisons", () => {
  mocks.query.mockReturnValue(
    result({
      ...event,
      details: {
        after: {
          enabled: false,
          count: 0,
          reason: "",
          value: null,
          participants: [],
          extra: {},
        },
      },
    }),
  );
  render(<AuditEventDetails id="event-1" />, { wrapper });
  const exact = fullEvidence();
  expect(
    within(exact.getByRole("region", { name: "Before" })).getByText(
      "Not recorded",
    ),
  ).toBeTruthy();
  const after = within(exact.getByRole("region", { name: "After" }));
  for (const value of [
    "False",
    "0",
    "Empty text",
    "Null (explicitly recorded)",
    "Empty list []",
    "Empty object",
  ])
    expect(after.getByText(value)).toBeTruthy();
});

it("preserves unknown nested evidence, multiline long text, lists and deep fallback", () => {
  const long = "Long recorded description ".repeat(100);
  mocks.query.mockReturnValue(
    result({
      ...event,
      details: {
        before: { note: "Original" },
        after: {
          note: long,
          multiline: "First\nSecond",
          nested: [{ active: true }],
        },
        context: {
          a: {
            b: {
              c: {
                d: { value: "deep recorded value", undoData: "private-undo" },
              },
            },
          },
        },
      },
    }),
  );
  render(<AuditEventDetails id="event-1" />, { wrapper });
  const exact = fullEvidence();
  expect(exact.getByText(long.trim())).toBeTruthy();
  expect(exact.getByText("First Second").textContent).toContain(
    "First\nSecond",
  );
  expect(exact.getByText("True")).toBeTruthy();
  expect(exact.getByText(/deep recorded value/).tagName).toBe("PRE");
  expect(screen.queryByText(/private-undo/)).toBeNull();
  expect(exact.getByText("Original")).toBeTruthy();
});

it("shows loading, recovers initial read failure and preserves cached evidence on refresh failure", () => {
  mocks.query.mockReturnValue({ ...result(), data: undefined });
  const view = render(<AuditEventDetails id="event-1" />, { wrapper });
  expect(screen.getByRole("status").textContent).toContain(
    "Loading event details",
  );
  mocks.query.mockReturnValue({
    ...result(undefined, { message: "Request failed" }),
    data: undefined,
  });
  view.rerender(<AuditEventDetails id="event-1" />);
  expect(screen.getByRole("alert").textContent).toContain("Request failed");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mocks.refetch).toHaveBeenCalledTimes(1);
  mocks.query.mockReturnValue(
    result(event, { message: "Refresh failed" }, true),
  );
  view.rerender(<AuditEventDetails id="event-1" />);
  expect(screen.getByText("Recorded Alex")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain(
    "last loaded evidence remains visible",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }).disabled,
  ).toBe(true);
  mocks.query.mockReturnValue(result());
  view.rerender(<AuditEventDetails id="event-1" />);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("localizes labels and value states while retaining recorded field names and text", () => {
  mocks.query.mockReturnValue(
    result({
      ...event,
      details: {
        before: { enabled: false },
        after: { enabled: true, note: "Stored English note" },
      },
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="zh"
        timeZone="Asia/Shanghai"
        messages={zh}
      >
        <AuditEventDetails id="event-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(
    screen.getByText("值的变更：已更改 1 项 · 已添加 1 项 · 已移除 0 项"),
  ).toBeTruthy();
  const exact = fullEvidence("完整记录证据");
  for (const text of ["变更前", "变更后", "假", "真", "Stored English note"])
    expect(exact.getByText(text)).toBeTruthy();
  expect(screen.getByText("已记录事件")).toBeTruthy();
  expect(screen.getByText("2026-10-09T01:23:45.678Z")).toBeTruthy();
  expect(exact.getAllByText("enabled")).toHaveLength(2);
});

it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "hides previously loaded private evidence after %s instead of retaining it",
  (code) => {
    mocks.query.mockReturnValue(
      result({
        ...event,
        details: { privateNote: "Private historical evidence" },
      }),
    );
    const view = render(<AuditEventDetails id="event-1" />, { wrapper });
    expect(screen.getByText("Private historical evidence")).toBeTruthy();
    mocks.query.mockReturnValue(
      result(
        { ...event, details: { privateNote: "Private historical evidence" } },
        { message: "Access denied", data: { code } },
      ),
    );
    view.rerender(<AuditEventDetails id="event-1" />);
    expect(screen.getByRole("status").textContent).toContain(
      "Event details access denied",
    );
    expect(screen.queryByText("Private historical evidence")).toBeNull();
    expect(screen.queryByText("Recorded Alex")).toBeNull();
    expect(screen.queryByText("event-1")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("View stored JSON")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  },
);

it("lazily exposes faithful JSON types and escaped text while excluding internal undo instructions", () => {
  const details = {
    number: 0,
    numericText: "0",
    boolean: false,
    booleanText: "False",
    null: null,
    nullText: "null",
    emptyText: "",
    escapedText: 'Quoted "text"\nnext line',
    emptyList: [],
    undoData: { private: "undo-only" },
  };
  mocks.query.mockReturnValue(result({ ...event, details }));
  const view = render(<AuditEventDetails id="event-1" />, { wrapper });
  const summary = screen.getByText("View stored JSON");
  expect(summary.tagName).toBe("SUMMARY");
  expect(view.container.querySelector("pre")).toBeNull();
  const disclosure = summary.closest("details")!;
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  const json = disclosure.querySelector("pre")!;
  const expected = { ...details };
  Reflect.deleteProperty(expected, "undoData");
  expect(json.textContent).toBe(JSON.stringify(expected, null, 2));
  expect(JSON.parse(json.textContent)).toEqual(expected);
  expect(screen.queryByText(/undo-only/)).toBeNull();
  disclosure.open = false;
  fireEvent(disclosure, new Event("toggle"));
  expect(disclosure.querySelector("pre")).toBeNull();
});

it.each([
  {
    locale: "en",
    messages: en,
    title: "Recorded Changes",
    full: "Full recorded evidence",
    position: "Recorded position 70",
    raw: "View stored JSON",
    counts: "Value changes: 69 changed · 0 added · 0 removed",
  },
  {
    locale: "zh",
    messages: zh,
    title: "记录的变更",
    full: "完整记录证据",
    position: "记录位置 70",
    raw: "查看已保存的 JSON",
    counts: "值的变更：已更改 69 项 · 已添加 0 项 · 已移除 0 项",
  },
])(
  "keeps a long $locale batch inspectable with deliberate full evidence and exact raw JSON",
  ({ locale, messages, title, full, position, raw, counts }) => {
    const before = Array.from({ length: 70 }, (_, index) => ({
      id: `record-${index}`,
      value: `before-${index}`,
    }));
    const after = before.map((row, index) => ({
      ...row,
      value: index === 0 ? row.value : `after-${index}`,
    }));
    const details = {
      evidenceVersion: 1,
      changes: [
        {
          entity: "Tutee",
          write: "updateMany",
          affectedCount: 70,
          before,
          after,
        },
      ],
    };
    mocks.query.mockReturnValue(result({ ...event, details }));
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={messages}
        >
          <AuditEventDetails id="event-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const summary = within(screen.getByRole("region", { name: title }));
    expect(summary.getByText(counts)).toBeTruthy();
    const comparisons = summary.getAllByRole("button");
    expect(comparisons).toHaveLength(69);
    expect(
      comparisons.every(
        (button) => button.getAttribute("aria-expanded") === "false",
      ),
    ).toBe(true);
    const last = comparisons.at(-1)!;
    fireEvent.click(last);
    const comparison = within(
      document.getElementById(last.getAttribute("aria-controls")!)!,
    );
    expect(comparison.getByText(position)).toBeTruthy();
    expect(comparison.getByText("before-69")).toBeTruthy();
    expect(comparison.getByText("after-69")).toBeTruthy();
    expect(last.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(last);
    expect(last.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen
        .getByRole("button", { name: new RegExp(`^${full}`) })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen
        .queryByText(raw, { selector: "summary" })
        ?.closest("details")
        ?.querySelector("pre"),
    ).toBeNull();
    const exact = fullEvidence(full);
    const disclosure = exact
      .getByText(raw, { selector: "summary" })
      .closest("details")!;
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
    expect(JSON.parse(disclosure.querySelector("pre")!.textContent)).toEqual(
      details,
    );
  },
);

it("keeps an unknown batch faithful and excludes nested undo instructions from added objects and JSON", () => {
  const details = {
    evidenceVersion: 1,
    changes: [
      {
        entity: "Tutee",
        write: "update",
        before: {},
        after: {
          child: {
            id: "added-id",
            nested: [{ undoData: "secret-undo", flag: false, count: 0 }],
          },
        },
      },
      { unexpected: "Unknown original context", undoData: "root-secret" },
    ],
  };
  const original = structuredClone(details);
  mocks.query.mockReturnValue(result({ ...event, details }));
  render(<AuditEventDetails id="event-1" />, { wrapper });
  expect(screen.queryByRole("region", { name: "Recorded Changes" })).toBeNull();
  const exact = fullEvidence();
  expect(exact.getByText("Unknown original context")).toBeTruthy();
  const raw = exact.getByText("View stored JSON").closest("details")!;
  raw.open = true;
  fireEvent(raw, new Event("toggle"));
  expect(raw.querySelector("pre")!.textContent).not.toMatch(
    /undoData|secret-undo|root-secret/,
  );
  expect(raw.querySelector("pre")!.textContent).toContain('"count": 0');
  expect(raw.querySelector("pre")!.textContent).toContain('"flag": false');
  expect(details).toEqual(original);
});
