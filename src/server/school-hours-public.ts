import type { DomainDb } from "~/server/transactions";
import { toCsv } from "~/lib/csv";
import { schoolHoursVisibleRows } from "~/lib/school-hours-visibility";
import { schoolHoursPriorEditions } from "~/lib/school-hours-corrections";
import { schoolHoursSnapshotSchema } from "./school-hours-input";
import {
  parseSchoolHoursToken,
  schoolHoursTokenMatches,
} from "./school-hours-link";
import {
  escapeSchoolHours,
  renderSchoolHoursContent,
  schoolHoursHeading,
  type SchoolHoursPublicReport,
} from "./school-hours-email";

/** Deliberate allowlist: no participant/source IDs, opening balances, name-part
 * provenance, recipient lists, token metadata or management decisions cross it. */
export function publicSchoolHoursReport(
  snapshot: unknown,
): SchoolHoursPublicReport {
  const parsed = schoolHoursSnapshotSchema.parse(snapshot);
  const visibleRows = schoolHoursVisibleRows(parsed);
  return {
    month: parsed.month,
    revision: parsed.revision,
    generatedAt: parsed.generatedAt,
    timeZone: parsed.timeZone,
    includeStatistics: parsed.includeStatistics,
    ...(parsed.postingPolicy ? { postingPolicy: parsed.postingPolicy } : {}),
    rows: visibleRows.map((row) => ({
      exportName: row.exportName,
      schoolAccountKey: row.schoolAccountKey,
      tutoringChange: row.tutoringChange,
      crewChange: row.crewChange,
      hoursToAdd: row.hoursToAdd,
      monthAmount: row.monthAmount,
      previousEditionAmount: row.previousEditionAmount,
      previousMonthAmount: row.previousMonthAmount,
      monthComparison: row.monthComparison,
      unchanged: row.unchanged,
      priorEditions: row.priorEditions.map((edition) => ({
        revision: edition.revision,
        monthAmount: edition.monthAmount,
        correctionToCurrent: edition.correctionToCurrent,
      })),
      ...(parsed.postingPolicy === "TENTH_HOUR_CARRY" ||
      parsed.postingPolicy === "TENTH_HOUR_CARRY_NONNEGATIVE"
        ? { carryInHours: row.carryInHours, carryOutHours: row.carryOutHours }
        : {}),
    })),
    totals: {
      people: visibleRows.length,
      tutoringChange: parsed.totals.tutoringChange,
      crewChange: parsed.totals.crewChange,
      hoursToAdd: parsed.totals.hoursToAdd,
      monthAmount: parsed.totals.monthAmount,
    },
  };
}

export async function retrieveSchoolHoursReport(
  db: DomainDb,
  token: string,
): Promise<
  | { status: "ready"; report: SchoolHoursPublicReport }
  | { status: "unavailable" | "retired" }
> {
  const parsed = parseSchoolHoursToken(token);
  if (!parsed) return { status: "unavailable" };
  const row = await db.schoolHoursReport.findUnique({
    where: { id: parsed.reportId },
    select: {
      snapshot: true,
      linkVersion: true,
      linkTokenHash: true,
      linkRevokedAt: true,
      supersededById: true,
    },
  });
  if (
    row?.linkVersion !== parsed.linkVersion ||
    !schoolHoursTokenMatches(token, row.linkTokenHash)
  )
    return { status: "unavailable" };
  if (row.linkRevokedAt || row.supersededById) return { status: "retired" };
  return { status: "ready", report: publicSchoolHoursReport(row.snapshot) };
}

export const schoolHoursResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
} as const;

