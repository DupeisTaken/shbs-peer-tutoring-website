// Rendered regression for compact table actions. Supply a local development site
// and a synthetic staff session; one owned browser runs serially and submits no data.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const { chromium } = await import(
  process.env.SHBS_BROWSER_MODULE ?? "playwright"
);
const base = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3000");
assert.ok(
  ["localhost", "127.0.0.1"].includes(base.hostname),
  "Use a loopback test site",
);
assert.ok(
  process.env.SHBS_BROWSER_STATE,
  "Provide an authenticated synthetic staff storage state",
);
const output = process.env.SHBS_BROWSER_OUTPUT ?? "outputs/table-action-layout";
await mkdir(path.join(output, "screenshots"), { recursive: true });
const evidence = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  role: "synthetic staff",
  layouts: [],
  interactions: [],
  palettes: [],
  errors: [],
};
const browser = await chromium.launch({
  channel: process.env.SHBS_BROWSER_CHANNEL,
  headless: true,
});
// Include setup in this ownership boundary: invalid session files and failed page
// creation must release the browser just as failed assertions do.
try {
  await verify();
} finally {
  try {
    // Save partial measurements even when a later case fails.
    await writeFile(
      path.join(output, "layout.json"),
      JSON.stringify(evidence, null, 2),
    );
  } finally {
    // Evidence output can itself fail (for example a full disk); always close.
    await browser.close();
  }
}

