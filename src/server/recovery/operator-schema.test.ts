import { describe, expect, it } from "vitest";
import {
  assertReviewedRecoverySchema,
  reviewedRecoverySchemaMetadata,
} from "./operator-schema";

describe("static operator recovery schema review", () => {
  it("reviews tutoring policy columns together while retaining complete older backups",()=>{
    const {columns,enums}=reviewedRecoverySchemaMetadata;
    const old=columns.filter(row=>row.table_name!=="ProgramCalendarPolicyRevision"&&!(row.table_name==="ProgramCalendarDay"&&row.column_name==="schedulingEffect")&&!(row.table_name==="SessionPlanParticipant"&&row.column_name==="tutoringPauseSuppressed"));
    expect(()=>assertReviewedRecoverySchema(old,enums)).not.toThrow();
    expect(()=>assertReviewedRecoverySchema(columns.filter(row=>row.table_name!=="ProgramCalendarPolicyRevision"),enums)).not.toThrow();
    expect(()=>assertReviewedRecoverySchema(columns.filter(row=>!(row.table_name==="ProgramCalendarPolicyRevision"&&row.column_name==="effectiveAt")),enums)).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    expect(()=>assertReviewedRecoverySchema(columns.filter(row=>!(row.table_name==="ProgramCalendarDay"&&row.column_name==="schedulingEffect")),enums)).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  });
  it("accepts complete import-boundary metadata across reviewed schema versions and refuses partial or widened tables", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    for (const columns of [
      metadata.columns,
      metadata.identityColumns,
      metadata.legacyDeclineColumns,
      metadata.identityLegacyDeclineColumns,
    ]) {
      expect(() =>
        assertReviewedRecoverySchema(
          [...columns, ...metadata.importProvenanceColumns],
          metadata.enums,
        ),
      ).not.toThrow();
      expect(() =>
        assertReviewedRecoverySchema(
          [...columns, ...metadata.importProvenanceColumns.slice(1)],
          metadata.enums,
        ),
      ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    }
    expect(() =>
      assertReviewedRecoverySchema(
        [
          ...metadata.columns,
          ...metadata.importProvenanceColumns,
          {
            table_name: "ImportedRecordProvenance",
            column_name: "liveAuthority",
            udt_name: "bool",
          },
        ],
        metadata.enums,
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