function htmlDocument(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><meta name="referrer" content="no-referrer"><title>${escapeSchoolHours(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#F1F5F9;color:#0F172A;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:840px;margin:auto;padding:32px 20px 56px}h1{font-size:clamp(25px,5vw,36px);line-height:1.2;letter-spacing:-.025em}a.button{display:inline-block;padding:13px 18px;background:#0D59E6;color:white;border-radius:8px;text-decoration:none;font-weight:700}a:focus-visible,summary:focus-visible{outline:3px solid #2563EB;outline-offset:4px}.privacy{font-size:13px;line-height:1.7;color:#475569;border-top:1px solid #CBD5E1;margin-top:28px;padding-top:16px}th,td{font-variant-numeric:tabular-nums}.school-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0;font-size:14px}.school-summary>div{min-width:0;padding:10px;border-radius:8px;overflow-wrap:anywhere}.school-summary dt{font-size:12px;color:#475569;line-height:1.6}.school-summary dd{margin:6px 0 0;font-weight:650;font-variant-numeric:tabular-nums}.school-summary .posting{background:#EFF6FF}.person-details{margin-top:12px;border-top:1px solid #CBD5E1}@media(min-width:680px){.school-summary{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:480px){main{padding:20px 12px 40px}.person{padding:14px!important}td,th{min-width:90px}}@media print{body{background:white}main{padding:0}.button,.privacy{display:none}.person{break-inside:avoid}details{display:none}.person-details{display:block}.person-details::details-content{content-visibility:visible}.person-details>summary{display:none!important}}</style></head><body><main>${content}</main></body></html>`;
}

export function schoolHoursUnavailableResponse(
  status: "unavailable" | "retired",
) {
  return new Response(
    htmlDocument(
      "Report unavailable / 报告不可用",
      "<h1>Report unavailable / 报告不可用</h1><p>This link is invalid, revoked or belongs to an edition that has been replaced. Ask the program team for the latest View Month Report link.</p><p>此链接无效、已撤销或属于已被替代的报告版本。请向项目团队索取最新的 View Month Report 链接。</p>",
    ),
    {
      status: status === "retired" ? 410 : 404,
      headers: {
        ...schoolHoursResponseHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export function schoolHoursHtmlResponse(
  report: SchoolHoursPublicReport,
  token: string,
) {
  const download = `/reports/service-hours/${encodeURIComponent(token)}/csv`;
  return new Response(
    htmlDocument(
      schoolHoursHeading(report.month),
      `<p style="color:#475569">Individual school-account changes / 个人学校账户时数变化</p><h1>${escapeSchoolHours(schoolHoursHeading(report.month))}</h1>${renderSchoolHoursContent(report)}<p style="margin-top:24px"><a class="button" href="${escapeSchoolHours(download)}" rel="noreferrer">Download CSV / 下载 CSV</a></p><p class="privacy">Anyone possessing this link can view this saved report. Share it only with intended school recipients. Report access grants no account or management access.<br>任何持有此链接的人均可查看本报告。请仅向预期学校收件人分享；此链接不授予账户或管理权限。</p>`,
    ),
    {
      headers: {
        ...schoolHoursResponseHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export function schoolHoursCsv(report: SchoolHoursPublicReport) {
  const nonnegativePolicy =
    report.postingPolicy === "TENTH_HOUR_CARRY_NONNEGATIVE";
  const carryPolicy =
    report.postingPolicy === "TENTH_HOUR_CARRY" || nonnegativePolicy;
  const visibleRows = schoolHoursVisibleRows(report);
  const priorRevisions = [
    ...new Set(
      visibleRows.flatMap((row) =>
        schoolHoursPriorEditions(row, report.revision).map(
          (edition) => edition.revision,
        ),
      ),
    ),
  ].sort((a, b) => a - b);
  const rows: (string | number | null)[][] = [
    [
      "Report month",
      "Revision",
      "Individual",
      "School account",
      nonnegativePolicy
        ? report.revision > 1
          ? `Correction ONLY if r${report.revision - 1} was last applied (0 = nothing to enter)`
          : "Hours to apply once (0 = nothing to enter)"
        : report.revision > 1
          ? `Correction ONLY if r${report.revision - 1} was last applied (negative = deduct)`
          : "Hours to apply once (negative = deduct)",
      carryPolicy
        ? "Raw tutoring change (hours; not extra credit)"
        : "Tutoring breakdown",
      carryPolicy
        ? "Raw Crew change (hours; not extra credit)"
        : "Crew breakdown",
      "If nothing applied: replacement month amount once (alternative)",
      "Previous edition amount",
      "Unchanged since preceding edition",
      "Previous month amount (informational)",
      "Month comparison (informational)",
      "Application guidance",
      ...priorRevisions.map((revision) =>
        nonnegativePolicy
          ? `Comparison from r${revision}: correction to current amount (choose ONE alternative)`
          : `If last applied r${revision}: correction to apply now (choose ONE alternative)`,
      ),
      ...(carryPolicy
        ? [
            "Carry in (exact hours; informational)",
            "Carry out (exact hours; retained automatically)",
            "Posting policy",
          ]
        : []),
    ],
  ];
  for (const row of visibleRows)
    rows.push([
      report.month,
      report.revision,
      row.exportName,
      row.schoolAccountKey,
      row.hoursToAdd,
      row.tutoringChange,
      row.crewChange,
      row.monthAmount,
      row.previousEditionAmount,
      row.unchanged ? "Yes" : "No",
      row.previousMonthAmount,
      row.monthComparison,
      nonnegativePolicy
        ? report.revision > 1
          ? "Choose only the last applied edition's correction OR the replacement amount if nothing applied. Never add alternatives. If unknown or not listed, ask the program team. A highlighted 0 means nothing to enter now. If an earlier-edition correction is negative, contact the program team before posting."
          : "Apply this individual's amount once. A 0 means nothing to enter now. Raw changes and carry are informational; do not enter them separately."
        : report.revision > 1
          ? "Choose only the last applied edition's correction OR the replacement amount if nothing applied. Never add alternatives. If unknown or not listed, ask the program team."
          : carryPolicy
            ? "Apply this individual's amount once. Raw changes and carry are informational; do not enter them separately."
            : "Apply this individual's amount once; the breakdown is not extra credit.",
      ...priorRevisions.map(
        (revision) =>
          schoolHoursPriorEditions(row, report.revision).find(
            (edition) => edition.revision === revision,
          )?.correctionToCurrent ?? null,
      ),
      ...(carryPolicy
        ? [
            row.carryInHours ?? null,
            row.carryOutHours ?? null,
            nonnegativePolicy
              ? "Post in 0.1 h (6 min) increments. A 0 means nothing to enter now. Carry in + raw changes - posted change = carry out. The full negative balance is retained automatically and automatically offsets future earned hours; never post it separately."
              : "Post in 0.1 h (6 min) increments. Carry in + raw changes - posted change = carry out. Carry is retained automatically; never post it separately.",
          ]
        : []),
    ]);
  return {
    filename: `program-${report.month}-r${report.revision}.csv`,
    content: `\uFEFF${toCsv(rows)}\r\n`,
  };
}
export function schoolHoursCsvResponse(report: SchoolHoursPublicReport) {
  const csv = schoolHoursCsv(report);
  return new Response(csv.content, {
    headers: {
      ...schoolHoursResponseHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
    },
  });
}
