import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PURPOSE = "shbs:school-hours-report-link:v1";
const tokenPattern =
  /^v1\.([a-zA-Z0-9_-]{1,128})\.([1-9]\d{0,8})\.([a-zA-Z0-9_-]{43})$/;

/** The capability is reproducible for outbox retries, while only its digest is
 * persisted. A link-version change makes every prior capability obsolete. */
export function issueSchoolHoursToken(reportId: string, linkVersion: number) {
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(reportId) ||
    !Number.isSafeInteger(linkVersion) ||
    linkVersion < 1 ||
    linkVersion > 999999999
  )
    throw new Error("Invalid report link identity.");
  const secret = process.env.AUTH_SECRET;
  if (!secret?.trim())
    throw new Error(
      "Configure AUTH_SECRET before issuing school report links.",
    );
  const payload = `v1.${reportId}.${linkVersion}`;
  const signature = createHmac("sha256", secret)
    .update(`${PURPOSE}\n${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function schoolHoursTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Format parsing is not authorization. Public retrieval must compare the full
 * token digest with the saved report and check its version/revocation state. */
export function parseSchoolHoursToken(token: string) {
  if (token.length > 320) return null;
  const match = tokenPattern.exec(token);
  if (!match) return null;
  const signature = Buffer.from(match[3]!, "base64url");
  if (signature.toString("base64url") !== match[3]) return null;
  return { reportId: match[1]!, linkVersion: Number(match[2]) };
}

export function schoolHoursTokenMatches(token: string, expectedHash: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(
    Buffer.from(schoolHoursTokenHash(token), "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}
