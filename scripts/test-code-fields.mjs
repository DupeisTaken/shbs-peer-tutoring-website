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

async function inspect(input, purpose, scenario = {}) {
  const positions = purpose === "invitation" ? 5 : 4;
  const field = input.locator("..");
  const value = await input.inputValue();
  assert.equal(await field.getAttribute("data-code-purpose"), purpose);
  assert.equal(await field.locator("input").count(), 1);
  assert.equal(await field.locator(".code-positions,button").count(), 0);
  assert.equal(await input.getAttribute("placeholder"), "X".repeat(positions));
  assert.equal(await input.getAttribute("type"), "text");
  assert.equal(
    await input.getAttribute("inputmode"),
    purpose === "invitation" || /[A-Z]/i.test(value) ? "text" : "numeric",
  );
  assert.equal(await input.getAttribute("autocomplete"), "one-time-code");
  const help = field.locator('p[id$="-help"]');
  assert.match(await help.getAttribute("class"), /\bsr-only\b/);
  assert.ok(
    (await help.textContent()).trim().length > 0,
    "Guidance remains available to assistive technology",
  );
  const bounds = await input.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const parent = element.parentElement;
    // Compare with the same legacy .input classes in the same page context.
    // Only the purpose background may differ; the website's shared font is sans.
    const reference = document.createElement("input");
    reference.className = element.className.replace(/\bcode-native\b/g, "");
    reference.placeholder = element.placeholder;
    reference.style.position = "absolute";
    reference.style.visibility = "hidden";
    reference.style.pointerEvents = "none";
    parent.append(reference);
    const legacy = getComputedStyle(reference);
    const inheritedProperties = [
      "color",
      "fontFamily",
      "fontSize",
      "lineHeight",
      "letterSpacing",
      "borderRadius",
      "textAlign",
      "textTransform",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
    ];
    const typography = Object.fromEntries(
      inheritedProperties.map((property) => [property, style[property]]),
    );
    const legacyTypography = Object.fromEntries(
      inheritedProperties.map((property) => [property, legacy[property]]),
    );
    const placeholder = getComputedStyle(element, "::placeholder").color;
    const legacyPlaceholder = getComputedStyle(
      reference,
      "::placeholder",
    ).color;
    const legacyBorder = legacy.borderColor;
    reference.remove();
    const text = element.value || element.placeholder;
    const canvas = document.createElement("canvas");
    const measure = canvas.getContext("2d");
    measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const textWidth =
      measure.measureText(text).width +
      (parseFloat(style.letterSpacing) || 0) * text.length;
    const placeholderWidth =
      measure.measureText(element.placeholder).width +
      (parseFloat(style.letterSpacing) || 0) * element.placeholder.length;
    const contentWidth =
      element.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      scroll: element.scrollLeft,
      parentScroll: parent.scrollLeft,
      fieldWidth: parent.clientWidth,
      fieldScrollWidth: parent.scrollWidth,
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      color: style.color,
      background: style.backgroundColor,
      border: style.borderColor,
      legacyBorder,
      placeholder,
      legacyPlaceholder,
      typography,
      legacyTypography,
      focused: element === document.activeElement,
      selectionEnd: element.selectionEnd,
      textWidth,
      placeholderWidth,
      contentWidth,
    };
  });
  assert.ok(bounds.height >= 44, "Code input preserves touch targets");
  assert.equal(
    bounds.background,
    purpose === "invitation" ? "rgb(240, 253, 244)" : "rgb(239, 246, 255)",
  );
  assert.deepEqual(
    bounds.typography,
    bounds.legacyTypography,
    "Purpose retains the shared legacy typography and spacing",
  );
  assert.equal(
    bounds.placeholder,
    bounds.legacyPlaceholder,
    "X placeholders retain the shared neutral gray",
  );
  if (!bounds.focused)
    assert.equal(
      bounds.border,
      bounds.legacyBorder,
      "Unfocused code input retains the shared neutral border",
    );
  const enlarged = scenario.state?.includes("enlarged");
  if (value.length <= positions && !enlarged) {
    assert.equal(
      bounds.scroll,
      0,
      "New-length code stays visible without native input scrolling",
    );
    assert.ok(
      bounds.textWidth <= bounds.contentWidth + 1,
      "New-length code fits at the current text size",
    );
  }
  if (!enlarged)
    assert.ok(
      bounds.placeholderWidth <= bounds.contentWidth + 1,
      "All gray X placeholders fit at the standard text size",
    );
  if (
    bounds.focused &&
    value &&
    bounds.selectionEnd === value.length &&
    bounds.textWidth > bounds.contentWidth + 1
  )
    assert.ok(
      bounds.scroll > 0,
      "The native editor scrolls to reveal the end of a long or enlarged code",
    );
  assert.equal(
    bounds.parentScroll,
    0,
    "Native caret navigation must not scroll the surrounding field",
  );
  assert.ok(
    bounds.fieldScrollWidth <= bounds.fieldWidth + 1,
    "The input does not overflow its field",
  );
  assert.ok(
    bounds.documentScrollWidth <= bounds.documentWidth + 1,
    "The page has no horizontal overflow",
  );
  assert.ok(
    bounds.left >= -1 && bounds.right <= bounds.documentWidth + 1,
    "The complete input remains within the viewport",
  );
  measurements.push({ purpose, positions, value, ...scenario, ...bounds });
}

