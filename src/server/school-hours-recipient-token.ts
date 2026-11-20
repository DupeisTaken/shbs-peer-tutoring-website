import { createHmac, timingSafeEqual } from "node:crypto";

const PURPOSE = "shbs:school-hours-recipient-link:v2";
const MAX_TOKEN_LENGTH = 320;
const invalidIdentifierCharacter = /[^a-zA-Z0-9_-]/;
const tokenPattern =
  /^v2\.([a-zA-Z0-9_-]{1,128})\.([1-9]\d{0,8})\.([a-zA-Z0-9_-]{43})$/;

type RecipientDelivery = {
  id: string;
  schoolHoursReportId: string;
  recipient: string;
};

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !invalidIdentifierCharacter.test(value)
  );
}

function validIdentity(row: RecipientDelivery, linkVersion: number) {
  return (
    validIdentifier(row.id) &&
    validIdentifier(row.schoolHoursReportId) &&
    typeof row.recipient === "string" &&
    row.recipient.length > 0 &&
    row.recipient.length <= 254 &&
    row.recipient.trim() === row.recipient &&
    !/[\u0000-\u001f\u007f]/.test(row.recipient) &&
    Number.isSafeInteger(linkVersion) &&
    linkVersion >= 1 &&
    linkVersion <= 999999999
  );
}

/** The public path contains only an outbox identity and link version. Its
 * signature binds the exact stored mailbox and report, granting no other
 * recipient or management authority. Forwarding retains the same mailbox. */
export function issueSchoolHoursRecipientToken(
  row: RecipientDelivery,
  linkVersion: number,
): string {
  if (!validIdentity(row, linkVersion))
    throw new Error("Invalid school report recipient link identity.");
  const secret = process.env.AUTH_SECRET;
  if (!secret?.trim())
    throw new Error("Configure AUTH_SECRET for school report recipient links.");
  const payload = `v2.${row.id}.${linkVersion}`;
  const signature = createHmac("sha256", secret)
    .update(
      JSON.stringify([
        PURPOSE,
        payload,
        row.schoolHoursReportId,
        row.recipient,
      ]),
    )
    .digest("base64url");
  return `${payload}.${signature}`;
}

/** Parsing is never authorization. Callers must resolve the delivery, verify
 * its signature and enforce the live report/version/recipient state. */
export function parseSchoolHoursRecipientToken(token: string): {
  deliveryId: string;
  linkVersion: number;
} | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const match = tokenPattern.exec(token);
  if (match?.[0] !== token) return null;
  const signature = Buffer.from(match[3]!, "base64url");
  if (signature.length !== 32 || signature.toString("base64url") !== match[3])
    return null;
  return { deliveryId: match[1]!, linkVersion: Number(match[2]) };
}

/** Signature validation deliberately fails closed after AUTH_SECRET rotation.
 * A newly issued link is required; no parsed identity grants access by itself. */
export function schoolHoursRecipientTokenMatches(
  token: string,
  row: RecipientDelivery,
  linkVersion: number,
): boolean {
  const parsed = parseSchoolHoursRecipientToken(token);
  if (parsed?.deliveryId !== row.id || parsed?.linkVersion !== linkVersion)
    return false;
  try {
    const expected = Buffer.from(
      issueSchoolHoursRecipientToken(row, linkVersion),
    );
    const actual = Buffer.from(token);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
