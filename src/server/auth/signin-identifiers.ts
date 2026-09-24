/** Verified aliases resolve the same account; usernames and primary onboarding remain compatible. */
export function signinIdentifiers(identifier: string) {
  return [
    { email: identifier },
    { emails: { some: { email: identifier, verifiedAt: { not: null } } } },
    { username: identifier },
    { tutor: { username: identifier } },
  ];
}
