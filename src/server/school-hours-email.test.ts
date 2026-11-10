// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { EmailLocale } from "~/lib/email-locale";
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
const unit = (locale: EmailLocale) => (locale === "zh" ? "小时" : "h");

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

it.each(["en", "zh"] as const)(
  "keeps full debt pending until future earnings offset it in %s deliveries",
  (locale) => {
    const report = carryReport("TENTH_HOUR_CARRY_NONNEGATIVE");
    const cases = [
      {
        raw: -80 / 60,
        carryIn: "0",
        carryOut: "-1.3333333333333333",
        posted: 0,
        minutes: "80",
      },
      {
        raw: 40 / 60,
        carryIn: "-1.3333333333333333",
        carryOut: "-0.6666666666666667",
        posted: 0,
        minutes: "40",
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
      const email = schoolHoursEmailCopy({ report, reportUrl, locale });
      const doc = parse(email.html);
      const card = doc.querySelector(".person")!;
      expect(card.querySelector(".email-amount")?.textContent).toBe(
        `${example.posted === 0 ? "0" : "+0.1"} ${unit(locale)}`,
      );
      expect(card.textContent).toContain(
        locale === "zh" ? `${example.minutes} 分钟` : `${example.minutes} min`,
      );
      expect(email.text).toContain(
        locale === "zh"
          ? "负数余额全额结转，自动抵扣今后获得的时数"
          : "full negative balance automatically offsets future earned hours",
      );
      expect(email.text).not.toContain(
        locale === "zh" ? "负数表示扣减" : "Negative amounts deduct hours",
      );
      expect(doc.querySelector(".email-guidance")?.textContent).not.toContain(
        locale === "zh"
          ? "0 表示本次无需入账"
          : "A 0 means nothing to enter now",
      );
      if (example.posted === 0) {
        expect(card.textContent).toContain(
          locale === "zh" ? "本次无需入账" : "Nothing to enter now",
        );
        expect(card.textContent).toContain(
          locale === "zh"
            ? `待抵扣余额：${example.minutes} 分钟`
            : `Balance to offset future earnings: ${example.minutes} min`,
        );
        expect(card.textContent).not.toContain("Deduction carried forward");
      }
      const csv = schoolHoursCsv(report).content;
      expect(csv).toContain("0 = nothing to enter");
      expect(csv).toContain("full negative balance is retained automatically");
      expect(csv).toContain(example.carryOut);
      expect(csv).not.toContain("negative = deduct");
      const saved = renderSchoolHoursContent(report);
      expect(saved).toContain(
        "full negative balance automatically offsets future earned hours",
      );
      expect(saved).not.toContain("Negative corrections are deductions");
    }
  },
);

it.each(["TENTH_HOUR_CARRY", "TENTH_HOUR_CARRY_NONNEGATIVE"] as const)(
  "keeps public carry explanation appropriate to the frozen %s policy",
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
      const introduction = doc.body.querySelector("div")!.textContent;
      expect(introduction).toContain("If r1 was last entered for that person");
      expect(introduction).toContain("choose ONE matching row");
      expect(introduction).toContain("If the last entered edition is unknown");
      expect(introduction).not.toContain(
        "earlier-edition correction or replacement amount is negative",
      );
      expect(doc.querySelector(".person")?.textContent).toContain(
        "Carry in / 期初余量",
      );
      expect(doc.querySelector(".person")?.textContent).toContain(
        "Carry out / 留待后续",
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
  expect(schoolHoursCsv(report).content).toContain(
    "Comparison from r1: correction to current amount",
  );
  expect(schoolHoursCsv(report).content).toContain(",-1.3,0,");
  expect(schoolHoursCsv(report).content).not.toContain(
    "correction to apply now",
  );
  const email = schoolHoursEmailCopy({ report, reportUrl });
  expect(parse(email.html).querySelector(".email-amount")?.textContent).toBe(
    "0 h",
  );
  expect(email.text).not.toContain("-1.3 h");
});

it.each(["en", "zh"] as const)(
  "posts exact tenths with one concise %s carry notice",
  (locale) => {
    const report = carryReport();
    const email = schoolHoursEmailCopy({ report, reportUrl, locale });
    const doc = parse(email.html);
    expect(email.subject).toBe(
      locale === "zh"
        ? "2026年10月学校时数报告 · 第 1 版"
        : "October 2026 school-hours report · Revision 1",
    );
    const legacyHeading = parse(
      schoolHoursEmailCopy({
        report: { ...report, postingPolicy: undefined },
        reportUrl,
        locale,
      }).html,
    ).querySelector("h1")?.textContent;
    expect(doc.querySelector("h1")?.textContent).toBe(legacyHeading);
    expect(doc.querySelector(".email-amount")?.textContent).toBe(
      `+1.3 ${unit(locale)}`,
    );
    expect(doc.querySelector(".email-carry-notice")?.textContent).toContain(
      locale === "zh" ? "0.1 小时（6 分钟）" : "0.1 h (6 min)",
    );
    expect(email.text).toContain(
      locale === "zh" ? "自动保留" : "retained automatically",
    );
    expect(doc.querySelector(".person")?.textContent).not.toContain("0.033333");
    expect(doc.querySelector(".person")?.textContent).toContain(
      locale === "zh" ? "留待后续：2 分钟" : "Carried forward: 2 min",
    );
    expect(email.html).not.toContain("1.333333");
    expect(email.text).not.toContain("≈");
    if (locale === "en")
      expect(doc.querySelector(".email-carry-notice")?.textContent).not.toMatch(
        /[\u3400-\u9fff]/u,
      );
    else
      expect(
        doc.querySelector(".email-carry-notice")?.textContent,
      ).not.toContain("School hours");
  },
);

it.each(["en", "zh"] as const)(
  "explains zero posting in %s without exposing a decimal tail",
  (locale) => {
    const report = carryReport();
    Object.assign(report.rows[0]!, { hoursToAdd: 0, monthAmount: 0 });
    const email = schoolHoursEmailCopy({ report, reportUrl, locale });
    const card = parse(email.html).querySelector(".person")!;
    expect(card.textContent).toContain(
      locale === "zh"
        ? "本次无需入账。 留待后续：2 分钟"
        : "Nothing to enter now. Carried forward: 2 min",
    );
    expect(card.textContent).not.toContain("0.033333");
    expect(card.querySelector(".email-amount")?.textContent).toBe(
      `0 ${unit(locale)}`,
    );
  },
);

it.each(["en", "zh"] as const)(
  "names negative carry as a pending deduction in %s",
  (locale) => {
    const report = carryReport();
    Object.assign(report.rows[0]!, {
      hoursToAdd: -1.3,
      carryOutHours: "-0.0333333333333333",
    });
    for (const posted of [-1.3, 0]) {
      report.rows[0]!.hoursToAdd = posted;
      const email = schoolHoursEmailCopy({ report, reportUrl, locale });
      const card = parse(email.html).querySelector(".person")!;
      expect(card.textContent).toContain(
        locale === "zh"
          ? "待扣减余量：2 分钟"
          : "Deduction carried forward: 2 min",
      );
      expect(card.textContent).not.toContain("-2 min");
      expect(card.textContent).not.toContain("-0.033333");
      if (posted === 0)
        expect(card.textContent).toContain(
          locale === "zh" ? "本次无需入账" : "Nothing to enter now",
        );
    }
  },
);

it.each([1, 2])(
  "labels a carried zero instruction as nothing to enter in saved revision %s",
  (revision) => {
    const report = carryReport();
    report.revision = revision;
    Object.assign(report.rows[0]!, { hoursToAdd: 0, monthAmount: 0 });
    const saved = parse(renderSchoolHoursContent(report)).querySelector(
      ".person",
    )!;
    expect(saved.textContent).toContain("Nothing to enter now");
    expect(saved.textContent).not.toContain("Hours to add to this account");
    if (revision > 1) {
      expect(saved.textContent).toContain("if r1 was last applied");
      expect(
        parse(schoolHoursEmailCopy({ report, reportUrl }).html).querySelector(
          ".person",
        )?.textContent,
      ).toContain("if Revision 1 was last entered");
    }
  },
);

it("keeps exact carry in saved evidence and CSV without exposing private projection data", () => {
  const report = carryReport();
  expect(report.postingPolicy).toBe("TENTH_HOUR_CARRY");
  expect(report.rows[0]!.carryOutHours).toBe("0.0333333333333333");
  const saved = parse(renderSchoolHoursContent(report));
  expect(
    saved.querySelector('.person [title="0.0333333333333333 h"]')?.textContent,
  ).toBe("2 min / 分钟");
  expect(saved.querySelector(".person")?.textContent).toContain(
    "Raw tutoring change",
  );
  const csv = schoolHoursCsv(report).content;
  expect(csv).toContain("Carry in (exact hours; informational)");
  expect(csv).toContain("Carry out (exact hours; retained automatically)");
  expect(csv).toContain("0.0333333333333333");
  expect(csv).toContain("never post it separately");
  expect(JSON.stringify(report)).not.toContain("private-person");
  expect(JSON.stringify(report)).not.toContain("nameParts");
});

it("shows the next four minutes releasing one tenth without adding carry as credit", () => {
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
  const email = schoolHoursEmailCopy({ report, reportUrl });
  const card = parse(email.html).querySelector(".person")!;
  expect(card.querySelector(".email-amount")?.textContent).toBe("+0.1 h");
  expect(card.textContent).not.toContain("2 min");
  expect(card.textContent).not.toContain("+1.4");
  expect(renderSchoolHoursContent(report)).toContain("Carry in / 期初余量");
});

it("keeps legacy reports free of carry policy, columns and notices", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
  expect(report).not.toHaveProperty("postingPolicy");
  expect(report.rows[0]).not.toHaveProperty("carryOutHours");
  expect(schoolHoursCsv(report).content).not.toContain("Carry out");
  expect(renderSchoolHoursContent(report)).not.toContain("Carry in");
  expect(schoolHoursEmailCopy({ report, reportUrl }).html).not.toContain(
    "email-carry-notice",
  );
});

