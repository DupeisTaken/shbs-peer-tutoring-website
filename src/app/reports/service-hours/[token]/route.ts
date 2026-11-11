import { db } from "~/server/db";
import {
  getSchoolHoursRecipientResponse,
  postSchoolHoursRecipientResponse,
} from "~/server/school-hours-recipient-route";
import {
  retrieveSchoolHoursReport,
  schoolHoursHtmlResponse,
  schoolHoursUnavailableResponse,
} from "~/server/school-hours-public";
import { parseSchoolHoursReportLocale } from "~/server/school-hours-report-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bearer access grants this fixed saved report only. No session, redirect,
 * tracking asset or request-Host-derived link is needed. Recipient links add
 * mailbox-bound self-service; a shared legacy token remains read-only. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const locale =
    parseSchoolHoursReportLocale(
      new URL(request.url).searchParams.get("lang"),
    ) ?? "en";
  if (token.startsWith("v2."))
    return getSchoolHoursRecipientResponse(request, token);
  const result = await retrieveSchoolHoursReport(db, token);
  return result.status === "ready"
    ? schoolHoursHtmlResponse(result.report, token, { locale })
    : schoolHoursUnavailableResponse(result.status, locale);
}

/** Next otherwise synthesizes HEAD through GET. Never treat it as an opening. */
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (token.startsWith("v2."))
    return getSchoolHoursRecipientResponse(request, token, true);
  const response = await GET(request, { params: Promise.resolve({ token }) });
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return postSchoolHoursRecipientResponse(request, token);
}
