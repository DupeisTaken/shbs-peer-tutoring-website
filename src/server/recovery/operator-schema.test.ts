import { describe, expect, it } from "vitest";
import {
  assertReviewedRecoverySchema,
  reviewedRecoverySchemaMetadata,
} from "./operator-schema";

describe("static operator recovery schema review", () => {
  it("never strips partial, duplicated or mistyped language metadata beside optional labels and locks", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    expect(metadata.emailLocaleColumns).toHaveLength(10);
    const lockColumn = {
      table_name: "ProgramSettings",
      column_name: "notificationLocks",
      udt_name: "jsonb",
    };
    for (const base of [
      metadata.columns,
      metadata.identityColumns,
      metadata.legacyDeclineColumns,
      metadata.identityLegacyDeclineColumns,
    ])
      for (const withLabels of [false, true])
        for (const withLocks of [false, true]) {
          const columns = [
            ...base.filter(
              (row) =>
                withLabels ||
                row.table_name !== "SchoolHoursSchedule" ||
                row.column_name !== "recipientLabels",
            ),
            ...(withLocks ? [lockColumn] : []),
          ];
          const invalidBundles = [
            ...metadata.emailLocaleColumns.map((_, omitted) =>
              metadata.emailLocaleColumns.filter(
                (__, index) => index !== omitted,
              ),
            ),
            ...metadata.emailLocaleColumns.map((_, changed) =>
              metadata.emailLocaleColumns.map((column, index) =>
                index === changed ? { ...column, udt_name: "jsonb" } : column,
              ),
            ),
            [...metadata.emailLocaleColumns, metadata.emailLocaleColumns[0]!],
            [
              ...metadata.emailLocaleColumns,
              {
                table_name: "SchoolHoursSchedule",
                column_name: "emailLocale",
                udt_name: "text",
              },
            ],
            [
              ...metadata.emailLocaleColumns,
              {
                table_name: "UnreviewedGrant",
                column_name: "tokenHash",
                udt_name: "text",
              },
            ],
          ];
          for (const bundle of invalidBundles)
            expect(() =>
              assertReviewedRecoverySchema(
                [...columns, ...bundle],
                metadata.enums,
              ),
            ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
        }
  });
  it("rejects a partial locale upgrade even when optional recipient labels are absent", () => {
    const {
      columns,
      identityColumns,
      legacyDeclineColumns,
      identityLegacyDeclineColumns,
      emailLocaleColumns,
      enums,
    } = reviewedRecoverySchemaMetadata;
    for (const base of [
      columns,
      identityColumns,
      legacyDeclineColumns,
      identityLegacyDeclineColumns,
    ])
      for (const withLabels of [true, false]) {
        const schema = withLabels
          ? base
          : base.filter(
              (row) =>
                row.table_name !== "SchoolHoursSchedule" ||
                row.column_name !== "recipientLabels",
            );
        for (let omitted = 0; omitted < emailLocaleColumns.length; omitted++)
          expect(() =>
            assertReviewedRecoverySchema(
              [
                ...schema,
                ...emailLocaleColumns.filter((_, index) => index !== omitted),
              ],
              enums,
            ),
          ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
      }
  });
  it("reviews all email-language columns together while retaining every complete older schema", () => {
    const {
      columns,
      identityColumns,
      legacyDeclineColumns,
      identityLegacyDeclineColumns,
      emailLocaleColumns,
      enums,
    } = reviewedRecoverySchemaMetadata;
    for (const old of [
      columns,
      identityColumns,
      legacyDeclineColumns,
      identityLegacyDeclineColumns,
    ]) {
      expect(assertReviewedRecoverySchema(old, enums).emailLocale).toBe(false);
      expect(
        assertReviewedRecoverySchema([...old, ...emailLocaleColumns], enums)
          .emailLocale,
      ).toBe(true);
      for (let index = 0; index < emailLocaleColumns.length; index++)
        expect(() =>
          assertReviewedRecoverySchema(
            [
              ...old,
              ...emailLocaleColumns.filter((_, position) => position !== index),
            ],
            enums,
          ),
        ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    }
    expect(() =>
      assertReviewedRecoverySchema(
        [
          ...columns,
          ...emailLocaleColumns.map((row) =>
            row.table_name === "User" ? { ...row, udt_name: "jsonb" } : row,
          ),
        ],
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });
  it("reviews tutoring policy columns together while retaining complete older backups", () => {
    const { columns, enums } = reviewedRecoverySchemaMetadata;
    const old = columns.filter(
      (row) =>
        row.table_name !== "ProgramCalendarPolicyRevision" &&
        !(
          row.table_name === "ProgramCalendarDay" &&
          row.column_name === "schedulingEffect"
        ) &&
        !(
          row.table_name === "SessionPlanParticipant" &&
          row.column_name === "tutoringPauseSuppressed"
        ),
    );
    expect(() => assertReviewedRecoverySchema(old, enums)).not.toThrow();
    expect(() =>
      assertReviewedRecoverySchema(
        columns.filter(
          (row) => row.table_name !== "ProgramCalendarPolicyRevision",
        ),
        enums,
      ),
    ).not.toThrow();
    expect(() =>
      assertReviewedRecoverySchema(
        columns.filter(
          (row) =>
            !(
              row.table_name === "ProgramCalendarPolicyRevision" &&
              row.column_name === "effectiveAt"
            ),
        ),
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    expect(() =>
      assertReviewedRecoverySchema(
        columns.filter(
          (row) =>
            !(
              row.table_name === "ProgramCalendarDay" &&
              row.column_name === "schedulingEffect"
            ),
        ),
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });
  it("accepts the reviewed catalog and refuses a matching-but-unreviewed bearer table or column", () => {
    const { columns, enums } = reviewedRecoverySchemaMetadata;
    expect(() => assertReviewedRecoverySchema(columns, enums)).not.toThrow();
    expect(
      assertReviewedRecoverySchema(
        reviewedRecoverySchemaMetadata.identityColumns,
        enums,
      ).identityVersion,
    ).toBe(1);
    expect(() =>
      assertReviewedRecoverySchema(
        [
          ...columns,
          {
            table_name: "NewBearerCapability",
            column_name: "tokenHash",
            udt_name: "text",
          },
        ],
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    expect(() =>
      assertReviewedRecoverySchema(
        [
          ...columns,
          {
            table_name: "StudentSurvey",
            column_name: "replacementGrant",
            udt_name: "text",
          },
        ],
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });
  it("refuses changed credential storage type, missing columns and new authority enum labels", () => {
    const { columns, enums } = reviewedRecoverySchemaMetadata;
    expect(() =>
      assertReviewedRecoverySchema(
        columns.map((row) =>
          row.table_name === "User" && row.column_name === "passwordHash"
            ? { ...row, udt_name: "jsonb" }
            : row,
        ),
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    expect(() => assertReviewedRecoverySchema(columns.slice(1), enums)).toThrow(
      "UNREVIEWED_PUBLIC_RECOVERY_SCHEMA",
    );
    expect(() =>
      assertReviewedRecoverySchema(columns, [
        ...enums,
        { type_name: "Role", enum_label: "UNREVIEWED_AUTHORITY" },
      ]),
    ).toThrow("UNREVIEWED_RECOVERY_ENUM_SCHEMA");
  });
});
