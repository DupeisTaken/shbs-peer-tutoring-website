// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  renderSchoolHoursContent,
  schoolHoursEmailCopy,
} from "./school-hours-email";
import {
  publicSchoolHoursReport,
  schoolHoursCsv,
  schoolHoursHtmlResponse,
} from "./school-hours-public";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";

const reportUrl = "https://reports.example.test/saved";
const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");
const personDetails = (doc: Document, person: Element) =>
  doc.getElementById(
    person.querySelector(".hours-button")!.getAttribute("popovertarget")!,
  )!;

function carryReport(
  postingPolicy:
    "TENTH_HOUR_CARRY" | "TENTH_HOUR_CARRY_NONNEGATIVE" = "TENTH_HOUR_CARRY",
) {
  const snapshot = schoolHoursTestSnapshot();
  snapshot.postingPolicy = postingPolicy;
  snapshot.rows = [
    {
      ...snapshot.rows[0]!,
      tutoringChange: 80 / 60,
      crewChange: 0,
      hoursToAdd: 1.3,
      monthAmount: 1.3,
      carryInHours: "0",
      carryOutHours: "0.0333333333333333",
    },
  ];
  snapshot.totals = {
    people: 1,
    tutoringChange: 80 / 60,
    crewChange: 0,
    hoursToAdd: 1.3,
    monthAmount: 1.3,
  };
  return publicSchoolHoursReport(snapshot);
}

it("keeps escaped school-account references and first-edition posting rules inside each person's Details", () => {
  const report = carryReport("TENTH_HOUR_CARRY_NONNEGATIVE");
  report.rows[0]!.schoolAccountKey = 'account <synthetic> & "school"';
  const before = JSON.stringify(report);
  const html = renderSchoolHoursContent(report);
  const doc = parse(html);
  expect(doc.querySelector(".school-summary .school-account")).toBeNull();
  expect(doc.querySelector(".person-identity")?.textContent).toBe(
    report.rows[0]!.exportName,
  );
  const details = doc.querySelector<HTMLElement>(".person-details")!;
  expect(details.getAttribute("popover")).toBe("auto");
  expect(details.hasAttribute("open")).toBe(false);
  expect(details.querySelector(".school-account")?.textContent).toBe(
    `School account / 学校账户: ${report.rows[0]!.schoolAccountKey}`,
  );
  expect(html).toContain("account &lt;synthetic&gt; &amp; &quot;school&quot;");
  expect(html).not.toContain("account <synthetic>");
  expect(details.querySelector(".posting-guidance")?.textContent).toContain(
    "Apply each person's highlighted amount",
  );
  expect(doc.querySelector(".edition-guidance")).toBeNull();
  const carry = doc.querySelector<HTMLDetailsElement>(".carry-explanation")!;
  expect(carry.open).toBe(false);
  expect(carry.textContent).toContain("Post in 0.1 h (6 min) increments");
  expect(carry.textContent).toContain("Never enter carry separately");
  expect(doc.body.querySelectorAll(".posting-legend")).toHaveLength(1);
  expect(JSON.stringify(report)).toBe(before);
  expect(schoolHoursCsv(report).content).toContain(
    '"account <synthetic> & ""school"""',
  );
});

it.each(["TENTH_HOUR_CARRY", "TENTH_HOUR_CARRY_NONNEGATIVE"] as const)(
  "renders %s in a compact semantic table with Hours opening native Details outside the table",
  (policy) => {
    const report = carryReport(policy);
    report.revision = 2;
    Object.assign(report.rows[0]!, {
      tutoringChange: 65.4 / 60,
      crewChange: 15 / 60,
      previousEditionAmount: 0,
    });
    const before = JSON.stringify(report);
    const doc = parse(renderSchoolHoursContent(report));
    const table = doc.querySelector<HTMLTableElement>(".school-hours-table")!;
    expect([...table.tHead!.rows[0]!.cells].map((n) => n.textContent)).toEqual([
      "Individual / 个人",
      "Carry In / 期初余量",
      "Raw Change / 原始变化Rounded to min / 四舍五入至分钟",
      "Hours / 入账时数",
      "Carry Out / 留待后续",
    ]);
    expect(table.tHead!.querySelectorAll('th[scope="col"]')).toHaveLength(5);
    expect(
      [...table.querySelector(".school-summary")!.children].map((cell) =>
        cell.getAttribute("data-label"),
      ),
    ).toEqual([
      "Individual / 个人",
      "Carry In / 期初余量",
      "Raw Change / 原始变化",
      "Hours / 入账时数",
      "Carry Out / 留待后续",
    ]);
    expect(table.querySelector('tbody th[scope="row"]')?.textContent).toContain(
      report.rows[0]!.exportName,
    );
    expect(table.querySelector("caption")?.textContent).toContain(
      "Individual school-account changes",
    );
    const region = doc.querySelector(".school-table-scroll")!;
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.getAttribute("aria-label")).toContain(
      "Individual school hours",
    );
    expect(doc.querySelector(".raw-duration")?.textContent).toBe("+1 h 20 min");
    expect(
      doc.querySelector(".school-summary .hours-button")?.textContent,
    ).toBe("+1.3 h");
    expect(doc.querySelector("dl,section.person")).toBeNull();
    const details = doc.querySelector<HTMLElement>(".person-details")!;
    const invoker = table.querySelector<HTMLButtonElement>(".hours-button")!;
    const fallback = table.querySelector<HTMLAnchorElement>(".hours-fallback")!;
    expect(invoker.type).toBe("button");
    expect(invoker.getAttribute("popovertarget")).toBe(details.id);
    expect(invoker.getAttribute("aria-haspopup")).toBe("dialog");
    expect(invoker.getAttribute("aria-label")).toBe(
      `+1.3 h · View details for ${report.rows[0]!.exportName} / 查看${report.rows[0]!.exportName}的详情`,
    );
    expect(fallback.getAttribute("href")).toBe(`#${details.id}`);
    expect(fallback.textContent).toBe(invoker.textContent);
    expect(fallback.getAttribute("aria-label")).toBe(
      invoker.getAttribute("aria-label"),
    );
    expect(details.getAttribute("popover")).toBe("auto");
    expect(details.getAttribute("role")).toBe("dialog");
    expect(details.closest("table")).toBeNull();
    const title = doc.getElementById(details.getAttribute("aria-labelledby")!)!;
    expect(title.tagName).toBe("H2");
    expect(title.textContent).toBe(
      `${report.rows[0]!.exportName} · Details / 详情`,
    );
    const close = details.querySelector<HTMLButtonElement>(
      ".person-popover-header button",
    )!;
    expect(close.getAttribute("popovertarget")).toBe(details.id);
    expect(close.getAttribute("popovertargetaction")).toBe("hide");
    expect(close.hasAttribute("autofocus")).toBe(true);
    expect(close.textContent).toBe("Close / 关闭");
    expect(table.querySelectorAll("tbody.person > tr")).toHaveLength(
      report.rows.length,
    );
    expect(table.querySelector("tbody.person > tr")?.children).toHaveLength(5);
    expect(
      doc.querySelector(".person-detail-row,details.person-details,script"),
    ).toBeNull();
    expect(details.querySelector("summary")).toBeNull();
    expect(details.textContent).toContain("Exact Raw Change");
    expect(details.textContent).toContain("+1.09 h");
    expect(details.textContent).toContain("+0.25 h");
    expect(details.querySelector(".edition-choices")).not.toBeNull();
    expect(doc.querySelector(".school-summary .edition-choices")).toBeNull();
    expect(doc.body.textContent).toContain("r1");
    expect(JSON.stringify(report)).toBe(before);
    expect(schoolHoursCsv(report).content).toContain("1.09");
  },
);