it("defaults to English and escapes public branding and participant names", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
  const email = schoolHoursEmailCopy({
    brand: "Pilot <School>",
    report,
    reportUrl,
  });
  const doc = parse(email.html);
  expect(doc.documentElement.lang).toBe("en");
  expect(doc.querySelector("h1")?.textContent).toBe(
    "The Program October Report is ready",
  );
  expect(doc.querySelector("a")?.textContent).toBe("View Month Report");
  expect(email.html).toContain("Pilot &lt;School&gt;");
  expect(email.html).not.toContain("Pilot <School>");
  expect(email.html).toContain("Blair &lt;Synthetic&gt;");
  expect(email.html).not.toContain("Blair <Synthetic>");
  expect(email.text).toContain('Alexander "Alex" Chen (陈安)');
  expect(email.html).toContain("background:#EAF0F7");
  expect(email.html).toContain("background:#F8FAFC");
  expect(email.html).toContain("background:#0D59E6");
});

it.each(["en", "zh"] as const)(
  "uses only %s fixed copy for first issues and both correction editions",
  (locale) => {
    for (const revision of [1, 2, 3]) {
      const report = publicSchoolHoursReport(schoolHoursTestSnapshot(revision));
      const email = schoolHoursEmailCopy({ report, reportUrl, locale });
      const doc = parse(email.html);
      expect(doc.documentElement.lang).toBe(locale);
      expect(doc.querySelector(".person h2")?.textContent).toBe(
        report.rows[0]!.exportName,
      );
      expect(doc.querySelector(".email-amount")?.textContent).toContain(
        unit(locale),
      );
      expect(doc.querySelector("a")?.textContent).toBe(
        locale === "zh" ? "查看月度报告" : "View Month Report",
      );
      const inboxPreview = doc.querySelector(".email-preheader")!.textContent;
      expect(inboxPreview).not.toBe(email.subject);
      expect(inboxPreview).not.toContain(report.rows[0]!.exportName);
      expect(inboxPreview).not.toContain(report.rows[0]!.schoolAccountKey);
      const guidance = doc.querySelector(".email-guidance")!.textContent;
      if (locale === "en") {
        expect(guidance).not.toMatch(/[\u3400-\u9fff]/u);
        expect(email.subject).not.toMatch(/[\u3400-\u9fff]/u);
        expect(email.text).toContain("School account:");
        expect(email.text).toContain("Issued:");
        expect(email.text).not.toContain("学校账户");
      } else {
        expect(guidance).not.toContain("Revision");
        expect(email.subject).not.toContain("school-hours");
        expect(email.text).toContain("学校账户:");
        expect(email.text).toContain("发出时间:");
        expect(email.text).not.toContain("School account");
        expect(email.text).not.toContain("View Month Report");
      }
      expect(email.text).toContain("Asia/Shanghai");
      if (revision > 1) {
        expect(email.subject).toContain(
          locale === "zh" ? `第 ${revision} 版` : `Revision ${revision}`,
        );
        expect(email.text).toContain(
          locale === "zh"
            ? `替代第 ${revision - 1} 版`
            : `Replaces Revision ${revision - 1}`,
        );
        expect(guidance).toContain(
          locale === "zh"
            ? `仅适用于最后入账第 ${revision - 1} 版的个人`
            : `only if Revision ${revision - 1} was last entered for that person`,
        );
        expect(guidance).toContain(
          locale === "zh"
            ? "若不确定最后入账版本，请先联系项目团队"
            : "If the last entered edition is unknown, contact the program first",
        );
        expect(guidance).toContain(
          locale === "zh"
            ? "若入账的是更早版本或从未入账"
            : "For an earlier edition or no entry",
        );
      } else {
        expect(guidance).toContain(
          locale === "zh" ? "每人时数仅入账一次" : "Hours to enter once",
        );
      }
      expect(guidance).toContain(
        locale === "zh" ? "负数表示扣减" : "Negative amounts deduct hours",
      );
    }
  },
);

