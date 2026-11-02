import { db } from "~/server/db";
import { sessionCalendarFeed } from "~/server/session-planning-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

/** Calendar clients cannot use an interactive sign-in cookie. This opaque read-only
 * capability is validated by the service on every fetch; GET never decides a request. */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    const calendar = await sessionCalendarFeed(db, token);
    if (!calendar) return new Response("Calendar unavailable.", { status: 404, headers });
    return new Response(calendar, {
      headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="tutoring-sessions.ics"' },
    });
  } catch {
    // Never log/reflect a capability, roster identity, database or configuration exception.
    return new Response("Calendar temporarily unavailable.", { status: 503, headers });
  }
}
