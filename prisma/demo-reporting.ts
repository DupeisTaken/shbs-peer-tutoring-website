import type { PrismaClient } from "../generated/prisma";
import { programDateTimeInput } from "../src/lib/program-time";
import {
  generateSchoolHours,
  previewSchoolHours,
  reviewSchoolHoursBaseline,
  saveSchoolHoursSettings,
  schoolHoursBaselinePreview,
} from "../src/server/school-hours";
import { seedId } from "./demo-support";

export const DEMO_REPORT_REQUEST_ID = "3728c704-7d4e-47a4-af73-9e41f39348e1";
export const DEMO_REPORT_GENERATION_KEY = `manual:${seedId("user-admin")}:${DEMO_REPORT_REQUEST_ID}`;

/** Exercise the real accounting chain while retaining its immutable first issue.
 * Enable, generate and disable in one transaction: no worker can observe a
 * deliverable fixture or an enabled automatic schedule, even with SMTP configured. */
export async function seedSchoolHoursReport(db: PrismaClient) {
  await db.$transaction(
    async (tx) => {
      if (
        await tx.schoolHoursReport.findUnique({
          where: { generationKey: DEMO_REPORT_GENERATION_KEY },
        })
      )
        return;
      if (await tx.schoolHoursReport.count()) {
        throw new Error(
          "Use a fresh demo database for the synthetic school-report fixture; existing report history is never replaced.",
        );
      }
      const actorId = seedId("user-admin");
      const baseline = await schoolHoursBaselinePreview(tx);
      await reviewSchoolHoursBaseline(
        tx,
        {
          expectedContentHash: baseline.contentHash,
          expectedBaselineVersion: baseline.baselineVersion,
          acknowledged: true,
          reason:
            "Synthetic demo: no service hours have previously been reported to school.",
          participants: baseline.participants.map((participant) => ({
            beneficiaryId: participant.beneficiaryId,
            schoolAccountKey: `demo-${participant.beneficiaryId}`,
            reviewed: true,
            earned: 0,
            extras: 0,
            deductions: 0,
            crew: 0,
          })),
        },
        actorId,
      );
      const config = await tx.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      });
      const settings = {
        recipientEmails: ["school-report@example.test"],
        timeZone: config.timeZone,
        includeStatistics: true,
        dateOverrides: {},
      };
      const enabled = await saveSchoolHoursSettings(
        tx,
        {
          ...settings,
          enabled: true,
          expectedVersion: config.version,
        },
        actorId,
      );
      const month = programDateTimeInput(new Date(), config.timeZone).slice(
        0,
        7,
      );
      const preview = await previewSchoolHours(tx, month);
      await generateSchoolHours(
        tx,
        {
          month,
          expectedVersion: preview.configVersion,
          expectedBaselineVersion: preview.baselineVersion,
          expectedHeadId: preview.expectedHeadId,
          expectedContentHash: preview.contentHash,
          requestId: DEMO_REPORT_REQUEST_ID,
          reason:
            "Synthetic first school issue for inspecting participant balances, statistics and CSV export.",
        },
        actorId,
      );
      await saveSchoolHoursSettings(
        tx,
        {
          ...settings,
          enabled: false,
          expectedVersion: enabled.config.version,
        },
        actorId,
      );
    },
    { isolationLevel: "RepeatableRead", timeout: 60_000 },
  );
}