it("links every Hours invoker and fallback to one independent evidence popover", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot(3));
  const doc = parse(renderSchoolHoursContent(report));
  const people = [...doc.querySelectorAll("tbody.person")];
  const details = [...doc.querySelectorAll(".person-details")];
  expect(details).toHaveLength(people.length);
  expect(new Set(details.map((panel) => panel.id)).size).toBe(people.length);
  people.forEach((person, index) => {
    const button = person.querySelector(".hours-button")!;
    const fallback = person.querySelector(".hours-fallback")!;
    const panel = personDetails(doc, person);
    expect(panel.id).toBe(`school-hours-person-${index}-details`);
    expect(person.children).toHaveLength(1);
    expect(person.querySelector(".school-summary")?.children).toHaveLength(5);
    expect(fallback.textContent).toBe(button.textContent);
    expect(fallback.getAttribute("href")).toBe(`#${panel.id}`);
    expect(panel.querySelector(".school-account")?.textContent).toContain(
      report.rows[index]!.schoolAccountKey,
    );
    expect(panel.closest("table,tbody,tr,td")).toBeNull();
    expect(doc.querySelectorAll(`[id="${panel.id}"]`)).toHaveLength(1);
    expect(panel.querySelector(".edition-choices")).not.toBeNull();
  });
  expect(
    doc.querySelector(".person-detail-row,details.person-details,script"),
  ).toBeNull();
});

