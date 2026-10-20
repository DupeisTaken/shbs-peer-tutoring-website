// Rendered #443 regression. Run serially against an isolated, demo-seeded site.
// Synthetic codes are edited only; no challenge is redeemed or email sent.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  process.env.SHBS_BROWSER_MODULE ?? "playwright"
);
const base = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3000");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
assert.ok(
  process.env.SHBS_BROWSER_STATE,
  "Provide a synthetic authenticated storage state",
);
const output = path.resolve(
  process.env.SHBS_BROWSER_OUTPUT ?? "outputs/code-fields",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.SHBS_BROWSER_CHANNEL,
  headless: true,
});
const context = await browser.newContext();
const page = await context.newPage();
const measurements = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function inspect(input, purpose, positions) {
  const field = input.locator("xpath=../..");
  assert.equal(await field.getAttribute("data-code-purpose"), purpose);
  assert.equal(await field.locator(".code-positions span").count(), positions);
  assert.equal(await input.getAttribute("inputmode"), "numeric");
  assert.equal(await input.getAttribute("autocomplete"), "one-time-code");
  const bounds = await input.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      scroll: element.scrollLeft,
      parentScroll: element.parentElement.scrollLeft,
      color: style.color,
      background: getComputedStyle(
        element.parentElement.querySelector(".code-positions span"),
      ).backgroundColor,
    };
  });
  assert.ok(bounds.height >= 44, "Code input preserves touch targets");
  assert.equal(
    bounds.scroll,
    0,
    "Complete code stays visible without input scrolling",
  );
  assert.equal(
    bounds.parentScroll,
    0,
    "Caret focus must not scroll decorative slots",
  );
  measurements.push({ purpose, positions, ...bounds });
}

try {
  for (const locale of ["en", "zh"]) {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: locale, domain: base.hostname, path: "/" },
    ]);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [purpose, query, code] of [
        ["invitation", "", "00123"],
        ["email", "?invitation=synthetic-visual-fixture", "0123"],
      ]) {
        await page.goto(new URL(`/register-account${query}`, base).href);
        const input = page.locator(`[data-code-purpose="${purpose}"] input`);
        await input.waitFor();
        // The server HTML precedes hydration; wait for React's input handler before typing.
        await input.evaluate(
          (element) =>
            new Promise((resolve) => {
              const ready = () =>
                Object.keys(element).some((key) =>
                  key.startsWith("__reactProps"),
                )
                  ? resolve()
                  : setTimeout(ready, 50);
              ready();
            }),
        );
        await inspect(input, purpose, code.length);
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-empty.png`),
        });
        await input.pressSequentially(code.slice(0, 2));
        assert.equal(await input.inputValue(), code.slice(0, 2));
        await inspect(input, purpose, code.length);
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-partial.png`),
        });
        await input.pressSequentially(code.slice(2));
        assert.equal(await input.inputValue(), code);
        await inspect(input, purpose, code.length);
        await input.press("Home");
        await input.press("ArrowRight");
        await input.press("Delete");
        await input.pressSequentially(code[1]);
        assert.equal(
          await input.inputValue(),
          code,
          "Mid-code correction retains leading zero",
        );
        // Dispatch a real clipboard event; clipboard permissions vary by desktop OS.
        await input.selectText();
        await input.evaluate((element) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", "A1B2-C3D4-E5F6");
          element.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
        assert.equal(await input.inputValue(), "A1B2C3D4E5F6");
        assert.equal(
          await input.locator("..").getAttribute("data-legacy"),
          "true",
        );
        await input.fill(code); // Native full-value replacement also models OTP autofill.
        await input.press("Tab");
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await input.evaluate((element) => element === document.activeElement),
          true,
        );
        await input.press("End");
        await inspect(input, purpose, code.length);
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-filled.png`),
        });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await inspect(input, purpose, code.length);
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-enlarged.png`),
        });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });
      }
    }
  }

  const staffState = JSON.parse(
    await readFile(process.env.SHBS_BROWSER_STATE, "utf8"),
  );
  await context.addCookies(staffState.cookies);
  await page.goto(new URL("/ui-gallery", base).href);
  await page.locator("#code-purpose").waitFor();
  for (const locale of ["en", "zh"]) {
    await page
      .locator("main > section[aria-label] select")
      .nth(0)
      .selectOption(locale);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const theme of [
        "indigo",
        "violet",
        "emerald",
        "rose",
        "amber",
        "sky",
      ]) {
        await page
          .locator("main > section[aria-label] select")
          .nth(1)
          .selectOption(theme);
        const recipe = page.locator("#code-purpose");
        for (const [purpose, code] of [
          ["invitation", "00123"],
          ["email", "0123"],
        ]) {
          const input = recipe.locator(
            `[data-code-purpose="${purpose}"] input`,
          );
          await input.fill(code);
          await inspect(input, purpose, code.length);
        }
        await recipe.screenshot({
          path: path.join(output, `gallery-${locale}-${width}-${theme}.png`),
        });
      }
    }
  }
  const recipe = page.locator("#code-purpose");
  await recipe.getByRole("button", { name: "切换错误状态" }).click();
  assert.equal(await recipe.getByRole("alert").count(), 1);
  await recipe.getByRole("button", { name: "切换待处理状态" }).click();
  assert.equal(await recipe.locator("input").first().isDisabled(), true);
  assert.equal(await recipe.locator("input").first().inputValue(), "00123");
  await recipe.screenshot({
    path: path.join(output, "gallery-pending-error.png"),
  });

  if (process.env.SHBS_EMAIL_PREVIEWS) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const sample of ["invitation", "code", "legacy-invitation"]) {
        const file = path.resolve(
          process.env.SHBS_EMAIL_PREVIEWS,
          `${sample}.html`,
        );
        await readFile(file); // Fail clearly if offline previews were not generated.
        await page.goto(pathToFileURL(file).href);
        await page.screenshot({
          path: path.join(output, `email-${sample}-${width}.png`),
          fullPage: true,
        });
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "measurements.json"),
    JSON.stringify(measurements, null, 2),
  );
  console.log(
    `Verified ${measurements.length} rendered code fields; screenshots saved in ${output}`,
  );
} finally {
  await context.close();
  await browser.close();
}
