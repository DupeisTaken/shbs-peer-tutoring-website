import { db } from "~/server/db";
import {
  retrieveSchoolHoursReport,
  schoolHoursCsvResponse,
  schoolHoursUnavailableResponse,
} from "~/server/school-hours-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await retrieveSchoolHoursReport(db, token);
  return result.status === "ready"
    ? schoolHoursCsvResponse(result.report)
    : schoolHoursUnavailableResponse(result.status);
}