it.each(["en", "zh"] as const)(
  "renders %s report labels, instructions, exact evidence and metadata in the selected language",
  (locale) => {
    for (const policy of [
      undefined,
      "TENTH_HOUR_CARRY",
      "TENTH_HOUR_CARRY_NONNEGATIVE",
    ] as const) {
      for (const revision of [1, 3]) {
        const report = carryReport();
        report.postingPolicy = policy;
        report.revision = revision;
        report.includeStatistics = true;
        Object.assign(report.rows[0]!, {
          exportName: 'Synthetic <img src=x onerror="alert(1)"> & "School"',
          schoolAccountKey: 'Account <script>unsafe</script> & "school"',
          hoursToAdd: 0,
          monthAmount: 0,
          previousEditionAmount: 0.2,
          previousMonthAmount: 0.1,
          monthComparison: -0.1,
          unchanged: revision > 1,
          carryOutHours: "-1.3333333333333333",
          priorEditions: [
            { revision: 1, monthAmount: 1.3, correctionToCurrent: -1.3 },
            { revision: 2, monthAmount: 0.2, correctionToCurrent: -0.2 },
          ],
        });
        const before = JSON.stringify(report);
        const csv = schoolHoursCsv(report).content;
        const html = renderSchoolHoursContent(report, locale);
        const doc = parse(html);
        const button = doc.querySelector(".hours-button")!;
        const panel = doc.querySelector(".person-details")!;
        const text = doc.body.textContent!;
        expect(button.textContent).toBe("—");
        expect(button.getAttribute("aria-label")).toBe(
          locale === "en"
            ? `No posting · View details for ${report.rows[0]!.exportName}`
            : `无需入账 · 查看${report.rows[0]!.exportName}的详情`,
        );
        expect(
          button.querySelector(".no-posting")?.getAttribute("aria-label"),
        ).toBe(locale === "en" ? "No posting" : "无需入账");
        expect(doc.querySelector(".person-identity")?.textContent).toBe(
          report.rows[0]!.exportName,
        );
        expect(panel.querySelector(".school-account")?.textContent).toBe(
          `${locale === "en" ? "School account" : "学校账户"}: ${report.rows[0]!.schoolAccountKey}`,
        );
        expect(panel.querySelector("h2")?.textContent).toBe(
          `${report.rows[0]!.exportName} · ${locale === "en" ? "Details" : "详情"}`,
        );
        expect(panel.querySelector("button")?.textContent).toBe(
          locale === "en" ? "Close" : "关闭",
        );
        expect(panel.querySelector(".exact-posting")?.textContent).toBe(
          locale === "en" ? "Exact Hours: 0 h" : "精确入账时数: 0 小时",
        );
        expect(doc.querySelector(".raw-duration")?.getAttribute("title")).toBe(
          locale === "en" ? "Rounded to nearest minute" : "四舍五入至分钟",
        );
        expect(text).toContain(
          new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: report.timeZone,
          }).format(new Date(report.generatedAt)),
        );
        expect(text).toContain(
          locale === "en" ? "Optional program statistics" : "项目统计（可选）",
        );
        expect(text).toContain(
          locale === "en" ? "Previous-month comparison" : "与上月比较",
        );
        if (policy) {
          expect(doc.querySelector(".carry-out")?.textContent).toBe(
            locale === "en" ? "-80 min" : "-80 分钟",
          );
          expect(
            doc.querySelector(".carry-out span")?.getAttribute("title"),
          ).toBe(
            locale === "en"
              ? "-1.3333333333333333 h"
              : "-1.3333333333333333 小时",
          );
          expect(panel.textContent).toContain(
            locale === "en"
              ? "Exact Carry Out: -1.3333333333333333 h"
              : "精确期末余量: -1.3333333333333333 小时",
          );
          if (policy === "TENTH_HOUR_CARRY_NONNEGATIVE") {
            expect(
              doc.querySelector(".carry-explanation summary")?.textContent,
            ).toBe(locale === "en" ? "How carry works" : "余量计算方式");
            expect(text).toContain(
              locale === "en"
                ? "full negative balance automatically offsets future earned hours"
                : "全部负数余额自动抵扣今后获得的时数",
            );
          }
        } else {
          const missing = doc.querySelector(".carry-in span")!;
          expect(missing.getAttribute("aria-label")).toBe(
            locale === "en" ? "Carry not recorded" : "未记录余量",
          );
          expect(missing.getAttribute("title")).toBe(
            locale === "en"
              ? "Not recorded in this earlier report"
              : "此历史报告未记录余量",
          );
        }
        if (revision > 1) {
          const choices = panel.querySelector(".edition-choices")!;
          expect(choices.textContent).toContain(
            locale === "en" ? "r1 (+1.3 h)" : "r1 (+1.3 小时)",
          );
          expect(choices.textContent).toContain(
            locale === "en" ? "-1.3 h" : "-1.3 小时",
          );
          expect(choices.textContent).toContain(
            locale === "en" ? "Nothing applied" : "从未入账",
          );
          expect(choices.textContent).toContain(
            locale === "en" ? "0 h once" : "0 小时 一次",
          );
          expect(panel.textContent).toContain(
            locale === "en" ? "Unchanged since r2" : "与 r2 相比无变化",
          );
          expect(doc.querySelector(".edition-guidance")?.textContent).toContain(
            locale === "en"
              ? policy === "TENTH_HOUR_CARRY_NONNEGATIVE"
                ? "contact the program team before posting"
                : "Choose only one matching row"
              : policy === "TENTH_HOUR_CARRY_NONNEGATIVE"
                ? "请先联系项目团队"
                : "仅选符合情况的一项",
          );
        } else {
          expect(
            panel.querySelector(".posting-guidance")?.textContent,
          ).toContain(
            locale === "en"
              ? "Apply each person's highlighted amount"
              : "请将每个人突出显示的时数",
          );
        }
        if (locale === "en") {
          expect(html).not.toMatch(/[\u3400-\u9fff]/u);
        } else {
          // Participant/account values are saved evidence; UI wording alone changes.
          expect(text).not.toMatch(
            /Revision|Details|School account|Exact Hours|Previous month|Optional program statistics|Crew|\bmin\b|\bh\b/,
          );
        }
        expect(html).toContain("&lt;img");
        expect(html).toContain("&lt;script&gt;");
        expect(doc.querySelector("script,img,[onerror]")).toBeNull();
        expect(JSON.stringify(report)).toBe(before);
        expect(schoolHoursCsv(report).content).toBe(csv);
      }
    }
  },
);

it.each(["en", "zh"] as const)(
  "preserves saved multilingual names and exact numeric postings in the %s view",
  (locale) => {
    const report = carryReport();
    const row = report.rows[0]!;
    row.hoursToAdd = 1.7500000000000002;
    const before = JSON.stringify(report);
    const doc = parse(renderSchoolHoursContent(report, locale));
    expect(doc.querySelector(".person-identity")?.textContent).toBe(
      row.exportName,
    );
    expect(doc.querySelector(".hours-button")?.textContent).toBe(
      locale === "en" ? "+1.7500000000000002 h" : "+1.7500000000000002 小时",
    );
    const label =
      locale === "en"
        ? `+1.7500000000000002 h · View details for ${row.exportName}`
        : `+1.7500000000000002 小时 · 查看${row.exportName}的详情`;
    expect(doc.querySelector(".hours-button")?.getAttribute("aria-label")).toBe(
      label,
    );
    expect(
      doc.querySelector(".hours-fallback")?.getAttribute("aria-label"),
    ).toBe(label);
    expect(doc.querySelector(".hours-fallback")?.textContent).toBe(
      doc.querySelector(".hours-button")?.textContent,
    );
    expect(doc.querySelector(".raw-duration")?.textContent).toBe(
      locale === "en" ? "+1 h 20 min" : "+1 小时 20 分钟",
    );
    expect(doc.querySelector(".carry-out")?.textContent).toBe(
      locale === "en" ? "2 min" : "2 分钟",
    );
    expect(JSON.stringify(report)).toBe(before);
    expect(schoolHoursCsv(report).content).toContain(",1.7500000000000002,");
  },
);

