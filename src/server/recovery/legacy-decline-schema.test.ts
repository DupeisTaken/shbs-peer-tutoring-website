import { describe, expect, it } from "vitest";
import {
  assertReviewedRecoverySchema,
  reviewedRecoverySchemaMetadata,
} from "./operator-schema";

describe("legacy decline recovery schema compatibility", () => {
  it("recognizes complete legacy-decline schema additions while retaining reviewed older backups", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    for (const [columns, identityVersion] of [
      [metadata.columns, 0],
      [metadata.identityColumns, 1],
      [metadata.legacyDeclineColumns, 0],
      [metadata.identityLegacyDeclineColumns, 1],
    ] as const) {
      expect(assertReviewedRecoverySchema(columns, metadata.enums)).toEqual({
        emailLocale: false,
        identityVersion,
        legacySignupDecline: columns.some(
          (column) => column.table_name === "LegacySignupDecline",
        ),
      });
    }
    expect(() =>
      assertReviewedRecoverySchema(
        metadata.identityLegacyDeclineColumns.filter(
          (column) =>
            column.table_name !== "LegacySignupDecline" ||
            column.column_name !== "intakeSnapshot",
        ),
        metadata.enums,
      ),
    ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });
});