try {
  for (const locale of ["en", "zh"]) {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: locale, domain: base.hostname, path: "/" },
    ]);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [purpose, query, code] of [
        ["invitation", "", "A2B3C"],
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
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const scenario = { locale, viewport: width, page: "registration" };
        await inspect(input, purpose, { ...scenario, state: "empty" });
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-empty.png`),
        });
        await input.pressSequentially(code.slice(0, 2));
        assert.equal(await input.inputValue(), code.slice(0, 2));
        await inspect(input, purpose, { ...scenario, state: "partial" });
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-partial.png`),
        });
        await input.pressSequentially(code.slice(2));
        assert.equal(await input.inputValue(), code);
        await inspect(input, purpose, { ...scenario, state: "typed" });
        await input.press("Home");
        await input.press("ArrowRight");
        await input.press("Delete");
        await input.pressSequentially(code[1]);
        assert.equal(
          await input.inputValue(),
          code,
          "Mid-code correction preserves the entire mixed or leading-zero code",
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
        assert.equal(await input.getAttribute("inputmode"), "text");
        // A long outstanding code may use ordinary native scrolling. Both ends
        // must remain reachable without truncating the value or the page layout.
        await input.press("Home");
        assert.equal(
          await input.evaluate((element) => element.selectionStart),
          0,
        );
        assert.equal(await input.evaluate((element) => element.scrollLeft), 0);
        await input.press("End");
        assert.equal(
          await input.evaluate((element) => element.selectionStart),
          12,
        );
        assert.equal(await input.inputValue(), "A1B2C3D4E5F6");
        await inspect(input, purpose, { ...scenario, state: "legacy12" });
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-legacy12.png`),
        });
        if (purpose === "invitation") {
          await input.fill("00123");
          await input.press("End");
          assert.equal(await input.inputValue(), "00123");
          assert.equal(await input.getAttribute("inputmode"), "text");
          await inspect(input, purpose, {
            ...scenario,
            state: "legacy-numeric",
          });
        }
        await input.fill(code); // Native full-value replacement also models OTP autofill.
        assert.equal(
          await input.getAttribute("inputmode"),
          purpose === "invitation" ? "text" : "numeric",
        );
        await input.press("Tab");
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await input.evaluate((element) => element === document.activeElement),
          true,
        );
        await input.press("End");
        await inspect(input, purpose, { ...scenario, state: "filled" });
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-filled.png`),
        });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        // Preserve the requested legacy font and tracking at enlarged text.
        // On narrow viewports the native editor scrolls; allow paint to update
        // its scroll range and verify both ends without shrinking the text.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await input.press("Home");
        assert.equal(
          await input.evaluate((element) => element.selectionStart),
          0,
        );
        assert.equal(await input.evaluate((element) => element.scrollLeft), 0);
        await input.press("End");
        assert.equal(
          await input.evaluate((element) => element.selectionStart),
          code.length,
        );
        assert.equal(await input.inputValue(), code);
        await inspect(input, purpose, { ...scenario, state: "enlarged" });
        await page.screenshot({
          path: path.join(output, `${purpose}-${locale}-${width}-enlarged.png`),
        });
        await input.fill("A1B2C3D4E5F6");
        await input.press("Home");
        assert.equal(
          await input.evaluate((element) => element.selectionStart),
          0,
        );
        assert.equal(await input.evaluate((element) => element.scrollLeft), 0);
        await input.press("End");
        assert.equal(
          await input.evaluate((element) => element.selectionStart),
          12,
        );
        assert.equal(await input.inputValue(), "A1B2C3D4E5F6");
        await inspect(input, purpose, {
          ...scenario,
          state: "legacy12-enlarged",
        });
        await page.screenshot({
          path: path.join(
            output,
            `${purpose}-${locale}-${width}-legacy12-enlarged.png`,
          ),
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
          ["invitation", "A2B3C"],
          ["email", "0123"],
        ]) {
          const input = recipe.locator(
            `[data-code-purpose="${purpose}"] input`,
          );
          await input.fill(code);
          await inspect(input, purpose, {
            locale,
            viewport: width,
            page: "gallery",
            theme,
            state: "filled",
          });
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
  assert.equal(await recipe.locator("input").first().inputValue(), "A2B3C");
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
        const code = page.locator(".code");
        assert.equal(await code.count(), 1);
        assert.equal(
          await page.locator(".code-panel,.code-label,.code-guidance").count(),
          0,
        );
        assert.equal(
          await code.textContent(),
          sample === "code"
            ? "0012"
            : sample === "invitation"
              ? "A2B3C"
              : "012345ABCDEF",
        );
        const rendered = await code.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            children: element.children.length,
            background: style.backgroundColor,
            color: style.color,
            borderColor: style.borderColor,
            borderWidth: style.borderWidth,
            padding: style.padding,
            marginBottom: style.marginBottom,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            letterSpacing: style.letterSpacing,
            documentWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
          };
        });
        assert.equal(rendered.children, 0);
        assert.equal(
          rendered.background,
          sample === "code" ? "rgb(23, 47, 73)" : "rgb(24, 52, 44)",
        );
        assert.equal(rendered.color, "rgb(173, 201, 255)");
        assert.equal(rendered.borderColor, "rgb(73, 83, 98)");
        assert.equal(rendered.borderWidth, "1px");
        assert.equal(rendered.padding, "22px");
        assert.equal(rendered.marginBottom, "26px");
        assert.match(rendered.fontFamily, /Consolas/i);
        assert.equal(rendered.fontSize, "30px");
        assert.equal(rendered.letterSpacing, "5px");
        assert.ok(
          rendered.documentScrollWidth <= rendered.documentWidth + 1,
          "Legacy email layout remains within the viewport",
        );
        measurements.push({
          page: "email",
          sample,
          viewport: width,
          ...rendered,
        });
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