it("rounds signed combined raw duration only to the nearest minute", () => {
  const report = carryReport();
  for (const [minutes, label] of [
    [80.4, "+1 h 20 min"],
    [80.6, "+1 h 21 min"],
    [-80.6, "-1 h 21 min"],
    [0, "0 h 0 min"],
  ] as const) {
    report.rows[0]!.tutoringChange = minutes / 60;
    const doc = parse(renderSchoolHoursContent(report));
    expect(doc.querySelector(".raw-duration")?.textContent).toBe(label);
    expect(doc.querySelector(".person-details")?.textContent).toContain(
      `${minutes > 0 ? "+" : ""}${minutes / 60} h`,
    );
  }
});

it.each([1, 2, 3])(
  "uses a labelled dash for zero Hours in revision %s without repeating long instructions",
  (revision) => {
    for (const policy of [
      undefined,
      "TENTH_HOUR_CARRY",
      "TENTH_HOUR_CARRY_NONNEGATIVE",
    ] as const) {
      const report = carryReport();
      report.revision = revision;
      report.postingPolicy = policy;
      Object.assign(report.rows[0]!, {
        hoursToAdd: 0,
        monthAmount: 0,
        carryInHours: "0",
        carryOutHours: "0",
      });
      const before = JSON.stringify(report);
      const doc = parse(renderSchoolHoursContent(report));
      const hours = doc.querySelector(".school-summary .hours-button")!;
      expect(hours.textContent).toBe("—");
      expect(hours.getAttribute("aria-label")).toBe(
        `No posting / 无需入账 · View details for ${report.rows[0]!.exportName} / 查看${report.rows[0]!.exportName}的详情`,
      );
      expect(
        doc.querySelector(".hours-fallback")?.getAttribute("aria-label"),
      ).toBe(hours.getAttribute("aria-label"));
      expect(
        doc.querySelector(".mobile-row-context,.person-detail-row"),
      ).toBeNull();
      expect(
        hours.querySelector(".no-posting")?.getAttribute("aria-label"),
      ).toBe("No posting / 无需入账");
      expect(
        doc.querySelector(".person-details .exact-posting")?.textContent,
      ).toBe("Exact Hours / 精确入账时数: 0 h");
      expect(doc.querySelectorAll(".posting-legend")).toHaveLength(1);
      expect(doc.querySelector(".posting-legend")?.textContent).toContain(
        "— in Hours means no posting",
      );
      expect(doc.querySelector(".school-summary")?.textContent).not.toContain(
        "Nothing to enter",
      );
      if (policy) {
        expect(doc.querySelector(".carry-in")?.textContent).toBe(
          "0 min / 分钟",
        );
        expect(doc.querySelector(".carry-out")?.textContent).toBe(
          "0 min / 分钟",
        );
      }
      if (revision > 1) {
        expect(doc.body.textContent).toContain(
          policy === "TENTH_HOUR_CARRY_NONNEGATIVE"
            ? `If r${revision - 1} was last entered for that person`
            : `Revision ${revision} replaces revision ${revision - 1}`,
        );
        expect(doc.body.textContent).toContain(
          policy === "TENTH_HOUR_CARRY_NONNEGATIVE"
            ? "choose ONE matching row"
            : "Choose only one matching row",
        );
        expect(doc.querySelector(".edition-choices")).not.toBeNull();
      }
      expect(JSON.stringify(report)).toBe(before);
      expect(schoolHoursCsv(report).content).toContain(
        `,${report.rows[0]!.schoolAccountKey},0,`,
      );
    }
  },
);

it("keeps full debt pending until future earnings offset it in saved reports and numeric CSV", () => {
  const report = carryReport("TENTH_HOUR_CARRY_NONNEGATIVE");
  const cases = [
    {
      raw: -80 / 60,
      carryIn: "0",
      carryOut: "-1.3333333333333333",
      posted: 0,
      minutes: "-80",
    },
    {
      raw: 40 / 60,
      carryIn: "-1.3333333333333333",
      carryOut: "-0.6666666666666667",
      posted: 0,
      minutes: "-40",
    },
    {
      raw: 50 / 60,
      carryIn: "-0.6666666666666667",
      carryOut: "0.0666666666666666",
      posted: 0.1,
      minutes: "4",
    },
  ];
  for (const [index, example] of cases.entries()) {
    report.revision = index + 1;
    Object.assign(report.rows[0]!, {
      tutoringChange: example.raw,
      hoursToAdd: example.posted,
      monthAmount: example.posted,
      previousEditionAmount: index === 0 ? null : 0,
      unchanged: index === 1,
      carryInHours: example.carryIn,
      carryOutHours: example.carryOut,
    });
    const saved = parse(renderSchoolHoursContent(report));
    expect(
      saved.querySelector(".school-summary .hours-button")?.textContent,
    ).toBe(example.posted === 0 ? "—" : "+0.1 h");
    expect(saved.querySelector(".carry-out")?.textContent).toBe(
      `${example.minutes} min / 分钟`,
    );
    expect(saved.body.textContent).toContain(
      "full negative balance automatically offsets future earned hours",
    );
    expect(saved.body.textContent).not.toContain(
      "Negative corrections are deductions",
    );
    const csv = schoolHoursCsv(report).content;
    expect(csv).toContain("0 = nothing to enter");
    expect(csv).toContain("full negative balance is retained automatically");
    expect(csv).toContain(example.carryOut);
    expect(csv).not.toContain("negative = deduct");
  }
});

