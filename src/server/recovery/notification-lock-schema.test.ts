import { describe, expect, it } from "vitest";
import {
  assertReviewedRecoverySchema,
  reviewedRecoverySchemaMetadata,
} from "./operator-schema";

const lockColumn = {
  table_name: "ProgramSettings",
  column_name: "notificationLocks",
  udt_name: "jsonb",
};
const recipientLabelColumn = {
  table_name: "SchoolHoursSchedule",
  column_name: "recipientLabels",
  udt_name: "jsonb",
};
const withoutRecipientLabels = (columns: Record<string, unknown>[]) =>
  columns.filter(
    (row) =>
      !(
        row.table_name === "SchoolHoursSchedule" &&
        row.column_name === "recipientLabels"
      ),
  );

describe("notification-lock recovery schema compatibility", () => {
  it.each([
    ["original", reviewedRecoverySchemaMetadata.columns, 0, false],
    ["identity", reviewedRecoverySchemaMetadata.identityColumns, 1, false],
    [
      "legacy decline",
      reviewedRecoverySchemaMetadata.legacyDeclineColumns,
      0,
      true,
    ],
    [
      "identity and legacy decline",
      reviewedRecoverySchemaMetadata.identityLegacyDeclineColumns,
      1,
      true,
    ],
  ] as const)(
    "retains %s backups across tutoring-policy history with optional notification requirements and recipient labels",
    (_label, columns, identityVersion, legacySignupDecline) => {
      const beforeHistory = columns.filter(
        (row) => row.table_name !== "ProgramCalendarPolicyRevision",
      );
      const beforePauses = beforeHistory.filter(
        (row) =>
          !(
            row.table_name === "ProgramCalendarDay" &&
            row.column_name === "schedulingEffect"
          ) &&
          !(
            row.table_name === "SessionPlanParticipant" &&
            row.column_name === "tutoringPauseSuppressed"
          ),
      );
      for (const backup of [beforePauses, beforeHistory, columns]) {
        for (const labels of [backup, withoutRecipientLabels(backup)])
          for (const shape of [labels, [...labels, lockColumn]])
            expect(
              assertReviewedRecoverySchema(
                shape,
                reviewedRecoverySchemaMetadata.enums,
              ),
            ).toEqual({ identityVersion, legacySignupDecline });
      }
    },
  );

  it("accepts the additive policy column with every reviewed backup shape", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    for (const columns of [
      metadata.columns,
      metadata.identityColumns,
      metadata.legacyDeclineColumns,
      metadata.identityLegacyDeclineColumns,
    ]) {
      expect(
        assertReviewedRecoverySchema([...columns, lockColumn], metadata.enums),
      ).toEqual(assertReviewedRecoverySchema(columns, metadata.enums));
    }
    expect(
      assertReviewedRecoverySchema(
        metadata.notificationLockColumns,
        metadata.enums,
      ),
    ).toEqual({ identityVersion: 1, legacySignupDecline: true });
  });

  it("still refuses changed types, duplicate policy columns and unknown schema additions", () => {
    const { columns, enums } = reviewedRecoverySchemaMetadata;
    for (const additions of [
      [{ ...lockColumn, udt_name: "text" }],
      [lockColumn, lockColumn],
      [
        lockColumn,
        {
          table_name: "ProgramSettings",
          column_name: "unreviewedPolicy",
          udt_name: "jsonb",
        },
      ],
    ])
      expect(() =>
        assertReviewedRecoverySchema([...columns, ...additions], enums),
      ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });

  it("rejects partial tutoring upgrades and malformed core columns in the combined schema", () => {
    const { identityLegacyDeclineColumns: columns, enums } =
      reviewedRecoverySchemaMetadata;
    const combined = [...columns, lockColumn];
    const missingEffect = combined.filter(
      (row) =>
        !(
          row.table_name === "ProgramCalendarDay" &&
          row.column_name === "schedulingEffect"
        ),
    );
    const missingSuppression = combined.filter(
      (row) =>
        !(
          row.table_name === "SessionPlanParticipant" &&
          row.column_name === "tutoringPauseSuppressed"
        ),
    );
    const partialHistory = combined.filter(
      (row) =>
        !(
          row.table_name === "ProgramCalendarPolicyRevision" &&
          row.column_name === "effectiveAt"
        ),
    );
    const beforeHistory = combined.filter(
      (row) => row.table_name !== "ProgramCalendarPolicyRevision",
    );
    const suppression = columns.find(
      (row) =>
        row.table_name === "SessionPlanParticipant" &&
        row.column_name === "tutoringPauseSuppressed",
    )!;
    for (const invalid of [
      missingEffect,
      missingSuppression,
      partialHistory,
      missingEffect.filter(
        (row) => row.table_name !== "ProgramCalendarPolicyRevision",
      ),
      missingSuppression.filter(
        (row) => row.table_name !== "ProgramCalendarPolicyRevision",
      ),
      [...beforeHistory, suppression],
      combined.slice(1),
      combined.map((row) =>
        row.table_name === "User" && row.column_name === "passwordHash"
          ? { ...row, udt_name: "jsonb" }
          : row,
      ),
      combined.map((row) =>
        row === lockColumn ? { ...row, udt_name: "text" } : row,
      ),
      [...combined, lockColumn],
      [...combined, recipientLabelColumn],
      combined.map((row) =>
        row.table_name === "SchoolHoursSchedule" &&
        row.column_name === "recipientLabels"
          ? { ...row, udt_name: "text" }
          : row,
      ),
      withoutRecipientLabels(partialHistory),
      withoutRecipientLabels(missingEffect),
      withoutRecipientLabels([...combined, lockColumn]),
      withoutRecipientLabels(
        combined.map((row) =>
          row === lockColumn ? { ...row, udt_name: "text" } : row,
        ),
      ),
      withoutRecipientLabels(combined.slice(1)),
      [
        ...combined,
        {
          table_name: "SchoolHoursSchedule",
          column_name: "recipientGrant",
          udt_name: "text",
        },
      ],
      [
        ...combined,
        {
          table_name: "UnreviewedGrant",
          column_name: "tokenHash",
          udt_name: "text",
        },
      ],
    ])
      expect(() => assertReviewedRecoverySchema(invalid, enums)).toThrow(
        "UNREVIEWED_PUBLIC_RECOVERY_SCHEMA",
      );
  });
});
