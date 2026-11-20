import { describe, expect, it } from "vitest";
import {
  assertReviewedRecoverySchema,
  reviewedRecoverySchemaMetadata as metadata,
} from "./operator-schema";

const variants = [
  ["original", metadata.columns],
  ["identity", metadata.identityColumns],
  ["legacy decline", metadata.legacyDeclineColumns],
  ["identity and legacy decline", metadata.identityLegacyDeclineColumns],
] as const;

describe("school-recipient reminder recovery schema compatibility", () => {
  it.each(variants)(
    "accepts only the complete reminder migration beside the %s backup schema",
    (_name, columns) => {
      const beforeHistory = columns.filter(
        (row) => row.table_name !== "ProgramCalendarPolicyRevision",
      );
      const beforePolicy = beforeHistory.filter(
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
      for (const phase of [columns, beforeHistory, beforePolicy])
        for (const withLabels of [false, true])
          for (const withLocale of [false, true])
            for (const withLocks of [false, true])
              for (const withArchive of [false, true]) {
                const backup = [
                  ...phase.filter(
                    (row) =>
                      withLabels ||
                      row.table_name !== "SchoolHoursSchedule" ||
                      row.column_name !== "recipientLabels",
                  ),
                  ...(withLocale ? metadata.emailLocaleColumns : []),
                  ...(withArchive ? metadata.importProvenanceColumns : []),
                  ...(withLocks
                    ? [
                        {
                          table_name: "ProgramSettings",
                          column_name: "notificationLocks",
                          udt_name: "jsonb",
                        },
                      ]
                    : []),
                ];
                const expected = assertReviewedRecoverySchema(
                  backup,
                  metadata.enums,
                );
                expect(
                  assertReviewedRecoverySchema(
                    [...backup, ...metadata.schoolRecipientReminderColumns],
                    metadata.enums,
                  ),
                ).toEqual(expected);
              }
    },
  );

  it("rejects every incomplete, duplicated or mistyped reminder bundle", () => {
    const additions = metadata.schoolRecipientReminderColumns;
    for (const columns of variants.map((variant) => variant[1]))
      for (const [index, column] of additions.entries())
        for (const malformed of [
          additions.filter((_, selected) => selected !== index),
          [...additions, column],
          additions.map((actual, selected) =>
            selected === index ? { ...actual, udt_name: "bytea" } : actual,
          ),
        ])
          expect(() =>
            assertReviewedRecoverySchema(
              [...columns, ...metadata.emailLocaleColumns, ...malformed],
              metadata.enums,
            ),
          ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });

  it("keeps unrelated unknown columns and missing core fields fail-closed", () => {
    const reviewed = [
      ...metadata.identityLegacyDeclineColumns,
      ...metadata.schoolRecipientReminderColumns,
    ];
    expect(() =>
      assertReviewedRecoverySchema(
        [
          ...reviewed,
          {
            table_name: "EmailDelivery",
            column_name: "unreviewedCapability",
            udt_name: "text",
          },
        ],
        metadata.enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    expect(() =>
      assertReviewedRecoverySchema(
        reviewed.filter(
          (row) =>
            row.table_name !== "EmailDelivery" ||
            row.column_name !== "recipient",
        ),
        metadata.enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });
});