it.each(["TENTH_HOUR_CARRY", "TENTH_HOUR_CARRY_NONNEGATIVE"] as const)(
  "preserves the frozen %s carry and correction guidance",
  (postingPolicy) => {
    const report = carryReport(postingPolicy);
    report.revision = 2;
    Object.assign(report.rows[0]!, {
      hoursToAdd: 0.1,
      monthAmount: 1.4,
      previousEditionAmount: 1.3,
      priorEditions: [
        { revision: 1, monthAmount: 1.3, correctionToCurrent: 0.1 },
      ],
    });
    const doc = parse(renderSchoolHoursContent(report));
    const explanation =
      doc.querySelector<HTMLDetailsElement>(".carry-explanation");
    if (postingPolicy === "TENTH_HOUR_CARRY_NONNEGATIVE") {
      expect(explanation?.open).toBe(false);
      expect(explanation?.querySelector("summary")?.textContent).toBe(
        "How carry works / 余量计算方式",
      );
      expect(explanation?.textContent).toContain(
        "Carry in + raw changes − posted change = carry out",
      );
      const introduction = doc.querySelector(".edition-guidance")!.textContent;
      expect(introduction).toContain("If r1 was last entered for that person");
      expect(introduction).toContain("choose ONE matching row");
      expect(introduction).toContain("If the last entered edition is unknown");
      expect(introduction).not.toContain(
        "earlier-edition correction or replacement amount is negative",
      );
    } else {
      expect(explanation).toBeNull();
      expect(doc.body.textContent).toContain(
        "Negative corrections are deductions",
      );
      expect(doc.body.textContent).toContain(
        "Carry in + raw changes − posted change = carry out",
      );
    }
  },
);

it("retains historical signed-edition alternatives in a nonnegative report", () => {
  const report = carryReport("TENTH_HOUR_CARRY_NONNEGATIVE");
  report.revision = 3;
  Object.assign(report.rows[0]!, {
    hoursToAdd: 0,
    monthAmount: 0,
    previousEditionAmount: 0,
    priorEditions: [
      { revision: 1, monthAmount: 1.3, correctionToCurrent: -1.3 },
      { revision: 2, monthAmount: 0, correctionToCurrent: 0 },
    ],
    carryOutHours: "-1.3333333333333333",
  });
  const saved = parse(renderSchoolHoursContent(report));
  expect(saved.querySelector(".edition-choices")?.textContent).toContain(
    "-1.3 h",
  );
  expect(saved.body.textContent).toContain(
    "If an earlier-edition correction or replacement amount is negative, contact the program team before posting",
  );
  const csv = schoolHoursCsv(report).content;
  expect(csv).toContain("Comparison from r1: correction to current amount");
  expect(csv).toContain(",-1.3,0,");
  expect(csv).not.toContain("correction to apply now");
});

it("keeps exact carry in saved evidence and CSV without exposing private projection data", () => {
  const report = carryReport();
  expect(report.rows[0]!.carryOutHours).toBe("0.0333333333333333");
  const saved = parse(renderSchoolHoursContent(report));
  expect(
    saved.querySelector('[title="0.0333333333333333 h"]')?.textContent,
  ).toBe("2 min / 分钟");
  expect(saved.querySelector(".person-details")?.textContent).toContain(
    "Exact Carry Out / 精确期末余量: 0.0333333333333333 h",
  );
  const csv = schoolHoursCsv(report).content;
  expect(csv).toContain("Carry in (exact hours; informational)");
  expect(csv).toContain("Carry out (exact hours; retained automatically)");
  expect(csv).toContain("0.0333333333333333");
  expect(csv).toContain("never post it separately");
  expect(JSON.stringify(report)).not.toContain("private-person");
  expect(JSON.stringify(report)).not.toContain("nameParts");
});

it("shows four new minutes releasing one tenth with distinct incoming and outgoing carry", () => {
  const report = carryReport();
  report.revision = 2;
  Object.assign(report.rows[0]!, {
    tutoringChange: 4 / 60,
    hoursToAdd: 0.1,
    monthAmount: 1.4,
    previousEditionAmount: 1.3,
    carryInHours: "0.0333333333333333",
    carryOutHours: "0",
  });
  const doc = parse(renderSchoolHoursContent(report));
  expect(doc.querySelector(".school-summary .hours-button")?.textContent).toBe(
    "+0.1 h",
  );
  expect(doc.querySelector(".carry-in")?.textContent).toBe("2 min / 分钟");
  expect(doc.querySelector(".raw-duration")?.textContent).toBe("+0 h 4 min");
  expect(doc.querySelector(".carry-out")?.textContent).toBe("0 min / 分钟");
  expect(doc.querySelector(".school-summary")?.textContent).not.toContain(
    "+1.4",
  );
});

it("preserves legacy signed values and distinguishes unrecorded carry from no posting", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot(2));
  expect(report).not.toHaveProperty("postingPolicy");
  expect(report.rows[0]).not.toHaveProperty("carryOutHours");
  expect(schoolHoursCsv(report).content).not.toContain("Carry out");
  const doc = parse(renderSchoolHoursContent(report));
  const missing = doc.querySelectorAll(
    '.school-summary [title^="Not recorded"]',
  );
  expect(missing).toHaveLength(report.rows.length * 2);
  for (const carry of missing) {
    expect(carry.textContent).toBe("—");
    expect(carry.getAttribute("aria-label")).toBe(
      "Carry not recorded / 未记录余量",
    );
  }
  expect(doc.querySelector(".no-posting")?.getAttribute("aria-label")).toBe(
    "No posting / 无需入账",
  );
  expect(doc.querySelector(".carry-explanation")).toBeNull();
  const first = parse(
    renderSchoolHoursContent(
      publicSchoolHoursReport(schoolHoursTestSnapshot()),
    ),
  );
  expect(
    [...first.querySelectorAll(".school-summary .hours-button")].map(
      (n) => n.textContent,
    ),
  ).toEqual(["+7 h", "-0.5 h"]);
});

