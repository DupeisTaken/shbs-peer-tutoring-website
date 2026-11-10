import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("migrates each delivery-language owner with a constrained English default, leaving codes and attempts unchanged", () => {
  const models = ["User", "ViewerSignup", "CrewSignupVerification", "CrewApplication", "TutorApplication", "StudentSurvey", "StudentSignupIntent", "AccountInvitation", "TuteeHistoryInvitation", "HistoricalRecordInvitation"];
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../prisma/migrations/20261110010000_email_locale/migration.sql", import.meta.url), "utf8");
  for (const model of models) {
    const body = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].find(match => match[1] === model)?.[2];
    expect(body, model).toMatch(/emailLocale\s+String\s+@default\("en"\)/);
    expect(migration).toContain(`ALTER TABLE "${model}" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en'`);
    expect(migration).toContain(`CONSTRAINT "${model}_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'))`);
  }
  expect([...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map(match => match[1])).toEqual(models);
  expect(migration).not.toMatch(/UPDATE|DELETE|CREATE TYPE|DROP/i);
});
