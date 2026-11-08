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
});