it.each(["en", "zh"] as const)(
  "sends a %s shared-template notification with edition metadata, a CTA and fallback, and no report data",
  (locale) => {
    for (const revision of [1, 2, 3]) {
      const report = publicSchoolHoursReport(schoolHoursTestSnapshot(revision));
      const email = schoolHoursEmailCopy({ report, reportUrl, locale });
      const doc = parse(email.html);
      expect(doc.documentElement.lang).toBe(locale);
      expect(email.subject).toBe(
        locale === "zh"
          ? `2026年10月学校时数报告${revision > 1 ? "更新" : ""} · 第\u00a0${revision}\u00a0版`
          : `October 2026 school-hours report${revision > 1 ? " updated" : ""} · Revision ${revision}`,
      );
      expect(doc.querySelectorAll("a")).toHaveLength(2);
      const action = doc.querySelector(".body a");
      const fallback = doc.querySelector(".panel a");
      expect(action?.textContent).toBe(
        locale === "zh" ? "查看月度报告" : "View Month Report",
      );
      expect(action?.getAttribute("href")).toBe(reportUrl);
      expect(fallback?.getAttribute("href")).toBe(reportUrl);
      expect(fallback?.textContent).toBe(reportUrl);
      expect(doc.querySelector("h1")?.textContent).toBe(email.subject);
      // The issued timestamp may legitimately include the reporting month.
      // Only the separate report-period/revision metadata would duplicate H1.
      expect(doc.querySelector(".body")?.textContent).not.toContain(
        locale === "zh"
          ? `2026年10月 · 第\u00a0${revision}\u00a0版`
          : `October 2026 · Revision ${revision}`,
      );
      expect(doc.querySelector(".body")?.textContent).toContain(
        locale === "zh" ? "发出时间:" : "Issued:",
      );
      expect(doc.querySelector("body.canvas")?.getAttribute("style")).toContain(
        "background:#181B20",
      );
      expect(doc.querySelector(".card")?.getAttribute("bgcolor")).toBe(
        "#272D35",
      );
      expect(
        doc.querySelectorAll('table[role="presentation"]').length,
      ).toBeGreaterThan(0);
      expect(doc.querySelector(".footer-brand")?.textContent).toBeTruthy();
      expect(email.text).toContain(reportUrl);
      expect(email.text).toContain(locale === "zh" ? "发出时间:" : "Issued:");
      expect(email.text).toContain(
        locale === "zh" ? "2026年10月" : "October 2026",
      );
      expect(email.text).toContain("Asia/Shanghai");
      if (revision > 1)
        expect(email.text).toContain(
          locale === "zh"
            ? `替代第 ${revision - 1} 版`
            : `Replaces Revision ${revision - 1}`,
        );
      expect(
        doc.querySelector(
          ".person,table:not([role='presentation']),details,.email-amount,.email-carry-notice,.code,pre",
        ),
      ).toBeNull();
      const inbox = doc.querySelector(".preheader")!.textContent;
      expect(inbox).not.toBe(email.subject);
      for (const content of [email.html, email.text, inbox]) {
        for (const row of report.rows) {
          expect(content).not.toContain(row.exportName);
          expect(content).not.toContain(row.schoolAccountKey);
        }
        expect(content).not.toContain("private-person");
        expect(content).not.toContain("Raw tutoring change");
        expect(content).not.toContain("Tutoring net");
        expect(content).not.toContain("辅导原始变化");
        expect(content).not.toContain("Crew");
        expect(content).not.toContain("Carry");
        expect(content).not.toContain("+0.5");
      }
      if (locale === "en") {
        expect(doc.body.textContent).not.toMatch(/[\u3400-\u9fff]/u);
        expect(email.text).toContain("Delivery does not confirm school entry");
        expect(email.text).toContain("Anyone with the report link");
      } else {
        expect(doc.body.textContent).not.toContain("Revision");
        expect(email.text).not.toContain("View Month Report");
        expect(email.text).toContain("邮件送达不代表学校已完成入账");
        expect(email.text).toContain("持有报告链接的人无需账户即可查看");
      }
    }
  },
);

it.each(["en", "zh"] as const)(
  "does not read %s report rows, totals, statistics or posting policy when composing email",
  (locale) => {
    const report = carryReport();
    const before = JSON.stringify(report);
    const expected = schoolHoursEmailCopy({ report, reportUrl, locale });
    const metadataOnly = { ...report };
    for (const key of [
      "rows",
      "totals",
      "includeStatistics",
      "postingPolicy",
    ]) {
      Object.defineProperty(metadataOnly, key, {
        get() {
          throw new Error(`Email must not read ${key}`);
        },
      });
    }
    expect(
      schoolHoursEmailCopy({ report: metadataOnly, reportUrl, locale }),
    ).toEqual(expected);
    expect(JSON.stringify(report)).toBe(before);
  },
);

it("defaults to English, escapes branding, and keeps participant names only in the report", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
  const email = schoolHoursEmailCopy({
    brand: "Pilot <School>",
    report,
    reportUrl,
  });
  const doc = parse(email.html);
  expect(doc.documentElement.lang).toBe("en");
  expect(doc.querySelector("h1")?.textContent).toBe(email.subject);
  expect(doc.querySelector(".footer-brand")?.textContent).toBe(
    "Pilot <School>",
  );
  expect(email.html).toContain("Pilot &lt;School&gt;");
  expect(email.html).not.toContain("Pilot <School>");
  expect(email.html).not.toContain("Blair");
  expect(email.text).not.toContain("Alexander");
  const saved = renderSchoolHoursContent(report);
  expect(saved).toContain("Blair &lt;Synthetic&gt;");
  expect(saved).not.toContain("Blair <Synthetic>");
  expect(parse(saved).querySelector(".person-identity")?.textContent).toContain(
    'Alexander "Alex" Chen (陈安)',
  );
  expect(email.html).toContain("background:#181B20");
  expect(email.html).toContain("background:#272D35");
  expect(email.html).toContain("background:#0D59E6");
});

