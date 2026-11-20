import { describe, expect, it } from "vitest";
import {
  assertReviewedRecoverySchema,
  reviewedRecoverySchemaMetadata,
} from "./operator-schema";

const schemaMetadata = reviewedRecoverySchemaMetadata;
const optionalNotificationLock = {
  table_name: "ProgramSettings",
  column_name: "notificationLocks",
  udt_name: "jsonb",
};

function reviewedSchemaPhases() {
  const versions = [
    {
      columns: schemaMetadata.columns,
      identityVersion: 0,
      legacySignupDecline: false,
    },
    {
      columns: schemaMetadata.identityColumns,
      identityVersion: 1,
      legacySignupDecline: false,
    },
    {
      columns: schemaMetadata.legacyDeclineColumns,
      identityVersion: 0,
      legacySignupDecline: true,
    },
    {
      columns: schemaMetadata.identityLegacyDeclineColumns,
      identityVersion: 1,
      legacySignupDecline: true,
    },
  ];
  return versions.flatMap(({ columns, ...expected }) => {
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
    return [columns, beforeHistory, beforePolicy].flatMap((phase) =>
      [false, true].flatMap((withLabels) =>
        [false, true].map((withLocks) => ({
          expected,
          columns: [
            ...phase.filter(
              (column) =>
                withLabels ||
                column.table_name !== "SchoolHoursSchedule" ||
                column.column_name !== "recipientLabels",
            ),
            ...(withLocks ? [optionalNotificationLock] : []),
          ],
        })),
      ),
    );
  });
}