it.each([
  1.7500000000000002,
  3.5833333333333335,
  28.041666666666668,
  4.083333333333334,
  1 / 12,
  -1 / 60,
  1e-16,
  -1e-16,
])(
  "includes the exact %s delta once per person without approximation or snapshot mutation",
  async (value) => {
    const snapshot = schoolHoursTestSnapshot();
    snapshot.rows = [
      {
        ...snapshot.rows[0]!,
        hoursToAdd: value,
        monthAmount: value,
        tutoringChange: value,
        crewChange: 0,
      },
    ];
    const frozen = JSON.stringify(snapshot);
    const report = publicSchoolHoursReport(snapshot);
    const exact = `${value > 0 ? "+" : ""}${value}`;
    for (const locale of ["en", "zh"] as const) {
      const email = schoolHoursEmailCopy({ report, reportUrl, locale });
      const doc = parse(email.html);
      const amount = doc.querySelector<HTMLElement>(".email-amount")!;
      expect(amount.textContent).toBe(`${exact} ${unit(locale)}`);
      expect(
        amount.querySelector<HTMLElement>(".email-value")?.style.whiteSpace,
      ).toBe("nowrap");
      expect(email.text.split(`${exact} ${unit(locale)}`)).toHaveLength(2);
      expect(
        doc.querySelector(".person")!.textContent.split(exact),
      ).toHaveLength(2);
      expect(amount.style.overflowWrap).toBe("anywhere");
      expect(amount.style.wordBreak).toBe("break-word");
      expect(email.html).not.toContain("≈");
      expect(email.text).not.toContain("≈");
      expect(email.html).not.toContain("approximate");
      expect(email.html).not.toContain("约数");
    }
    const savedHtml = await schoolHoursHtmlResponse(
      report,
      "synthetic-token",
    ).text();
    expect(savedHtml).toContain(`${exact} h`);
    expect(schoolHoursCsv(report).content).toContain(`,${value},`);
    expect(JSON.stringify(snapshot)).toBe(frozen);
  },
);