it("escapes the shared-template action and optional canonical footer icon without adding code panels", () => {
  const report = carryReport();
  const url = `${reportUrl}?first=1&note=%22synthetic%22`;
  const iconUrl = "https://school.example.test/icon.png?first=1&second=2";
  const email = schoolHoursEmailCopy({
    brand: 'Pilot <School> & "Program"',
    iconUrl,
    report,
    reportUrl: url,
  });
  const doc = parse(email.html);
  expect(doc.querySelector(".footer-icon")?.getAttribute("src")).toBe(iconUrl);
  expect(doc.querySelector(".footer-icon")?.getAttribute("alt")).toBe(
    'Pilot <School> & "Program" icon',
  );
  for (const link of doc.querySelectorAll("a"))
    expect(link.getAttribute("href")).toBe(url);
  expect(email.html).toContain("first=1&amp;note=%22synthetic%22");
  expect(email.html).toContain("first=1&amp;second=2");
  expect(doc.querySelector(".code,pre,script")).toBeNull();
  expect(email.text).toContain(url);
  expect(
    parse(schoolHoursEmailCopy({ report, reportUrl }).html).querySelector(
      ".footer-icon",
    ),
  ).toBeNull();
  expect(() =>
    schoolHoursEmailCopy({ report, reportUrl: "javascript:alert(1)" }),
  ).toThrow("Email actions require an HTTP(S) URL.");
});

it.each([
  1.7500000000000002,
  3.5833333333333335,
  28.041666666666668,
  4.083333333333334,
  1 / 12,
  -1 / 60,
  1e-16,
  -1e-16,
  1.0000000000000002e-6,
  -0.0000010000000000000002,
  -Number.MAX_VALUE,
  Number.MIN_VALUE,
])(
  "retains exact %s Hours in the saved report and numeric CSV without snapshot mutation",
  async (value) => {
    const snapshot = schoolHoursTestSnapshot();
    snapshot.rows = [
      { ...snapshot.rows[0]!, hoursToAdd: value, monthAmount: value },
    ];
    const frozen = JSON.stringify(snapshot);
    const report = publicSchoolHoursReport(snapshot);
    const exact = `${value > 0 ? "+" : ""}${value} h`;
    const doc = parse(renderSchoolHoursContent(report));
    expect(
      doc.querySelector(".school-summary .hours-button")?.textContent,
    ).toBe(exact);
    expect(
      doc.querySelector(".school-summary .hours-button")?.textContent,
    ).not.toContain("≈");
    expect(
      doc.querySelector(".person-details .exact-posting")?.textContent,
    ).toBe(`Exact Hours / 精确入账时数: ${exact}`);
    const savedHtml = await schoolHoursHtmlResponse(
      report,
      "synthetic-token",
    ).text();
    expect(savedHtml).toContain(exact);
    expect(schoolHoursCsv(report).content).toContain(`,${value},`);
    expect(JSON.stringify(snapshot)).toBe(frozen);
  },
);

it("keeps complete r1-to-r3 correction choices behind Details and in numeric CSV", () => {
  const snapshot = schoolHoursTestSnapshot(3);
  Object.assign(snapshot.rows[0]!, {
    hoursToAdd: 0.2,
    monthAmount: 7.7,
    previousEditionAmount: 7.5,
    priorEditions: [
      { revision: 1, monthAmount: 7, correctionToCurrent: 0.7 },
      { revision: 2, monthAmount: 7.5, correctionToCurrent: 0.2 },
    ],
  });
  const report = publicSchoolHoursReport(snapshot);
  const before = JSON.stringify(report);
  const saved = renderSchoolHoursContent(report);
  const doc = parse(saved);
  expect(doc.querySelector(".school-summary .hours-button")?.textContent).toBe(
    "+0.2 h",
  );
  expect(doc.querySelector(".person-details .edition-choices")).not.toBeNull();
  expect(saved).toContain("Last applied edition / 最后入账版本");
  expect(saved).toMatch(/r1 \(\+7 h\)<\/th><td[^>]*>\+0.7 h<\/td>/);
  expect(saved).toMatch(/r2 \(\+7.5 h\)<\/th><td[^>]*>\+0.2 h<\/td>/);
  expect(saved).toContain("+7.7 h once / 一次");
  const csv = schoolHoursCsv(report).content;
  expect(csv).toContain("If last applied r1: correction to apply now");
  expect(csv).toContain("If last applied r2: correction to apply now");
  expect(csv).toContain("Never add alternatives");
  expect(JSON.stringify(report)).toBe(before);
});

it("retains unchanged revision rows and offsetting zero-net changes with exact Details", () => {
  const revision = publicSchoolHoursReport(schoolHoursTestSnapshot(2));
  const doc = parse(renderSchoolHoursContent(revision));
  expect(doc.querySelectorAll("tbody.person")).toHaveLength(3);
  const unchanged = [...doc.querySelectorAll("tbody.person")].find((row) =>
    row
      .querySelector(".person-identity")
      ?.textContent?.includes("Casey Synthetic"),
  )!;
  expect(unchanged.querySelector(".hours-button")?.textContent).toBe("—");
  expect(personDetails(doc, unchanged).textContent).toContain(
    "Unchanged since r1",
  );
  const snapshot = schoolHoursTestSnapshot();
  const zero = snapshot.rows[2]!;
  zero.unchanged = false;
  zero.current = { earned: 3, extras: 0, deductions: 1, crew: 0 };
  zero.change = { earned: 1, extras: 0, deductions: 1, crew: 0 };
  const report = publicSchoolHoursReport(snapshot);
  const saved = parse(renderSchoolHoursContent(report));
  expect(saved.querySelectorAll("tbody.person")).toHaveLength(3);
  const zeroRow = [...saved.querySelectorAll("tbody.person")].find((row) =>
    row
      .querySelector(".person-identity")
      ?.textContent?.includes("Casey Synthetic"),
  )!;
  expect(zeroRow.querySelector(".hours-button")?.textContent).toBe("—");
  expect(personDetails(saved, zeroRow).textContent).toContain(
    "Exact Raw Change / 精确原始变化: 0 h",
  );
  expect(schoolHoursCsv(report).content).toContain("Casey Synthetic");
});

