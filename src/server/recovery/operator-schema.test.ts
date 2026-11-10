import { describe, expect, it } from "vitest";
import {
  assertReviewedRecoverySchema,
  reviewedRecoverySchemaMetadata,
} from "./operator-schema";

describe("static operator recovery schema review", () => {
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
  it("composes all tutoring policy eras with provenance, invitation closure and translation receipt profiles", () => {
    const m = reviewedRecoverySchemaMetadata;
    const policyProfiles = (columns: typeof m.columns) => [
      columns,
      columns.filter(
        (row) => row.table_name !== "ProgramCalendarPolicyRevision",
      ),
      columns.filter(
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
      ),
    ];
    for (const base of [
      m.columns,
      m.identityColumns,
      m.legacyDeclineColumns,
      m.identityLegacyDeclineColumns,
    ].flatMap(policyProfiles)) {
      for (const closure of [
        [],
        m.historicalInvitationOperationClosureColumns,
      ]) {
        for (const translation of [[], m.translationIntentReceiptColumns]) {
          const combined = [...base, ...closure, ...translation];
          expect(
            assertReviewedRecoverySchema(
              [...combined, ...m.importProvenanceColumns],
              m.enums,
            ),
          ).toMatchObject({
            historicalInvitationOperationClosure: closure.length > 0,
            translationIntentReceipt: translation.length > 0,
          });
          expect(() =>
            assertReviewedRecoverySchema(
              [...combined, ...m.importProvenanceColumns.slice(1)],
              m.enums,
            ),
          ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
        }
      }
    }
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
  it("reviews the complete additive historical stop table while retaining older backup schemas", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    const closure = metadata.historicalInvitationOperationClosureColumns;
    for (const base of [
      metadata.columns,
      metadata.legacyDeclineColumns,
      metadata.identityColumns,
      metadata.identityLegacyDeclineColumns,
    ]) {
      expect(
        assertReviewedRecoverySchema(base, metadata.enums)
          .historicalInvitationOperationClosure,
      ).toBe(false);
      expect(
        assertReviewedRecoverySchema([...base, ...closure], metadata.enums)
          .historicalInvitationOperationClosure,
      ).toBe(true);
      expect(() =>
        assertReviewedRecoverySchema(
          [...base, ...closure.slice(1)],
          metadata.enums,
        ),
      ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
      expect(() =>
        assertReviewedRecoverySchema(
          [
            ...base,
            ...closure,
            {
              table_name: "HistoricalInvitationOperationClosure",
              column_name: "email",
              udt_name: "text",
            },
          ],
          metadata.enums,
        ),
      ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
    }
  });
  it("keeps all sixteen base/closure/translation combinations inspectable and refuses new-table drift", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    const receipt = metadata.translationIntentReceiptColumns;
    for (const base of [
      metadata.columns,
      metadata.legacyDeclineColumns,
      metadata.identityColumns,
      metadata.identityLegacyDeclineColumns,
    ]) {
      for (const closure of [
        [],
        metadata.historicalInvitationOperationClosureColumns,
      ]) {
        for (const present of [false, true]) {
          const schema = assertReviewedRecoverySchema(
            [...base, ...closure, ...(present ? receipt : [])],
            metadata.enums,
          );
          expect(schema.translationIntentReceipt).toBe(present);
          expect(schema.historicalInvitationOperationClosure).toBe(
            closure.length > 0,
          );
        }
        for (const changed of [
          receipt.slice(1),
          [
            ...receipt,
            {
              table_name: "TranslationIntentReceipt",
              column_name: "privateBody",
              udt_name: "jsonb",
            },
          ],
          receipt.map((row) =>
            row.column_name === "intentId" ? { ...row, udt_name: "uuid" } : row,
          ),
          receipt.map((row) =>
            row.column_name === "cleared" ? { ...row, udt_name: "text" } : row,
          ),
        ])
          expect(() =>
            assertReviewedRecoverySchema(
              [...base, ...closure, ...changed],
              metadata.enums,
            ),
          ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
      }
    }
  });
});