it.each(["en", "zh"] as const)(
  "keeps ordinary %s amounts at the legacy size and long exact amounts indivisible",
  (locale) => {
    for (const value of [
      7,
      -0.5,
      1 / 60,
      -1 / 60,
      1.0000000000000002e-6,
      -0.0000010000000000000002,
      -Number.MAX_VALUE,
      Number.MIN_VALUE,
    ]) {
      const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
      report.rows = [{ ...report.rows[0]!, hoursToAdd: value }];
      const email = schoolHoursEmailCopy({ report, reportUrl, locale });
      const doc = parse(email.html);
      const amount = doc.querySelector<HTMLElement>(".email-amount")!;
      const exactValue = amount.querySelector<HTMLElement>(".email-value")!;
      const exact = `${value > 0 ? "+" : ""}${value} ${unit(locale)}`;
      expect(exactValue.textContent).toBe(exact);
      expect(exactValue.style.whiteSpace).toBe("nowrap");
      expect(exactValue.children).toHaveLength(0);
      expect(doc.querySelectorAll(".email-value")).toHaveLength(1);
      expect(email.text.split(exact)).toHaveLength(2);
      const fontSize = Number.parseFloat(amount.style.fontSize);
      if (value === 7 || value === -0.5 || value === Number.MIN_VALUE)
        expect(fontSize).toBe(30);
      else {
        expect(fontSize).toBeGreaterThanOrEqual(14);
        expect(fontSize).toBeLessThanOrEqual(16);
      }
      expect(exactValue.hasAttribute("title")).toBe(false);
      expect(amount.style.textOverflow).toBe("");
    }
  },
);

