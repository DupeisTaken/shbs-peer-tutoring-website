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

describe("notification-lock recovery schema compatibility", () => {
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
});
