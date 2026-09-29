/** Roles remain identity/authority. Departure grants observation, never management writes. */
export function portalAccess(account: {
  role: string;
  suspendedAt?: Date | null;
  tutorAccessRevoked?: boolean;
  schoolDeparture?: {
    reason: string | null;
    observerRevoked: boolean;
    tutorDerived: boolean;
  } | null;
}) {
  const departure = account.schoolDeparture;
  const departed = !!departure?.reason;
  const elevated = ["HEAD", "ADMIN", "COORDINATOR"].includes(account.role);
  const observer =
    account.role === "VIEWER" ||
    (departed &&
      !departure?.observerRevoked &&
      !(departure?.tutorDerived && account.tutorAccessRevoked));
  return {
    departed,
    canReadManagement: !account.suspendedAt && (elevated || observer),
    managementReadOnly: !elevated,
    maskManagementData: !elevated,
    canParticipate:
      !account.suspendedAt && !departed && account.role !== "VIEWER",
  };
}
