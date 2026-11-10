// These are real suites, not copies of their fixture hooks. Child discovery is
// deliberately finite and excludes the parent subprocess regression itself.
export const teardownSafetyCases = [
  [
    "src/server/student-survey.test.ts",
    "allocates Madonna once after verification",
  ],
  ["src/server/auth/registration.test.ts", "bounds replacement-code retries"],
  [
    "src/server/auth/account-emails.test.ts",
    "requires proof before secondary sign-in",
  ],
  [
    "src/server/notification-preferences.test.ts",
    "conceals recovery-withdrawn notices",
  ],
  [
    "src/server/email/event-reminders.integration.test.ts",
    "database uniqueness deduplicates concurrent sweeps",
  ],
  [
    "src/server/email/notification-categories.test.ts",
    "keeps participant updates on info",
  ],
  [
    "src/server/email/notification-delivery.test.ts",
    "does not replay a failed admitted causal SMTP attempt",
  ],
  [
    "src/server/email/resend-stuck.test.ts",
    "requeues only stuck unleased records",
  ],
  [
    "src/server/email/unsubscribe.integration.test.ts",
    "status checks cannot change preferences",
  ],
  ["src/server/auth/step-up.test.ts", "allows exactly one concurrent consumer"],
  ["src/server/auth/two-factor.test.ts", "resamples a repeated short code"],
  ["src/server/api/routers/i18n.test.ts", "allows unassigned"],
  [
    "src/server/api/routers/scoping.test.ts",
    "a tutor sees only their own pairings",
  ],
  [
    "src/server/api/routers/time-slots.test.ts",
    "updates the slot, linked pairing",
  ],
] as const;

export const rawMigrationSafetyFiles = [
  "src/server/account-membership-migration.test.ts",
  "src/server/course-catalogue-migration.test.ts",
  "src/server/signup-migration.test.ts",
  "src/server/signup-provenance-migration.test.ts",
];
