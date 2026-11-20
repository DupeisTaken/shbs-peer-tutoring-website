import { describe, expect, it } from "vitest";
import {
  assertReviewedRecoverySchema,
  reviewedRecoverySchemaMetadata,
} from "./operator-schema";

describe("recipient label recovery schema compatibility", () => {
  it("recognizes the additive label field and retains each reviewed older backup shape", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    for (const columns of [
      metadata.columns,
      metadata.identityColumns,
      metadata.legacyDeclineColumns,
      metadata.identityLegacyDeclineColumns,
    ]) {
      expect(columns).toContainEqual({
        table_name: "SchoolHoursSchedule",
        column_name: "recipientLabels",
        udt_name: "jsonb",
      });
      const withoutLabels = columns.filter(
        (column) =>
          column.table_name !== "SchoolHoursSchedule" ||
          column.column_name !== "recipientLabels",
      );
      expect(assertReviewedRecoverySchema(columns, metadata.enums)).toEqual(
        assertReviewedRecoverySchema(withoutLabels, metadata.enums),
      );
    }
  });

  it("composes label compatibility with every reviewed tutoring-policy migration phase", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    for (const columns of [
      metadata.columns,
      metadata.identityColumns,
      metadata.legacyDeclineColumns,
      metadata.identityLegacyDeclineColumns,
    ]) {
      const expected = assertReviewedRecoverySchema(columns, metadata.enums);
      const beforeHistory = columns.filter(
        (column) => column.table_name !== "ProgramCalendarPolicyRevision",
      );
      const beforePolicy = beforeHistory.filter(
        (column) =>
          !(
            column.table_name === "ProgramCalendarDay" &&
            column.column_name === "schedulingEffect"
          ) &&
          !(
            column.table_name === "SessionPlanParticipant" &&
            column.column_name === "tutoringPauseSuppressed"
          ),
      );
      for (const phase of [columns, beforeHistory, beforePolicy])
        for (const withLabels of [true, false]) {
          const actual = withLabels
            ? phase
            : phase.filter(
                (column) =>
                  column.table_name !== "SchoolHoursSchedule" ||
                  column.column_name !== "recipientLabels",
              );
          // Labels, complete delivery-language metadata and tutoring-policy
          // phases are independent reviewed additions, never alternative authorities.
          for (const withLocale of [false, true])
            expect(
              assertReviewedRecoverySchema(
                [...actual, ...(withLocale ? metadata.emailLocaleColumns : [])],
                metadata.enums,
              ),
            ).toEqual({ ...expected, emailLocale: withLocale });
        }
    }
  });

  it("does not hide partial tutoring-policy upgrades when recipient labels are absent", () => {
    const { identityLegacyDeclineColumns, enums } =
      reviewedRecoverySchemaMetadata;
    const withoutLabels = identityLegacyDeclineColumns.filter(
      (column) =>
        column.table_name !== "SchoolHoursSchedule" ||
        column.column_name !== "recipientLabels",
    );
    for (const incomplete of [
      withoutLabels.filter(
        (column) =>
          !(
            column.table_name === "ProgramCalendarPolicyRevision" &&
            column.column_name === "effectiveAt"
          ),
      ),
      withoutLabels.filter(
        (column) =>
          !(
            column.table_name === "ProgramCalendarDay" &&
            column.column_name === "schedulingEffect"
          ),
      ),
      withoutLabels.filter(
        (column) =>
          column.table_name !== "ProgramCalendarPolicyRevision" &&
          !(
            column.table_name === "SessionPlanParticipant" &&
            column.column_name === "tutoringPauseSuppressed"
          ),
      ),
    ]) {
      for (const withLocale of [false, true])
        expect(() =>
          assertReviewedRecoverySchema(
            [
              ...incomplete,
              ...(withLocale
                ? reviewedRecoverySchemaMetadata.emailLocaleColumns
                : []),
            ],
            enums,
          ),
        ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    }
  });

  it("refuses a changed label storage type or an additional unknown schedule field", () => {
    const { columns, enums } = reviewedRecoverySchemaMetadata;
    expect(() =>
      assertReviewedRecoverySchema(
        columns.map((column) =>
          column.table_name === "SchoolHoursSchedule" &&
          column.column_name === "recipientLabels"
            ? { ...column, udt_name: "text" }
            : column,
        ),
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    expect(() =>
      assertReviewedRecoverySchema(
        [
          ...columns,
          {
            table_name: "SchoolHoursSchedule",
            column_name: "recipientGrant",
            udt_name: "text",
          },
        ],
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });

  it("keeps label types and unknown-field rejection strict alongside the complete language migration", () => {
    const { identityLegacyDeclineColumns, emailLocaleColumns, enums } =
      reviewedRecoverySchemaMetadata;
    const upgraded = [...identityLegacyDeclineColumns, ...emailLocaleColumns];
    expect(() =>
      assertReviewedRecoverySchema(
        upgraded.map((column) =>
          column.table_name === "SchoolHoursSchedule" &&
          column.column_name === "recipientLabels"
            ? { ...column, udt_name: "text" }
            : column,
        ),
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    expect(() =>
      assertReviewedRecoverySchema(
        [
          ...upgraded,
          {
            table_name: "SchoolHoursSchedule",
            column_name: "recipientGrant",
            udt_name: "text",
          },
        ],
        enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });

  it("does not relax label JSONB storage when notification requirements and delivery languages coexist", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    const lock = {
      table_name: "ProgramSettings",
      column_name: "notificationLocks",
      udt_name: "jsonb",
    };
    for (const withLocale of [false, true])
      for (const base of [
        metadata.columns,
        metadata.identityColumns,
        metadata.legacyDeclineColumns,
        metadata.identityLegacyDeclineColumns,
      ]) {
        const combined = [
          ...base,
          lock,
          ...(withLocale ? metadata.emailLocaleColumns : []),
        ];
        const label = base.find(
          (row) =>
            row.table_name === "SchoolHoursSchedule" &&
            row.column_name === "recipientLabels",
        )!;
        for (const invalid of [
          combined.map((row) =>
            row === label ? { ...row, udt_name: "text" } : row,
          ),
          [...combined, label],
          [
            ...combined,
            {
              table_name: "SchoolHoursSchedule",
              column_name: "recipientGrant",
              udt_name: "text",
            },
          ],
        ])
          expect(() =>
            assertReviewedRecoverySchema(invalid, metadata.enums),
          ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
      }
  });
});
