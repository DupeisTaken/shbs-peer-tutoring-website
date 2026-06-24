/**
 * Mask an email for a "code sent to …" hint: keep the first character + the full domain
 * (alice@x.edu → a****@x.edu). Falls back to the raw value if it isn't an address.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return email;
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}
