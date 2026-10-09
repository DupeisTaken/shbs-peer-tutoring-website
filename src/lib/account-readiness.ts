/** Login readiness is independent of membership, suspension and participant lifecycle. */
export function hasReadyCredentials(account: {
  passwordHash: string | null;
  emailVerifiedAt: Date | string | null;
  mustChangePassword: boolean;
}) {
  return Boolean(
    account.passwordHash &&
    account.emailVerifiedAt &&
    !account.mustChangePassword,
  );
}
