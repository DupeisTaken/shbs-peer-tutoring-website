import { db } from "~/server/db";
import {
  retrieveSchoolHoursReport,
  schoolHoursHtmlResponse,
  schoolHoursUnavailableResponse,
} from "~/server/school-hours-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bearer access grants this fixed saved report only. No session, redirect,
 * tracking asset or request-Host-derived link is needed. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await retrieveSchoolHoursReport(db, token);
  return result.status === "ready"
    ? schoolHoursHtmlResponse(result.report, token)
    : schoolHoursUnavailableResponse(result.status);
}
