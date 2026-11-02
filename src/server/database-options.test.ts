import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { schedulingPgOptions } from "./database-options";
import { utcDatabaseUrl } from "./database-url";
import { readPublicationValidationSnapshot } from "./session-planning/publication-validation";

const taggedSql =
  "WITH /* shbs:publication-validation */ parameters AS (SELECT $1::text AS id) SELECT id FROM parameters";

describe("publication statement preparation", () => {
  it("names only the tagged statement, hashing all SQL and ignoring bound values", () => {
    const first = { sql: taggedSql, args: ["synthetic-first-participant"] };
    const second = { sql: taggedSql, args: ["synthetic-second-participant"] };
    const name = schedulingPgOptions.statementNameGenerator(first);
    expect(name).toMatch(/^shbs_pub_[a-f0-9]{40}$/);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(schedulingPgOptions.statementNameGenerator(first)).toBe(name);
    expect(schedulingPgOptions.statementNameGenerator(second)).toBe(name);
    expect(name).not.toContain(first.args[0]);
    expect(
      schedulingPgOptions.statementNameGenerator({ sql: `${taggedSql}\n` }),
    ).not.toBe(name);
    for (const sql of [
      "SELECT $1::text",
      taggedSql.replace("/* shbs:publication-validation */ ", ""),
      "SELECT 'WITH /* shbs:publication-validation */ parameters AS'",
      "WITH /* another-statement */ parameters AS (SELECT 1) SELECT * FROM parameters",
    ])
      expect(schedulingPgOptions.statementNameGenerator({ sql })).toBe("");
  });

  it("prepares the actual Prisma statement per connection while rereading later transaction writes", async () => {
    assertIsolatedTestDatabase(process.env.DATABASE_URL);
    const client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
          max: 1,
        },
        schedulingPgOptions,
      ),
    });
    const rollback = new Error("Roll back prepared-publication fixture");
    try {
      await client.$transaction(
        async (tx) => {
          const prefix = `prepared-publication-${randomUUID()}`;
          const tutor = await tx.tutor.create({
            data: { englishName: "Synthetic prepared tutor" },
          });
          const student = await tx.tutee.create({
            data: { englishName: "Synthetic prepared learner" },
          });
          const term = await tx.term.create({
            data: { name: prefix, schoolYear: prefix, quarter: "Q1" },
          });
          const plan = await tx.sessionPlan.create({
            data: {
              generationKey: prefix,
              tutorId: tutor.id,
              termId: term.id,
              originalDate: "2096-10-06",
              timeZone: "UTC",
              sourceFingerprint: prefix,
            },
          });
          const cohort = await tx.sessionPlanCohort.create({
            data: {
              planId: plan.id,
              date: plan.originalDate,
              startMin: 900,
              endMin: 945,
              startsAt: new Date("2096-10-06T15:00:00Z"),
              endsAt: new Date("2096-10-06T15:45:00Z"),
            },
          });
          const input = {
            tutorId: tutor.id,
            termId: term.id,
            originalDate: plan.originalDate,
            date: plan.originalDate,
            participantIds: [student.id],
            startsAt: cohort.startsAt,
            endsAt: cohort.endsAt,
            startMin: cohort.startMin,
            endMin: cohort.endMin,
            roomId: null,
          };
          let first:
            | Awaited<ReturnType<typeof readPublicationValidationSnapshot>>
            | undefined;
          for (let i = 0; i < 6; i++) {
            const result = await readPublicationValidationSnapshot(tx, input);
            first ??= result;
            expect(
              result.cohorts.find((row) => row.id === cohort.id)?.participants,
            ).toEqual([]);
          }
          const prepared = await tx.$queryRaw<
            {
              name: string;
              statement: string;
              executions: number;
            }[]
          >`
          SELECT name, statement, (generic_plans+custom_plans)::integer AS executions
          FROM pg_prepared_statements WHERE name LIKE 'shbs_pub_%'
        `;
          expect(prepared).toHaveLength(1);
          expect(prepared[0]!.name).toBe(
            schedulingPgOptions.statementNameGenerator({
              sql: prepared[0]!.statement,
            }),
          );
          expect(prepared[0]!.executions).toBeGreaterThanOrEqual(6);

          const participant = await tx.sessionPlanParticipant.create({
            data: { planId: plan.id, cohortId: cohort.id, tuteeId: student.id },
          });
          const occupied = await readPublicationValidationSnapshot(tx, input);
          expect(
            occupied.cohorts.find((row) => row.id === cohort.id)?.participants,
          ).toEqual([{ tuteeId: student.id }]);
          await tx.sessionPlanParticipant.update({
            where: { id: participant.id },
            data: { status: "CANCELLED" },
          });
          expect(
            (await readPublicationValidationSnapshot(tx, input)).cohorts.find(
              (row) => row.id === cohort.id,
            )?.participants,
          ).toEqual([]);
          expect(
            first!.cohorts.find((row) => row.id === cohort.id)?.participants,
          ).toEqual([]);
          expect(
            occupied.cohorts.find((row) => row.id === cohort.id)?.participants,
          ).toEqual([{ tuteeId: student.id }]);
          throw rollback;
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await client.$disconnect();
    }
  });
});
