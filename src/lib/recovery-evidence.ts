/** Canonical diagnostics remain stable in stored plans and CLI evidence.
 * The website translates their meaning without rewriting evidence or fingerprints. */
export const RECOVERY_EVIDENCE = {
  graphLimit:
    "The causal graph exceeds the bounded adapter limit; operator review is required.",
  missingEvidence: "Complete prospective admission evidence is unavailable.",
  missingIssuance:
    "The admission reused authorization without prospective issuance provenance.",
  missingAuthorization:
    "A source registration authorization was removed or exceeds the adapter limit.",
  sourceChanged:
    "The admission or its roster identity changed. Review the current source records.",
  invalidity: "The application has an independent invalidity decision.",
  originRequired:
    "Recovery requires an origin database session with active journal triggers.",
  clockChanged:
    "An assignment verification clock changed independently or its original evidence is unavailable.",
  sourceEvent:
    "A single committed source admission event could not be established.",
  registrationUnsupported:
    "Registration has unsupported or incomplete dependent effects.",
  assignmentUnsupported:
    "Assignment has unsupported edits or dependent effects.",
  invitationUnsupported:
    "Invitation preparation has unsupported dependent effects.",
  existingParticipation:
    "Existing assignments or recorded sessions need a separately reviewed recovery adapter.",
  missingRegistration:
    "A consumed code lacks prospective account-creation provenance.",
  preserveHistory:
    "Delivered messages and real interview attendance/hours remain historical evidence. Sent email cannot be recalled.",
  preserveIdentity:
    "Identity and academic evidence is retained. Recovery compensates admission access, recurring assignments and attributable verification clocks.",
  preserveAdmission:
    "Independent tutor admission is preserved; its access and assignments will remain.",
} as const;
export const recoveryCoveragePrefix = "Database coverage is incomplete for: ";
export const recoveryEventPrefix = "Unsupported dependent event: ";

type EvidenceKey =
  keyof typeof RECOVERY_EVIDENCE | "missingCoverage" | "unsupportedEvent";

export function recoveryEvidenceMessage(
  message: string,
): { key: EvidenceKey; values?: Record<string, string> } | undefined {
  const known = Object.entries(RECOVERY_EVIDENCE).find(
    ([, value]) => value === message,
  );
  if (known) return { key: known[0] as keyof typeof RECOVERY_EVIDENCE };
  if (
    message.startsWith(recoveryCoveragePrefix) &&
    message.length > recoveryCoveragePrefix.length
  )
    return {
      key: "missingCoverage",
      values: { tables: message.slice(recoveryCoveragePrefix.length) },
    };
  if (
    message.startsWith(recoveryEventPrefix) &&
    message.endsWith(".") &&
    message.length > recoveryEventPrefix.length + 1
  )
    return {
      key: "unsupportedEvent",
      values: { kind: message.slice(recoveryEventPrefix.length, -1) },
    };
  // Preserve future/operator diagnostics verbatim instead of dropping unknown evidence.
  return undefined;
}
