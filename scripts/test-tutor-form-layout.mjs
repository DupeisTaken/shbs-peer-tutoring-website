// Rendered regression for #215. Use a local dev site, an authenticated synthetic
// staff session and an existing Playwright runtime; this script submits no data.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const { chromium } = await import(process.env.SHBS_BROWSER_MODULE ?? "playwright");
const base = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3000");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname), "Use a loopback test site");
assert.ok(process.env.SHBS_BROWSER_STATE, "Provide an authenticated synthetic staff storage state");
const output = process.env.SHBS_BROWSER_OUTPUT ?? "outputs/tutor-form-layout";
await mkdir(path.join(output, "screenshots"), { recursive: true });
const browser = await chromium.launch({ channel: process.env.SHBS_BROWSER_CHANNEL, headless: true });
const context = await browser.newContext({ storageState: process.env.SHBS_BROWSER_STATE });
const page = await context.newPage();
const evidence = [];
const form = page.locator("form").filter({ has: page.locator('[name="firstName"]') });
try {
  for (const locale of ["en", "zh"]) {
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: base.hostname, path: "/" }]);
    await page.goto(new URL("/admin/tutors", base).href);
    await page.locator('form input[type="email"]').waitFor();
    for (const width of [375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      const sizes = await form.evaluate(form => {
        const box = selector => {
          const element = form.querySelector(selector);
          const { height, top, width } = element.getBoundingClientRect();
          return { height, top, width, required: element.required };
        };
        return { first: box('[name="firstName"]'), email: box('[type="email"]'), grade: box("select"), action: box('button'), scrollWidth: document.documentElement.scrollWidth,
          headers: [...document.querySelectorAll('header a,header button,header select')].filter(e => e.checkVisibility()).map(e => ({ text: e.getAttribute('aria-label') || e.textContent, height: e.getBoundingClientRect().height })) };
      });
      assert.equal(sizes.email.height, sizes.first.height, `${locale}/${width}: email must match name input`);
      for (const key of ["first", "email", "grade", "action"]) assert.equal(sizes[key].height, width >= 1024 ? 40 : 44, `${locale}/${width}: ${key}`);
      if (width >= 1280) assert.equal(sizes.email.top, sizes.first.top, "Align first row inputs");
      assert.equal(sizes.email.required, false);
      assert.equal(sizes.first.required, true);
      assert.ok(sizes.scrollWidth <= width);
      evidence.push({ locale, width, ...sizes });
      await page.screenshot({ path: path.join(output, `screenshots/after-form-${locale}-${width}.png`) });
    }
    // Validation helpers can grow without stretching the adjacent single-line input.
    await page.locator('[name="firstName"]').fill("张");
    await page.locator('[name="firstName"]').blur();
    assert.equal(await page.locator('[name="firstName"]').getAttribute("aria-invalid"), "true");
    await page.locator('[type="email"]').fill("invalid");
    assert.equal(await form.evaluate(form => form.checkValidity()), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, `screenshots/after-validation-${locale}-390.png`) });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "screenshots/after-enlarged-text-zh-390.png") });
  await writeFile(path.join(output, "layout.json"), JSON.stringify({ evidence, validationAndEnlargedText: "passed" }, null, 2));
  console.log(`Passed ${evidence.length} locale/viewport layout cases plus validation and enlarged text.`);
} finally {
  await browser.close();
}