it("retains saved-report precision evidence and approximate summaries without copying them into email", async () => {
  const snapshot = schoolHoursTestSnapshot();
  const value = 1 / 12;
  snapshot.rows[0]!.hoursToAdd = value;
  snapshot.rows[0]!.monthAmount = value;
  snapshot.rows[0]!.tutoringChange = value;
  const report = publicSchoolHoursReport(snapshot);
  const email = schoolHoursEmailCopy({ report, reportUrl });
  const savedHtml = await schoolHoursHtmlResponse(
    report,
    "synthetic-token",
  ).text();
  expect(email.html).not.toContain("≈");
  expect(savedHtml).toContain("≈ +0.0833 h");
  expect(savedHtml).toContain(`Exact / 精确值: +${value} h`);
  expect(schoolHoursCsv(report).content).toContain(`,${value},`);
});

it.each(["en", "zh"] as const)(
  "keeps %s email compact while preserving complete r1-to-r3 choices in the saved report and CSV",
  (locale) => {
    const snapshot = schoolHoursTestSnapshot(3);
    const person = snapshot.rows[0]!;
    person.hoursToAdd = 0.2;
    person.monthAmount = 7.7;
    person.previousEditionAmount = 7.5;
    person.priorEditions = [
      { revision: 1, monthAmount: 7, correctionToCurrent: 0.7 },
      { revision: 2, monthAmount: 7.5, correctionToCurrent: 0.2 },
    ];
    const report = publicSchoolHoursReport(snapshot);
    const before = JSON.stringify(report);
    const email = schoolHoursEmailCopy({ report, reportUrl, locale });
    const doc = parse(email.html);
    expect(doc.querySelector(".person .email-amount")?.textContent).toBe(
      `+0.2 ${unit(locale)}`,
    );
    expect(email.text).not.toContain(`+0.7 ${unit(locale)}`);
    expect(email.text).not.toContain(`+7.7 ${unit(locale)}`);
    expect(
      doc.querySelector("table,details,.edition-choices,.month-comparison"),
    ).toBeNull();
    expect(email.text).not.toContain("Tutoring net");
    expect(email.text).not.toContain("辅导净额");
    const saved = renderSchoolHoursContent(report);
    expect(saved).toContain("Last applied edition / 最后入账版本");
    expect(saved).toMatch(/r1 \(\+7 h\)<\/th><td[^>]*>\+0.7 h<\/td>/);
    expect(saved).toMatch(/r2 \(\+7.5 h\)<\/th><td[^>]*>\+0.2 h<\/td>/);
    expect(saved).toContain("+7.7 h once / 一次");
    expect(schoolHoursCsv(report).content).toContain(
      "If last applied r1: correction to apply now",
    );
    expect(schoolHoursCsv(report).content).toContain(
      "If last applied r2: correction to apply now",
    );
    expect(schoolHoursCsv(report).content).toContain("Never add alternatives");
    expect(JSON.stringify(report)).toBe(before);
  },
);

