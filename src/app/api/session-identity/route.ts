import { auth } from "~/server/auth";
import { sessionIdentity } from "~/lib/session-identity";

/** Identity checks must be read-only: an in-flight /api/auth/session response can
 * renew an old JWT cookie after a concurrent sign-out has already cleared it. */
export async function GET() {
  return Response.json(
    { identity: sessionIdentity(await auth()) },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