it("keeps optional statistics in the saved report, omits unchanged first-issue rows, and excludes private evidence", () => {
  const snapshot = schoolHoursTestSnapshot();
  snapshot.includeStatistics = true;
  const report = publicSchoolHoursReport(snapshot);
  const saved = renderSchoolHoursContent(report);
  expect(parse(saved).querySelectorAll("tbody.person")).toHaveLength(2);
  expect(saved).not.toContain("Casey Synthetic");
  expect(saved).toContain("Optional program statistics");
  const email = schoolHoursEmailCopy({ report: snapshot, reportUrl });
  expect(email.html).not.toContain("Optional program statistics");
  for (const content of [
    saved,
    email.html,
    email.text,
    schoolHoursCsv(report).content,
  ]) {
    expect(content).not.toContain("private-person");
    expect(content).not.toContain("private-previous-report");
    expect(content).not.toContain("private-replaced-report");
    expect(content).not.toContain("nameParts");
  }
  expect(saved).toContain("email only notifies you that it is ready");
});

it.each(["en", "zh"] as const)(
  "renders safe %s notification previews with the same metadata and no active link",
  (locale) => {
    const report = publicSchoolHoursReport(schoolHoursTestSnapshot(2));
    const previewUrl = `${reportUrl}?token=synthetic-preview-secret`;
    const actual = schoolHoursEmailCopy({ report, reportUrl, locale });
    const preview = schoolHoursEmailCopy({
      report,
      reportUrl: previewUrl,
      locale,
      preview: true,
    });
    expect(preview.subject).toBe(actual.subject);
    const actualDoc = parse(actual.html);
    const previewDoc = parse(preview.html);
    expect(previewDoc.querySelector("a,[href]")).toBeNull();
    const previewAction =
      locale === "zh"
        ? "查看月度报告 (仅供预览)"
        : "View Month Report (preview only)";
    expect(previewDoc.querySelector(".body")?.textContent).toContain(
      previewAction,
    );
    expect(previewDoc.querySelector(".panel a,.code,pre")).toBeNull();
    expect(`${preview.html}${preview.text}`).not.toContain(previewUrl);
    expect(`${preview.html}${preview.text}`).not.toContain(
      "synthetic-preview-secret",
    );
    expect(previewDoc.querySelector("h1")?.textContent).toBe(
      actualDoc.querySelector("h1")?.textContent,
    );
    expect(
      previewDoc.querySelector(".person,table:not([role='presentation'])"),
    ).toBeNull();
    expect(preview.text).toContain(
      locale === "zh" ? "仅供预览" : "preview only",
    );
  },
);

it("retains CSV formula protection, frozen names and signed exact values", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
  report.rows[0]!.exportName = '\t＝SUM(1,2) "Synthetic"';
  report.rows[0]!.schoolAccountKey = "@unsafe-account";
  const csv = schoolHoursCsv(report);
  expect(csv.content).toContain('"\'\t＝SUM(1,2) ""Synthetic"""');
  expect(csv.content).toContain('"\'@unsafe-account"');
  expect(csv.content).toContain(",-0.5,-0.5,0,");
  expect(csv.filename).toBe("program-2026-10-r1.csv");
  expect(csv.content).not.toContain("private-person");
});

it("allows native recipient forms without exposing capability referrers cross-site", async () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
  const personal = schoolHoursHtmlResponse(report, "synthetic-personal", {
    recipientPanel: "<section>synthetic reminder form</section>",
  });
  expect(personal.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(personal.headers.get("Content-Security-Policy")).toContain(
    "form-action 'self'",
  );
  expect(await personal.text()).toContain(
    '<meta name="referrer" content="same-origin">',
  );
  const shared = schoolHoursHtmlResponse(report, "synthetic-shared");
  expect(shared.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(shared.headers.get("Content-Security-Policy")).toContain(
    "form-action 'none'",
  );
  expect(await shared.text()).toContain(
    '<meta name="referrer" content="no-referrer">',
  );
});

it.each([2, 3])(
  "keeps revision %s exact alternatives wrapping in both columns of popover Details",
  (revision) => {
    const report = publicSchoolHoursReport(schoolHoursTestSnapshot(revision));
    const person = report.rows[0]!;
    const exact = 0.23333333333333334;
    Object.assign(person, {
      monthAmount: 7.233333333333333,
      previousEditionAmount: 7.016666666666667,
      monthComparison: exact,
      priorEditions: [
        {
          revision: 1,
          monthAmount: 7.016666666666667,
          correctionToCurrent: exact,
        },
      ],
    });
    const doc = parse(renderSchoolHoursContent(report));
    const choices = doc.querySelector<HTMLTableElement>(".edition-choices")!;
    expect(choices.textContent).toContain("r1 (+7.016666666666667 h)");
    expect(choices.textContent).toContain(`+${exact} h`);
    expect(choices.textContent).toContain("+7.233333333333333 h once");
    const tables = doc.querySelectorAll<HTMLTableElement>(
      ".edition-choices,.month-comparison",
    );
    expect(tables.length).toBe(report.rows.length + 1);
    for (const table of tables) {
      expect(table.style.tableLayout).toBe("fixed");
      expect(table.style.width).toBe("100%");
      for (const cell of table.querySelectorAll<HTMLElement>("th,td")) {
        expect(cell.style.overflowWrap).toBe("anywhere");
        expect(cell.style.wordBreak).toBe("break-word");
      }
    }
  },
);
