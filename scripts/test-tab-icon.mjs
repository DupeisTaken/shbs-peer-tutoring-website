import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Exercise the running Next.js server so this checks generated metadata and the
// delivered image together, including inheritance on pages with custom titles.
const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const expected = await readFile(
  new URL("../src/app/icon.png", import.meta.url),
);

for (const path of ["/forgot-password", "/reset-password"]) {
  test(`${path} advertises and serves the project PNG`, async () => {
    const page = await fetch(new URL(path, baseUrl));
    assert.equal(page.status, 200);
    const html = await page.text();
    const icons = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map(([tag]) =>
        Object.fromEntries(
          [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [
            key,
            value,
          ]),
        ),
      )
      .filter((attributes) => attributes.rel === "icon");

    assert.equal(icons.length, 1, "Each page should have exactly one tab icon");
    const icon = icons[0];
    const url = new URL(icon.href.replaceAll("&amp;", "&"), baseUrl);
    assert.equal(url.pathname, "/icon.png");
    assert.equal(icon.type, "image/png");

    const response = await fetch(url, { redirect: "manual" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^image\/png\b/);
    const actual = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(
      actual.subarray(0, 8),
      Buffer.from("89504e470d0a1a0a", "hex"),
    );
    assert.deepEqual(
      actual,
      expected,
      "The browser must receive the replacement file unchanged",
    );
    // The generated sizes must follow the image, not a hardcoded placeholder size.
    assert.equal(
      icon.sizes,
      `${expected.readUInt32BE(16)}x${expected.readUInt32BE(20)}`,
    );
  });
}

// Exempting the favicon must not make private pages or similarly named paths public.
for (const path of ["/admin", "/icon.png/private", "/reports.png"]) {
  test(`${path} still requires sign-in`, async () => {
    const response = await fetch(new URL(path, baseUrl), {
      redirect: "manual",
    });
    assert.equal(response.status, 307);
    const destination = new URL(response.headers.get("location"), baseUrl);
    assert.equal(destination.pathname, "/signin");
  });
}
