# Session recovery and shared-device navigation

Use one stable, randomly generated `AUTH_SECRET` for the lifetime of a local
installation. Generate it once, save it in that checkout's ignored `.env`, and
restart the server after changing it. Every production instance must use the same
configured secret. Do not regenerate it on each startup or paste it into logs.

An old browser cookie from a different development secret cannot be decrypted by
the current server. Different localhost ports share cookies, so separate worktrees
with different secrets should use separate browser profiles. A fresh private browser
session is useful to distinguish an old cookie from a configuration problem.

The HTTP proxy verifies existing Auth.js session cookies with Auth.js's own JWT
verification before rendering pages. Rejected or expired cookies, including chunks,
are expired. Page requests lead to a local sign-in page with an explanation. API
requests continue without the rejected cookie and retain their normal authorization
checks. Unrelated preferences and CSRF cookies are preserved. This prevents the same
bad cookie from repeatedly reaching Server Components, where `auth()` cannot commit
cookie cleanup. Auth.js error logging remains enabled.

If an API request detects the problem first, a 60-second, HttpOnly presentation
marker carries the explanation into the next sign-in screen. That response consumes
the marker. It grants no authentication capability and cannot make a rejected JWT
valid.

If a fresh sign-in remains valid across refresh, the old cookie was stale. If fresh
sign-ins immediately fail or different server instances disagree, check the active
process's environment, stable secret, canonical `AUTH_URL`, proxy HTTPS configuration
and whether multiple local apps share the same cookie host. Missing secret
configuration remains an error; recovery does not supply a default or accept an
unverifiable token. The verifier uses the exact secret configuration resolved by
Auth.js, including an explicitly configured rotation array.

Client query and mutation caches belong to an account, current role and tutor link.
Cookie-changing sign-in/sign-out actions refresh the server identity and replace
the cache. When a tab regains focus or changes routes, it checks the live session
before displaying/refetching cached content. A changed identity clears the cache
and reloads server layouts. A failed identity check also reloads through normal
server authentication. Current server role and ownership checks remain authoritative.
Forbidden and unauthenticated queries do not retry; transient failures have a
bounded retry budget.

The identity check uses `/api/session-identity`, which returns no session cookie.
Background page, prefetch and server-action proxy responses do not renew session
cookies: a late background response must not restore the previous login after
sign-out. Full-document GET navigation still refreshes the normal Auth.js expiry
and rotates tokens using its current configured secret. Sign-in/session/logout
API actions retain their cookie writes, and explicit Auth.js cookie deletions are
always preserved. Staying entirely in client-side navigation does not extend the
cookie lifetime (Auth.js defaults to 30 days); normal expiry requires sign-in.
Regression tests preserve unauthenticated page redirects as well as API
authorization; the Auth.js middleware callback-wrapper API is not used to bypass
the default redirect.

Management Actions obtains requester filter options in its server-authorized queue
response. A coordinator receives only their own requests and no requester directory.
The separate administrator-only directory endpoint remains restricted, but the page
does not enable it from a potentially stale cached `canReview` flag.

See [local setup](local-development.md), [management review](coordinator-approvals.md)
and [the technical report](technical-report.md#identity-and-authorization).
