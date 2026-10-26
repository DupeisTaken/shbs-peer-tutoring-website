/** Public recovery evidence deliberately excludes credentials, invite codes and raw row dumps. */
export interface AdmissionRecoveryPlan {
  version: 1;
  actionId: string;
  applicationId: string;
  fingerprint: string;
  coverage: "COMPLETE" | "UNKNOWN";
  dependentEventCount: number;
  websiteEligible: boolean;
  blockers: string[];
  warnings: string[];
  effects: {
    registrationCodeCount: number;
    tutorId: string | null;
    accountIds: string[];
    pairingIds: string[];
    tuteeIds: string[];
    verificationClockIds?: string[];
    messageLinkIds?: string[];
  };
  events: Array<{ id: string; kind: string; createdAt: string }>;
  alreadyVoided: boolean;
}

export interface AdmissionRecoveryInput {
  actionId: string;
  expectedFingerprint: string;
  clientKey: string;
  reason: string;
}

export interface AdmissionRecoveryResult {
  receiptId: string;
  actionId: string;
  replayed: boolean;
}