it.each(["en", "zh"] as const)(
  "keeps unchanged revision participants and offsetting zero-net changes explicit in %s",
  (locale) => {
    const revision = publicSchoolHoursReport(schoolHoursTestSnapshot(2));
    const revisionMail = schoolHoursEmailCopy({
      report: revision,
      reportUrl,
      locale,
    });
    const revisionDoc = parse(revisionMail.html);
    expect(revisionDoc.querySelectorAll(".person")).toHaveLength(3);
    const unchanged = [...revisionDoc.querySelectorAll(".person")].find(
      (row) => row.querySelector("h2")?.textContent === "Casey Synthetic",
    )!;
    expect(unchanged.querySelector(".email-amount")?.textContent).toBe(
      `0 ${unit(locale)}`,
    );
    expect(unchanged.textContent).toContain(
      locale === "zh" ? "请勿重复入账" : "Do not enter again",
    );
    const snapshot = schoolHoursTestSnapshot();
    const zero = snapshot.rows[2]!;
    zero.unchanged = false;
    zero.current = { earned: 3, extras: 0, deductions: 1, crew: 0 };
    zero.change = { earned: 1, extras: 0, deductions: 1, crew: 0 };
    const report = publicSchoolHoursReport(snapshot);
    const email = schoolHoursEmailCopy({ report, reportUrl, locale });
    const zeroRow = [...parse(email.html).querySelectorAll(".person")].find(
      (row) => row.querySelector("h2")?.textContent === "Casey Synthetic",
    )!;
    expect(zeroRow.querySelector(".email-amount")?.textContent).toBe(
      `0 ${unit(locale)}`,
    );
    expect(zeroRow.textContent).toContain(
      locale === "zh" ? "净变化为零" : "No net change",
    );
    expect(schoolHoursCsv(report).content).toContain("Casey Synthetic");
  },
);

it("keeps optional statistics in the saved report, excludes private evidence and omits unchanged first-issue rows", () => {
  const snapshot = schoolHoursTestSnapshot();
  snapshot.includeStatistics = true;
  const report = publicSchoolHoursReport(snapshot);
  const email = schoolHoursEmailCopy({ report: snapshot, reportUrl });
  expect(parse(email.html).querySelectorAll(".person")).toHaveLength(2);
  expect(email.text).not.toContain("Casey Synthetic");
  expect(email.html).not.toContain("Optional program statistics");
  expect(renderSchoolHoursContent(report)).toContain(
    "Optional program statistics",
  );
  for (const content of [email.html, email.text]) {
    expect(content).not.toContain("private-person");
    expect(content).not.toContain("private-previous-report");
    expect(content).not.toContain("private-replaced-report");
  }
  expect(email.text).toContain("Delivery does not confirm school entry");
  expect(email.text).toContain("Anyone with the report link");
});

it.each(["en", "zh"] as const)(
  "renders safe %s previews with the same compact accounting content",
  (locale) => {
    const report = publicSchoolHoursReport(schoolHoursTestSnapshot(2));
    const actual = schoolHoursEmailCopy({ report, reportUrl, locale });
    const preview = schoolHoursEmailCopy({
      report,
      reportUrl: "#preview",
      locale,
      preview: true,
    });
    expect(preview.subject).toBe(actual.subject);
    const actualDoc = parse(actual.html);
    const previewDoc = parse(preview.html);
    expect(previewDoc.querySelector("a,[href]")).toBeNull();
    expect(
      previewDoc.querySelector('[aria-disabled="true"]')?.textContent,
    ).toBe(locale === "zh" ? "查看月度报告" : "View Month Report");
    expect(`${preview.html}${preview.text}`).not.toContain("#preview");
    expect(
      [...previewDoc.querySelectorAll(".person")].map((row) => row.outerHTML),
    ).toEqual(
      [...actualDoc.querySelectorAll(".person")].map((row) => row.outerHTML),
    );
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

it.each([2, 3])(
  "keeps full-precision revision %s saved-report choices wrapping in both table columns",
  (revision) => {
    const report = publicSchoolHoursReport(schoolHoursTestSnapshot(revision));
    const person = report.rows[0]!;
    const exact = 0.23333333333333334;
    person.monthAmount = 7.233333333333333;
    person.previousEditionAmount = 7.016666666666667;
    person.monthComparison = exact;
    person.priorEditions = [
      {
        revision: 1,
        monthAmount: 7.016666666666667,
        correctionToCurrent: exact,
      },
    ];
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
