import assert from "node:assert/strict";
import test from "node:test";

// Exercise Next's actual redirect engine, including query forwarding and proxy boundaries.
// Run serially against a local site with synthetic data: TEST_BASE_URL=... node --test ...
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const aliases = [
  ["/register", "/register-account"],
  ["/tutee", "/tutee-signup"],
  ["/tutor", "/tutor-signup"],
  ["/viewer", "/viewer-signup"],
  ["/crew", "/crew-signup"],
  ["/tutee/account", "/tutee-signup/account"],
  ["/signup", "/tutee-signup"],
  ["/signup/account", "/tutee-signup/account"],
];
const query = "code=AB3D7&token=synthetic%2Btoken&callbackUrl=%2Fstudent%3Ftab%3Drequests&source=one&source=two&empty=&name=%E4%B8%AD%E6%96%87";
for (const [source, destination] of aliases) {
  test(`${source} permanently redirects with every query value`, async () => {
    const response = await fetch(`${base}${source}?${query}`, { redirect: "manual" });
    assert.equal(response.status, 308);
    const location = new URL(response.headers.get("location"), base);
    assert.equal(location.pathname, destination);
    assert.deepEqual([...location.searchParams], [...new URLSearchParams(query)]);
  });
}
for (const path of ["/register-account/admin", "/tutee-signup/account/admin", "/tutee-signup-private", "/tutor/admin", "/viewer/settings", "/crew/admin", "/signup/admin"]) {
  test(`${path} remains protected`, async () => {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location"), base);
    assert.equal(location.pathname, "/signin");
    assert.equal(new URL(location.searchParams.get("callbackUrl"), base).pathname, path);
  });
}
