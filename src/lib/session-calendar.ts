/** Calendar serialization has no database or private roster dependency. Audience-specific
 * stable IDs come from committed plans, never a mutable date, title or group label. */
export interface SessionCalendarEvent {
  uid: string;
  revision: number;
  startsAt: Date;
  endsAt: Date;
  updatedAt: Date;
  cancelled: boolean;
  location?: string | null;
}

function calendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function instant(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid calendar instant.");
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 folds at 75 octets, not 75 JS characters. Never split a UTF-8 code point. */
function foldLine(value: string): string {
  // Most properties already fit; retain the code-point folding path for long lines.
  if (Buffer.byteLength(value, "utf8") <= 75) return value;
  const lines: string[] = [];
  let line = "";
  let bytes = 0;
  for (const character of value) {
    const length = Buffer.byteLength(character, "utf8");
    if (bytes + length > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += character;
    bytes += length;
  }
  lines.push(line);
  return lines.join("\r\n");
}

/** A subscription publishes confirmed state, not iTIP invitations or response actions.
 * Cancelled components remain as tombstones with their original identity and newer sequence. */
export function renderSessionCalendar(events: readonly SessionCalendarEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SHBS Peer Tutoring//Private Session Schedule//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Tutoring sessions / 辅导课",
  ];
  const identities = new Set<string>();
  for (const event of events) {
    if (!event.uid || identities.has(event.uid) || !Number.isSafeInteger(event.revision) || event.revision < 0 ||
        event.endsAt.getTime() <= event.startsAt.getTime()) {
      throw new Error("Invalid calendar event identity or revision.");
    }
    identities.add(event.uid);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${calendarText(event.uid)}`,
      `SEQUENCE:${event.revision}`,
      `DTSTAMP:${instant(event.updatedAt)}`,
      `LAST-MODIFIED:${instant(event.updatedAt)}`,
      `DTSTART:${instant(event.startsAt)}`,
      `DTEND:${instant(event.endsAt)}`,
      `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "CLASS:PRIVATE",
      "SUMMARY:Tutoring session / 辅导课",
      "DESCRIPTION:Check the tutoring portal for the current schedule. / 请在辅导平台查看最新安排。",
      ...(event.location ? [`LOCATION:${calendarText(event.location)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
