import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "./db";
import { applyRecords } from "./record-transfer";
import { importedRecordKey } from "./imported-records";
import { lockUsernameNamespace } from "./auth/username-namespace";
import { recordCsv } from "~/lib/record-transfer";
import { databaseScope } from "./db-scope";
import { createCaller } from "./api/root";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

it("imports a composite historical panel into a native terminal interview without permitting a new award", async () => {
  const prefix = `interview-import-${randomUUID()}`;
  const applicationId = `${prefix}-application`;
  const tutors = [0, 1, 2].map((key) => `${prefix}-panel-${key}`);
  const actorId = `${tutors[0]!}-user`;
  const completedAt = new Date("2026-09-01T06:00:00Z");
  const rollback = new Error("Rollback synthetic composite interview import");
  try {
    await db.$transaction(
      async (tx) =>
        databaseScope.run(tx as unknown as typeof db, async () => {
          for (const key of ["INTERVIEWS", "SERVICE_HOURS"] as const)
            await tx.programFeature.upsert({
              where: { key },
              create: { key, enabled: true },
              update: { enabled: true },
            });
          await tx.tutor.createMany({
            data: tutors.map((id) => ({
              id,
              englishName: "Synthetic panelist",
              status: "ACTIVE",
            })),
          });
          await tx.user.createMany({
            data: tutors.map((id, index) => ({
              id: `${id}-user`,
              email: `${id}@example.test`,
              role: index === 0 ? "HEAD" : "TUTOR",
              tutorId: id,
            })),
          });
          const subjectId = `${prefix}-subject`;
          await tx.subject.create({
            data: { id: subjectId, name: "Synthetic interview subject" },
          });
          await tx.tutorQualification.create({
            data: {
              tutorId: tutors[0]!,
              subjectId,
              status: "APPROVED",
              approvedById: actorId,
            },
          });
          await tx.qualificationGrant.create({
            data: {
              tutorId: tutors[0]!,
              sourceSubjectId: subjectId,
              subjectId,
            },
          });
          await tx.tutorApplication.create({
            data: {
              id: applicationId,
              name: "Synthetic completed applicant",
              email: `${prefix}@example.test`,
              status: "ACCEPTED",
              interviewCompletedAt: completedAt,
              interviewDurationMin: 30,
              interviewSchoolYear: "26-27",
              interviewQuarter: "Q1",
            },
          });
          await tx.applicationSubjectIntent.create({
            data: { applicationId, subjectId },
          });
          await tx.interviewAssignment.createMany({
            data: tutors
              .slice(1)
              .map((tutorId) => ({ applicationId, tutorId, attended: true })),
          });
          await tx.serviceHourAdjustment.createMany({
            data: tutors.slice(1).map((tutorId) => ({
              id: `interview_${applicationId}_${tutorId}`,
              tutorId,
              type: "EXTRA",
              reason: "Completed interview service",
              amount: 0.5,
              month: "2026-09",
              schoolYear: "26-27",
              quarter: "Q1",
            })),
          });
          const archivedPanel = {
            applicationId,
            tutorId: tutors[0]!,
            isHead: true,
            attended: false,
          };
          await lockUsernameNamespace(tx);
          await applyRecords(tx, [
            {
              name: "InterviewAssignment.csv",
              text: recordCsv(Object.keys(archivedPanel), [archivedPanel]),
            },
          ]);
          expect(
            await tx.importedRecordProvenance.findUnique({
              where: {
                entity_recordId: {
                  entity: "InterviewAssignment",
                  recordId: importedRecordKey(archivedPanel, [
                    "applicationId",
                    "tutorId",
                  ]),
                },
              },
            }),
          ).not.toBeNull();
          expect(
            await tx.importedRecordProvenance.findUnique({
              where: {
                entity_recordId: {
                  entity: "TutorApplication",
                  recordId: applicationId,
                },
              },
            }),
          ).toBeNull();
          const reviewed = await tx.tutorApplication.findUniqueOrThrow({
            where: { id: applicationId },
          });
          const api = createCaller({
            db: tx as unknown as typeof db,
            headers: new Headers(),
            session: {
              user: { id: actorId },
              role: "HEAD",
              tutorId: tutors[0]!,
              expires: "2099-01-01",
            },
          });
          await expect(
            api.interviewManagement.complete({
              applicationId,
              expectedUpdatedAt: reviewed.updatedAt,
              completedAt,
              durationMin: 60,
              attendedTutorIds: tutors,
              reason: "Synthetic attempt to reissue imported panel credit",
            }),
          ).rejects.toMatchObject({
            code: "CONFLICT",
            message: expect.stringContaining(
              "imported historical evidence",
            ) as unknown,
          });
          expect(
            await tx.serviceHourAdjustment.count({
              where: { tutorId: { in: tutors } },
            }),
          ).toBe(2);
          expect(
            await tx.tutorApplication.findUniqueOrThrow({
              where: { id: applicationId },
            }),
          ).toMatchObject({ interviewDurationMin: 30 });
          throw rollback;
        }),
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
