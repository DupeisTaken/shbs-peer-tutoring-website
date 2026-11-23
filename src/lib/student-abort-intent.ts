/** Receipt GETs carry a digest, keeping the private reason out of request URLs. */
export async function studentAbortReasonHash(reason: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(reason.trim()),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
