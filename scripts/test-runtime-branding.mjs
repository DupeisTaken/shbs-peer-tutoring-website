import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Run against the same built image before and after recreation, with expected runtime values.
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const title = process.env.APP_TITLE || "SHBS Peer Tutoring";
const branding = {
  APP_TITLE: title,
  TEAM_TITLE: process.env.TEAM_TITLE || "SHBS Peer Tutoring Team",
  ORG_NAME: process.env.ORG_NAME || title,
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || "",
  PROGRAM_TERM_LABEL: process.env.PROGRAM_TERM_LABEL || "",
};
const secrets = [
  "AUTH_SECRET",
  "SMTP_PASSWORD",
  "DATABASE_URL",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
]
  .map((key) => process.env[key])
  .filter(Boolean);
const scripts = new Set();

for (const [path, prefix] of [
  ["/", ""],
  ["/signin", ""],
  ["/register", "Register"],
  ["/forgot-password", "Forgot password"],
  ["/reset-password", "Reset password"],
  ["/signup", "Request a tutor"],
  ["/tutor-signup", "Become a tutor"],
]) {
  test(`${path}: runtime title, public client projection and no server secrets`, async () => {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200);
    const html = await response.text();
    const dom = new JSDOM(html);
    try {
      assert.equal(
        dom.window.document.title,
        prefix ? `${prefix} · ${title}` : title,
      );
      // Decode React's script-string transport without executing any page JavaScript.
      const flight = [...dom.window.document.querySelectorAll("script")]
        .map((script) => {
          if (script.src) scripts.add(script.getAttribute("src"));
          const match = /^self\.__next_f\.push\((.*)\)$/.exec(
            script.textContent,
          );
          return match ? (JSON.parse(match[1])[1] ?? "") : "";
        })
        .join("");
      assert.ok(
        flight.includes(JSON.stringify(branding)),
        "client provider must receive exactly the public branding projection",
      );
      if (path === "/")
        assert.ok(dom.window.document.body.textContent.includes(title));
      for (const secret of secrets) {
        assert.ok(
          !html.includes(secret),
          "HTML must not expose a server-only value",
        );
        assert.ok(
          !flight.includes(secret),
          "React payload must not expose a server-only value",
        );
      }
    } finally {
      dom.window.close();
    }
  });
}

test("delivered browser bundles contain no server-only values", async () => {
  assert.ok(scripts.size > 0);
  for (const path of scripts) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200);
    const javascript = await response.text();
    for (const secret of secrets)
      assert.ok(
        !javascript.includes(secret),
        "browser bundle must not expose a server-only value",
      );
  }
});
