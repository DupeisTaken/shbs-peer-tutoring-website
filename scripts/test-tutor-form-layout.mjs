// Rendered regression for #215. Use a local dev site, an authenticated synthetic
// staff session and an existing Playwright runtime; this script submits no data.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const interactions = [];
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const form = page.locator("form").filter({ has: page.locator('[name="firstName"]') });
const dialog = page.getByRole("dialog");
try {
  for (const locale of ["en", "zh"]) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: base.hostname, path: "/" }]);
    await page.goto(new URL("/admin/tutors", base).href);
    await page.locator("tbody tr").first().waitFor();
    const title = messages.admin.tutors.addTutor;
    const trigger = page.locator('button[aria-haspopup="dialog"]').filter({hasText: title});
    assert.equal(await dialog.count(), 0, "Roster starts without creation controls");
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height: width < 600 ? 844 : 1000});
      await page.screenshot({path: path.join(output, `screenshots/after-roster-${locale}-${width}.png`)});
      const roster = await page.locator("table").evaluate(table => ({top: table.getBoundingClientRect().top, scrollWidth: document.documentElement.scrollWidth}));
      assert.ok(roster.top < (width < 600 ? 844 : 1000));
      assert.ok(roster.scrollWidth <= width);
      assert.equal(await trigger.evaluate(e => e.getBoundingClientRect().height), width < 1024 ? 44 : 40);
      interactions.push({locale, width, roster});
    }
    await trigger.click();
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(e => e.matches(":modal")), true);
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
      assert.ok(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth), "Dialog must not scroll sideways");
      evidence.push({ locale, width, ...sizes });
      await page.screenshot({ path: path.join(output, `screenshots/after-form-${locale}-${width}.png`) });
    }
    // The native modal contains keyboard focus, and Escape retains the page-local draft.
    const values = {firstName: "Ada", lastName: "Lovelace", preferredName: "Ada", alternativeNames: "艾达", email: "ada@example.test"};
    for (const [name, value] of Object.entries(values)) await form.locator(`[name="${name}"]`).fill(value);
    await form.locator("select").selectOption("GRADUATED");
    const close = dialog.getByRole("button", {name: messages.accountProfile.close, exact: true});
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await form.locator("button").evaluate(e => e === document.activeElement), true);
    await page.keyboard.press("Tab");
    assert.equal(await close.evaluate(e => e === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0);
    assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
    await trigger.click();
    for (const [name, value] of Object.entries(values)) assert.equal(await form.locator(`[name="${name}"]`).inputValue(), value);
    assert.equal(await form.locator("select").inputValue(), "GRADUATED");
    interactions.push({locale, modal: true, keyboardFocusContained: true, escapeRetainsDraft: true, triggerFocusRestored: true});
    // Validation helpers can grow without stretching the adjacent single-line input.
    await page.locator('[name="firstName"]').fill("张");
    await page.locator('[name="firstName"]').blur();
    assert.equal(await page.locator('[name="firstName"]').getAttribute("aria-invalid"), "true");
    await page.locator('[type="email"]').fill("invalid");
    assert.equal(await form.evaluate(form => form.checkValidity()), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.evaluate(e => { e.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, `screenshots/after-validation-${locale}-390.png`) });
    await form.locator("button").scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(output, `screenshots/after-dialog-footer-${locale}-390.png`)});
    if (locale === "en") {
      await close.click();
      assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth));
  await dialog.evaluate(e => { e.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "screenshots/after-enlarged-text-zh-390.png") });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "layout.json"), JSON.stringify({ evidence, interactions, errors, validationAndEnlargedText: "passed" }, null, 2));
  console.log(`Passed ${evidence.length} locale/viewport layout cases plus validation and enlarged text.`);
} finally {
  await browser.close();
}
