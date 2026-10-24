import { emailOrigin } from "~/server/email/urls";

/** Public exports share the configured mail origin, never a browser/proxy host. */
export function publicQrOrigin(): string {
  const origin = emailOrigin();
  // A DNS root dot does not make a localhost name public. URL already
  // normalizes IPv4 and IPv6 spellings before these export-specific checks.
  const hostname = new URL(origin).hostname.replace(/\.+$/, "");
  // URL normalizes IPv4-mapped IPv6 to hexadecimal. Keep its 127/8 loopback
  // range (and unspecified address) out of printed production links as well.
  // This additional export guard does not change existing mail-link behavior.
  if (
    process.env.NODE_ENV === "production" &&
    (/(^|\.)localhost$/i.test(hostname) ||
      hostname === "[::]" ||
      /^\[::ffff:(?:7f[\da-f]{2}:[\da-f]{1,4}|0:0)\]$/i.test(hostname))
  ) {
    throw new Error("Configure a public HTTPS AUTH_URL origin for QR exports.");
  }
  return origin;
}