async function verify() {
  const context = await browser.newContext({
    storageState: process.env.SHBS_BROWSER_STATE,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  const near = (actual, expected, message) =>
    assert.ok(
      Math.abs(actual - expected) < 0.6,
      `${message}: ${actual} != ${expected}`,
    );
  const table = () =>
    page
      .locator(".summary-table-scroll")
      .filter({ has: page.locator(".table-action-link") })
      .first();

  async function capture(name) {
    await table().evaluate((region) => {
      // An oversized table must start below the sticky header, not be centered
      // with its first rows clipped. Desktop main panes own their own scrolling.
      region.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "instant",
      });
      region.scrollLeft = 0;
      const headerBottom = Math.max(
        0,
        ...[...document.querySelectorAll("[data-sticky-header]")]
          .filter(
            (header) =>
              header.checkVisibility() &&
              ["sticky", "fixed"].includes(getComputedStyle(header).position),
          )
          .map((header) => header.getBoundingClientRect().bottom),
      );
      let scrollParent = region.parentElement;
      while (
        scrollParent &&
        !(
          ["auto", "scroll"].includes(
            getComputedStyle(scrollParent).overflowY,
          ) && scrollParent.scrollHeight > scrollParent.clientHeight
        )
      ) {
        scrollParent = scrollParent.parentElement;
      }
      const top =
        Math.max(headerBottom, scrollParent?.getBoundingClientRect().top ?? 0) +
        12;
      const adjustment = region.getBoundingClientRect().top - top;
      (scrollParent ?? window).scrollBy({
        top: adjustment,
        behavior: "instant",
      });
    });
    await page.screenshot({
      path: path.join(output, "screenshots", `${name}.png`),
    });
  }

  async function measure() {
    return table().evaluate((region) => {
      const bounds = (element) => {
        const { top, bottom, left, right, width, height } =
          element.getBoundingClientRect();
        return { top, bottom, left, right, width, height };
      };
      // Three rows suffice for stacked spacing without walking a large directory.
      const lists = [...region.querySelectorAll(".table-action-list")]
        .slice(0, 3)
        .map((list) => ({
          gap: getComputedStyle(list).rowGap,
          links: [...list.querySelectorAll(".table-action-link")]
            .filter((link) => link.checkVisibility())
            .map((link) => ({
              text: link.textContent.trim(),
              ...bounds(link),
              minHeight: parseFloat(getComputedStyle(link).minHeight),
              scrollHeight: link.scrollHeight,
              clientHeight: link.clientHeight,
            })),
        }));
      return {
        lists,
        region: bounds(region),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        scrollLeft: region.scrollLeft,
        scrollWidth: region.scrollWidth,
        clientWidth: region.clientWidth,
        actions: bounds(region.querySelector(".table-actions")),
        sticky: getComputedStyle(region.querySelector(".table-actions"))
          .position,
      };
    });
  }

  function assertLayout(sample, width, label, enlarged = false) {
    const minimum = width >= 1024 ? 24 : 44;
    assert.ok(
      sample.documentWidth <= width + 1,
      `${label}: page must not scroll horizontally`,
    );
    assert.ok(
      sample.lists.length > 0,
      `${label}: populated action list required`,
    );
    for (const list of sample.lists) {
      near(parseFloat(list.gap), 0, `${label}: no added action gap`);
      assert.ok(list.links.length > 0, `${label}: visible links required`);
      for (const [index, link] of list.links.entries()) {
        assert.ok(
          link.height >= minimum - 0.6,
          `${label}: ${link.text} target too short`,
        );
        if (!enlarged)
          near(
            link.minHeight,
            minimum,
            `${label}: ${link.text} responsive minimum`,
          );
        assert.ok(
          link.scrollHeight <= link.clientHeight + 1,
          `${label}: clipped action text`,
        );
        if (index)
          near(
            link.top,
            list.links[index - 1].bottom,
            `${label}: adjacent targets must touch without overlap`,
          );
      }
    }
    assert.equal(
      sample.sticky,
      "sticky",
      `${label}: action column remains sticky`,
    );
    assert.ok(
      sample.actions.right <= Math.min(width, sample.region.right) + 1,
      `${label}: actions remain inside viewport`,
    );
    assert.ok(
      sample.actions.left >= Math.max(0, sample.region.left) - 1,
      `${label}: actions remain reachable`,
    );
  }

  async function keyboardDetail(label) {
    const trigger = table()
      .locator('.table-action-link[aria-haspopup="dialog"]')
      .first();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((element) => element.matches(":modal")),
      true,
      `${label}: native modal`,
    );
    assert.equal(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
      true,
      `${label}: focus enters detail`,
    );
    await page.screenshot({
      path: path.join(output, "screenshots", `${label}-detail.png`),
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await trigger.evaluate((element) => document.activeElement === element),
      true,
      `${label}: exact opener focus restored`,
    );
    evidence.interactions.push({
      label,
      nativeModal: true,
      keyboardOpen: true,
      escapeClose: true,
      focusRestored: true,
    });
  }

  for (const route of [
    "/admin/time-slots",
    "/admin/users",
    "/admin/tutees",
    "/ui-gallery",
  ]) {
    for (const locale of ["en", "zh"]) {
      await context.addCookies([
        {
          name: "NEXT_LOCALE",
          value: locale,
          domain: base.hostname,
          path: "/",
        },
      ]);
      await page.goto(new URL(route, base).href);
      await table().locator(".table-action-link").first().waitFor();
      // Gallery owns its own locale rather than the application's preference cookie.
      if (route === "/ui-gallery")
        await page
          .locator("select")
          .filter({ has: page.locator('option[value="zh"]') })
          .first()
          .selectOption(locale);
      for (const width of [390, 768, 1023, 1024, 1440]) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
        await table().evaluate((element) => {
          element.scrollLeft = 0;
        });
        await table().scrollIntoViewIfNeeded();
        const label = `${route.split("/").at(-1)}-${locale}-${width}`;
        const before = await measure();
        assertLayout(before, width, label);
        // At least one normal label must actually render at the compact baseline.
        assert.ok(
          before.lists.some((list) =>
            list.links.some(
              (link) => Math.abs(link.height - (width >= 1024 ? 24 : 44)) < 0.6,
            ),
          ),
          `${label}: normal baseline`,
        );
        await table().evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        const after = await measure();
        assertLayout(after, width, `${label} scrolled`);
        near(
          after.actions.right,
          before.actions.right,
          `${label}: sticky right edge after local scroll`,
        );
        evidence.layouts.push({ route, locale, width, before, after });
        if ([390, 1440].includes(width)) await capture(label);
      }
      if (["/admin/time-slots", "/ui-gallery"].includes(route))
        await keyboardDetail(`${route.split("/").at(-1)}-${locale}`);
    }
  }

  // Theme selectors exercise the actual gallery state. These are layout checks,
  // not foreground/background contrast measurements or authorization evidence.
  const theme = page
    .locator("select")
    .filter({ has: page.locator('option[value="indigo"]') })
    .first();
  for (const palette of [
    "indigo",
    "violet",
    "emerald",
    "rose",
    "amber",
    "sky",
  ]) {
    await theme.selectOption(palette);
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      palette,
    );
    const sample = await measure();
    assertLayout(sample, 1440, `palette ${palette}`);
    evidence.palettes.push({ palette, sample });
    await capture(`gallery-palette-${palette}`);
  }

  // This isolated DOM stress case changes no saved fixture or server state. A
  // deliberately narrow long label must wrap and grow, including at 200% text.
  const stressLink = table().locator(".table-action-link").first();
  await stressLink.evaluate((element) => {
    element.textContent =
      "查看完整的参与者详细信息、原始入学记录和历史课程安排 View full participant details and historical enrollment";
    element.style.maxWidth = "160px";
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const sample = await measure();
    assertLayout(sample, width, `long label 200% ${width}`, true);
    assert.ok(
      sample.lists[0].links[0].height > (width >= 1024 ? 24 : 44),
      "Long text must grow beyond baseline",
    );
    evidence.interactions.push({ label: `long-label-200%-${width}`, sample });
    await capture(`gallery-long-label-200pct-${width}`);
  }
  assert.deepEqual(evidence.errors, [], "No unhandled page errors");
  evidence.result = "passed";
  console.log(
    `Passed ${evidence.layouts.length} route/locale/viewport cases, detail keyboard checks, six palettes and long-text stress checks.`,
  );
}
