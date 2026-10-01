import assert from "node:assert/strict";
import test from "node:test";

// Opt-in public response probe: never starts a server or submits a form. Run only
// against the scheduled isolated proxy or an approved deployed URL, without cookies.
assert.ok(
  process.env.TEST_BASE_URL,
  "Set TEST_BASE_URL to the HTTPS proxy URL explicitly",
);
const base = new URL(process.env.TEST_BASE_URL);
assert.equal(
  base.protocol,
  "https:",
  "Use the TLS proxy with a trusted certificate",
);
assert.equal(base.username + base.password + base.search + base.hash, "");
assert.equal(
  base.pathname,
  "/",
  "Supply the origin, without an application path",
);

const routes = [
  "/",
  "/signin",
  "/signup",
  "/register",
  "/viewer-signup",
  "/tutor-signup",
  "/crew-signup",
  "/localization",
  "/admin",
  "/icon.png",
  "/__security_header_missing_page__",
];

for (const route of routes) {
  test(`public security headers: ${route}`, async () => {
    // Manual redirects also check the policy on auth redirects, without leaking
    // credentials or silently following an unexpected external Location.
    const response = await fetch(new URL(route, base), {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    try {
      assert.ok(
        response.status >= 200 && response.status < 500,
        `Unexpected status ${response.status}`,
      );
      if (route !== "/__security_header_missing_page__")
        assert.notEqual(response.status, 404);
      const h = response.headers;
      assert.equal(h.get("strict-transport-security"), "max-age=86400");
      assert.equal(h.get("x-content-type-options"), "nosniff");
      assert.equal(h.get("referrer-policy"), "strict-origin-when-cross-origin");
      assert.equal(h.get("x-frame-options"), "DENY");
      assert.equal(
        h.get("content-security-policy"),
        "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      );
      const observation = h.get("content-security-policy-report-only");
      assert.ok(observation);
      assert.match(
        observation,
        /(?:^|;\s*)script-src 'self' https:\/\/o\.alicdn\.com(?:;|$)/,
      );
      assert.doesNotMatch(observation, /report-uri|report-to/);
      assert.equal(h.get("x-powered-by"), null);
      if (response.status >= 300 && response.status < 400) {
        const location = h.get("location");
        assert.ok(location, "Redirect must supply Location");
        assert.equal(new URL(location, base).origin, base.origin);
      }
    } finally {
      // Header checks do not need to retain page bodies or participant data.
      await response.body?.cancel();
    }
  });
}
