import { db } from "~/server/db";
import {
  getSchoolHoursRecipientState,
  SchoolHoursRecipientFault,
} from "~/server/school-hours-recipient";
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
  if (token.startsWith("v2.")) {
    try {
      const state = await getSchoolHoursRecipientState(db, token);
      return schoolHoursCsvResponse(state.report);
    } catch (error) {
      if (error instanceof SchoolHoursRecipientFault)
        return schoolHoursUnavailableResponse(
          error.code === "retired" ? "retired" : "unavailable",
        );
      return new Response(null, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }
  const result = await retrieveSchoolHoursReport(db, token);
  return result.status === "ready"
    ? schoolHoursCsvResponse(result.report)
    : schoolHoursUnavailableResponse(result.status);
}