describe("static operator recovery schema review", () => {
  it("composes complete optional language and import bundles across every reviewed policy and identity phase", () => {
    expect(schemaMetadata.emailLocaleColumns).toHaveLength(10);
    expect(schemaMetadata.importProvenanceColumns).toHaveLength(3);
    for (const { columns, expected } of reviewedSchemaPhases())
      for (const withLocale of [false, true])
        for (const withProvenance of [false, true])
          expect(
            assertReviewedRecoverySchema(
              [
                ...columns,
                ...(withLocale ? schemaMetadata.emailLocaleColumns : []),
                ...(withProvenance
                  ? schemaMetadata.importProvenanceColumns
                  : []),
              ],
              schemaMetadata.enums,
            ),
          ).toEqual({ emailLocale: withLocale, ...expected });
  });
  it("refuses incomplete, duplicated, mistyped and widened optional bundles in every reviewed phase", () => {
    const bundles = [
      schemaMetadata.emailLocaleColumns,
      schemaMetadata.importProvenanceColumns,
    ];
    for (const { columns } of reviewedSchemaPhases())
      for (const [index, bundle] of bundles.entries()) {
        const companion = bundles[1 - index]!;
        const invalidBundles = [
          ...bundle.map((_, omitted) =>
            bundle.filter((__, position) => position !== omitted),
          ),
          ...bundle.map((_, changed) =>
            bundle.map((column, position) =>
              position === changed ? { ...column, udt_name: "jsonb" } : column,
            ),
          ),
          ...bundle.map((column) => [...bundle, column]),
          [
            ...bundle,
            {
              table_name: "ImportedRecordProvenance",
              column_name: "liveAuthority",
              udt_name: "bool",
            },
          ],
          [
            ...bundle,
            {
              table_name: "SchoolHoursSchedule",
              column_name: "emailLocale",
              udt_name: "text",
            },
          ],
          [
            ...bundle,
            {
              table_name: "UnreviewedGrant",
              column_name: "tokenHash",
              udt_name: "text",
            },
          ],
        ];
        for (const optionalCompanion of [[], companion])
          for (const invalid of invalidBundles)
            expect(() =>
              assertReviewedRecoverySchema(
                [...columns, ...optionalCompanion, ...invalid],
                schemaMetadata.enums,
              ),
            ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
      }
  });
  it("keeps notification-lock compatibility independent from reviewed history, labels and complete archive provenance", () => {
    const metadata = reviewedRecoverySchemaMetadata;
    const notificationLock = {
      table_name: "ProgramSettings",
      column_name: "notificationLocks",
      udt_name: "jsonb",
    };
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
          const labeled = withLabels
            ? phase
            : phase.filter(
                (column) =>
                  column.table_name !== "SchoolHoursSchedule" ||
                  column.column_name !== "recipientLabels",
              );
          for (const notificationColumns of [[], [notificationLock]])
            for (const provenance of [[], metadata.importProvenanceColumns])
              expect(
                assertReviewedRecoverySchema(
                  [...labeled, ...notificationColumns, ...provenance],
                  metadata.enums,
                ),
              ).toEqual(expected);
          const combined = [
            ...labeled,
            notificationLock,
            ...metadata.importProvenanceColumns,
          ];
          for (const invalid of [
            [...combined, notificationLock],
            [
              ...labeled,
              { ...notificationLock, udt_name: "text" },
              ...metadata.importProvenanceColumns,
            ],
            [
              ...labeled,
              notificationLock,
              ...metadata.importProvenanceColumns.slice(1),
            ],
            [
              ...combined,
              {
                table_name: "ProgramSettings",
                column_name: "unreviewedPolicy",
                udt_name: "jsonb",
              },
            ],
          ])
            expect(() =>
              assertReviewedRecoverySchema(invalid, metadata.enums),
            ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
        }
    }
  });
  it("composes reviewed policy phases, recipient labels and archive provenance without hiding malformed boundaries", () => {
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
      for (const phase of [columns, beforeHistory, beforePolicy]) {
        for (const withLabels of [true, false]) {
          const labeled = withLabels
            ? phase
            : phase.filter(
                (column) =>
                  column.table_name !== "SchoolHoursSchedule" ||
                  column.column_name !== "recipientLabels",
              );
          for (const provenance of [[], metadata.importProvenanceColumns])
            expect(
              assertReviewedRecoverySchema(
                [...labeled, ...provenance],
                metadata.enums,
              ),
            ).toEqual(expected);
          expect(() =>
            assertReviewedRecoverySchema(
              [...labeled, ...metadata.importProvenanceColumns.slice(1)],
              metadata.enums,
            ),
          ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
          expect(() =>
            assertReviewedRecoverySchema(
              [
                ...labeled,
                ...metadata.importProvenanceColumns,
                {
                  table_name: "SchoolHoursSchedule",
                  column_name: "recipientGrant",
                  udt_name: "text",
                },
              ],
              metadata.enums,
            ),
          ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
          const wrongLabelType = labeled.filter(
            (column) =>
              column.table_name !== "SchoolHoursSchedule" ||
              column.column_name !== "recipientLabels",
          );
          expect(() =>
            assertReviewedRecoverySchema(
              [
                ...wrongLabelType,
                ...metadata.importProvenanceColumns,
                {
                  table_name: "SchoolHoursSchedule",
                  column_name: "recipientLabels",
                  udt_name: "text",
                },
              ],
              metadata.enums,
            ),
          ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
        }
      }
    }
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
    for (const provenance of [
      [],
      reviewedRecoverySchemaMetadata.importProvenanceColumns,
    ]) {
      expect(() =>
        assertReviewedRecoverySchema([...old, ...provenance], enums),
      ).not.toThrow();
      expect(() =>
        assertReviewedRecoverySchema(
          [
            ...columns.filter(
              (row) => row.table_name !== "ProgramCalendarPolicyRevision",
            ),
            ...provenance,
          ],
          enums,
        ),
      ).not.toThrow();
      expect(() =>
        assertReviewedRecoverySchema(
          [
            ...columns.filter(
              (row) =>
                !(
                  row.table_name === "ProgramCalendarPolicyRevision" &&
                  row.column_name === "effectiveAt"
                ),
            ),
            ...provenance,
          ],
          enums,
        ),
      ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
      expect(() =>
        assertReviewedRecoverySchema(
          [
            ...columns.filter(
              (row) =>
                !(
                  row.table_name === "ProgramCalendarDay" &&
                  row.column_name === "schedulingEffect"
                ),
            ),
            ...provenance,
          ],
          enums,
        ),
      ).toThrow("UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
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
});
