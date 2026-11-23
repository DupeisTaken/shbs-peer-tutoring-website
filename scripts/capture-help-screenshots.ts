/**
 * Code-driven Help screenshot baker & PDF handbook renderer.
 *
 * Designed to run inside `.github/workflows/help-assets.yml` (or locally via
 * `npm run help:capture`) against a production `next start` build + seeded
 * Postgres 16 demo database so:
 * - Git stays 100% free of binary JPEG/WebP blobs
 * - Screenshots have zero Next.js DevTools overlays and zero scrollbars
 * - Focused element/card cropping (`--crop-mode=focused`) eliminates wasted whitespace
 * - Both EN and ZH locales are captured deterministically from the same runner
 * - Blob size is controllable via `HELP_IMAGE_MAX_KB`, `HELP_IMAGE_QUALITY`,
 *   `HELP_IMAGE_MIN_QUALITY`, `HELP_IMAGE_MAX_WIDTH`, and `HELP_IMAGE_CROP_PADDING_PX`
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { helpArticles } from "../src/lib/help/catalogue";
import type { HelpAudience, HelpLocale } from "../src/lib/help/types";
import {
  encodeWithinBudget,
  resolveHelpImageBudget,
} from "../src/lib/help/image-budget";
import { directionsSha256 } from "./help-capture-validation";

export type DemoAccountKey = "guest" | "tutor" | "crew" | "head";

export type CaptureRecipe = {
  id: string;
  guideSlug: string;
  stepIndex: number;
  route: string;
  role: string;
  accountKey: DemoAccountKey;
  viewport?: { width: number; height: number };
  /** Optional CSS selector to cleanly crop around the active card/dialog with padding. */
  cropSelector?: string;
  /** Wait for this selector before capturing. */
  readySelector?: string;
  /** Optional callout selectors automatically measured via getBoundingClientRect(). */
  callouts?: Array<{
    selector: string;
    label: { en: string; zh: string };
  }>;
};

const DEMO_ACCOUNTS: Record<
  Exclude<DemoAccountKey, "guest">,
  { identifier: string; password: string; role: string }
> = {
  tutor: {
    identifier: "alice@example.edu",
    password: "Password123!",
    role: "TUTOR",
  },
  crew: {
    identifier: "crew@example.edu",
    password: "Password123!",
    role: "CREW",
  },
  head: {
    identifier: "admin@example.edu",
    password: "Password123!",
    role: "HEAD",
  },
};

function accountForAudience(audience: HelpAudience): {
  accountKey: DemoAccountKey;
  role: string;
} {
  switch (audience) {
    case "public":
      return { accountKey: "guest", role: "PUBLIC" };
    case "account":
    case "tutor":
      return { accountKey: "tutor", role: "TUTOR" };
    case "crew":
      return { accountKey: "crew", role: "CREW" };
    case "student":
    case "observer":
    case "staff":
    case "admin":
    case "head":
    case "translator":
      return { accountKey: "head", role: "HEAD" };
  }
}

/** Focused crop overrides for pages where a specific form/card makes a sharper frame. */
const ROUTE_CROP_OVERRIDES: Record<
  string,
  { cropSelector: string; readySelector?: string; callouts?: CaptureRecipe["callouts"] }
> = {
  "/help": {
    cropSelector: "main",
    readySelector: "input[type='search']",
    callouts: [
      { selector: "input[type='search']", label: { en: "Search guides", zh: "搜索指南" } },
    ],
  },
  "/signin": {
    cropSelector: "main form",
    readySelector: "form",
  },
  "/settings#associated-emails": {
    cropSelector: "#associated-emails",
    readySelector: "#associated-emails",
  },
  "/tutee-signup": {
    cropSelector: "main form",
    readySelector: "main form",
  },
  "/tutor-signup": {
    cropSelector: "main form",
    readySelector: "main form",
  },
  "/crew-signup": {
    cropSelector: "main form",
    readySelector: "main form",
  },
};

/** Derive a deterministic capture plan across the catalogue's navigable guides. */
export function buildCaptureRecipes(limit?: number): CaptureRecipe[] {
  const recipes: CaptureRecipe[] = [];
  for (const article of helpArticles) {
    if (article.requiresPrivateLink || article.externalAction) continue;
    const firstStep = article.steps[0];
    if (!firstStep?.screenshot) continue;
    const { accountKey, role } = accountForAudience(article.audience);
    const override = ROUTE_CROP_OVERRIDES[article.route];
    recipes.push({
      id: firstStep.screenshot,
      guideSlug: article.slug,
      stepIndex: 0,
      route: article.route,
      role,
      accountKey,
      cropSelector: override?.cropSelector ?? "main",
      readySelector: override?.readySelector ?? "main",
      callouts: override?.callouts,
    });
    if (limit && recipes.length >= limit) break;
  }
  return recipes;
}

type SharpFactory = (input: Uint8Array) => {
  resize: (opts: {
    width: number;
    withoutEnlargement: boolean;
  }) => ReturnType<SharpFactory>;
  jpeg: (opts: { quality: number; mozjpeg: boolean }) => {
    toBuffer: () => Promise<Buffer>;
  };
  metadata: () => Promise<{ width?: number; height?: number }>;
};

type PlaywrightPage = {
  goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
  addStyleTag: (opts: { content: string }) => Promise<unknown>;
  waitForSelector: (
    sel: string,
    opts?: Record<string, unknown>,
  ) => Promise<unknown>;
  evaluate: <T, A = undefined>(fn: (arg: A) => T, arg?: A) => Promise<T>;
  locator: (sel: string) => {
    first: () => {
      boundingBox: () => Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
      } | null>;
    };
  };
  screenshot: (opts: Record<string, unknown>) => Promise<Buffer>;
};

type PlaywrightModule = {
  chromium: {
    launch: (opts?: Record<string, unknown>) => Promise<{
      newContext: (opts?: Record<string, unknown>) => Promise<{
        addCookies: (cookies: Array<Record<string, unknown>>) => Promise<void>;
        newPage: () => Promise<PlaywrightPage>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

function currentRevision() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "0".repeat(40);
  }
}

async function signIn(
  page: PlaywrightPage,
  baseUrl: string,
  account: { identifier: string; password: string },
) {
  await page.goto(`${baseUrl}/signin`, { waitUntil: "networkidle" });
  await page.evaluate(
    async ({ id, pw }: { id: string; pw: string }) => {
      const { csrfToken } = (await (await fetch("/api/auth/csrf")).json()) as {
        csrfToken: string;
      };
      const body = new URLSearchParams({
        identifier: id,
        password: pw,
        csrfToken,
        callbackUrl: "/",
        json: "true",
      });
      await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    },
    { id: account.identifier, pw: account.password },
  );
}

async function run() {
  const args = process.argv.slice(2);
  const arg = (prefix: string, fallback: string) =>
    args.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? fallback;

  const baseUrl = arg(
    "--base-url=",
    process.env.HELP_CAPTURE_BASE_URL ?? "http://127.0.0.1:3027",
  );
  const writeManifest = args.includes("--write-manifest");
  const outDir = path.resolve(
    arg("--out=", writeManifest ? "docs/guides/help" : ".validation/ci-help-captures"),
  );
  const imagesDir = writeManifest
    ? path.join(outDir, "assets")
    : path.join(outDir, "images");
  const locales = arg("--locales=", "en,zh")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is HelpLocale => s === "en" || s === "zh");
  const cropMode = arg("--crop-mode=", "focused");
  const limitRaw = arg("--limit=", "");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const renderPdfs = args.includes("--render-pdfs");
  const pdfOutDir = path.resolve(
    arg("--pdf-out=", ".validation/ci-help-captures/pdfs"),
  );
  const budget = resolveHelpImageBudget();
  const revision = currentRevision();

  await fs.mkdir(imagesDir, { recursive: true });

  const require = createRequire(import.meta.url);
  const nextRequire = createRequire(require.resolve("next/package.json"));
  const sharp = nextRequire("sharp") as SharpFactory;

  let playwright: PlaywrightModule;
  try {
    const playwrightPkg = "playwright";
    playwright = (await import(playwrightPkg)) as PlaywrightModule;
  } catch {
    throw new Error(
      "Playwright is required to capture screenshots. Run inside `.github/workflows/help-assets.yml` or with `npx --yes -p playwright tsx --conditions=react-server scripts/capture-help-screenshots.ts`.",
    );
  }

  const recipes = buildCaptureRecipes(
    limit && Number.isSafeInteger(limit) && limit > 0 ? limit : undefined,
  );
  const byAccount = new Map<DemoAccountKey, CaptureRecipe[]>();
  for (const recipe of recipes) {
    const bucket = byAccount.get(recipe.accountKey) ?? [];
    bucket.push(recipe);
    byAccount.set(recipe.accountKey, bucket);
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const screenshots: Array<Record<string, unknown>> = [];
  let totalBytes = 0;

  try {
    const urlObj = new URL(baseUrl);
    for (const locale of locales) {
      for (const [accountKey, group] of byAccount) {
        const viewport = { width: 1280, height: 800 };
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        await context.addCookies([
          {
            name: "NEXT_LOCALE",
            value: locale,
            domain: urlObj.hostname,
            path: "/",
          },
        ]);
        const page = await context.newPage();
        if (accountKey !== "guest") {
          await signIn(page, baseUrl, DEMO_ACCOUNTS[accountKey]);
        }

        for (const recipe of group) {
          const article = helpArticles.find((a) => a.slug === recipe.guideSlug);
          const step = article?.steps[recipe.stepIndex];
          if (!article || !step) continue;

          try {
            await page.goto(`${baseUrl}${recipe.route}`, {
              waitUntil: "networkidle",
              timeout: 20_000,
            });
            // Keep frames free of OS scrollbar chrome across all platforms.
            await page.addStyleTag({
              content:
                "html,body{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}",
            });
            if (recipe.readySelector) {
              await page
                .waitForSelector(recipe.readySelector, { timeout: 10_000 })
                .catch(() => undefined);
            }

            let clip:
              | { x: number; y: number; width: number; height: number }
              | undefined;
            if (cropMode === "focused" && recipe.cropSelector) {
              const box = await page
                .locator(recipe.cropSelector)
                .first()
                .boundingBox();
              if (box && box.width > 40 && box.height > 40) {
                const pad = budget.cropPaddingPx;
                const x = Math.max(0, Math.floor(box.x - pad));
                const y = Math.max(0, Math.floor(box.y - pad));
                const width = Math.min(
                  viewport.width - x,
                  Math.ceil(box.width + pad * 2),
                );
                const height = Math.min(1400, Math.ceil(box.height + pad * 2));
                clip = { x, y, width, height };
              }
            }

            const frameOriginX = clip?.x ?? 0;
            const frameOriginY = clip?.y ?? 0;
            const frameWidth = clip?.width ?? viewport.width;
            const frameHeight = clip?.height ?? viewport.height;
            const measuredCallouts: Array<{
              bounds: { x: number; y: number; width: number; height: number };
              label: { en: string; zh: string };
            }> = [];
            for (const calloutDef of recipe.callouts ?? []) {
              const box = await page
                .locator(calloutDef.selector)
                .first()
                .boundingBox();
              if (box && box.width > 0 && box.height > 0) {
                const x = Math.max(
                  0,
                  Math.min(1, (box.x - frameOriginX) / frameWidth),
                );
                const y = Math.max(
                  0,
                  Math.min(1, (box.y - frameOriginY) / frameHeight),
                );
                const width = Math.max(
                  0.01,
                  Math.min(1 - x, box.width / frameWidth),
                );
                const height = Math.max(
                  0.01,
                  Math.min(1 - y, box.height / frameHeight),
                );
                measuredCallouts.push({
                  bounds: {
                    x: Number(x.toFixed(5)),
                    y: Number(y.toFixed(5)),
                    width: Number(width.toFixed(5)),
                    height: Number(height.toFixed(5)),
                  },
                  label: calloutDef.label,
                });
              }
            }

            const rawPng = await page.screenshot({
              type: "png",
              ...(clip ? { clip } : { fullPage: false }),
            });
            const { bytes, quality } = await encodeWithinBudget(
              (q) =>
                sharp(rawPng)
                  .resize({ width: budget.maxWidth, withoutEnlargement: true })
                  .jpeg({ quality: q, mozjpeg: true })
                  .toBuffer(),
              budget,
            );
            const meta = await sharp(bytes).metadata();
            const filename = `${recipe.id}.${locale}.jpg`;
            await fs.writeFile(path.join(imagesDir, filename), bytes);
            totalBytes += bytes.length;
            const capturedAt = new Date().toISOString();

            screenshots.push({
              id: recipe.id,
              file: filename,
              route: recipe.route,
              locale,
              capturedAt,
              viewport: {
                width: meta.width ?? frameWidth,
                height: meta.height ?? frameHeight,
              },
              browserViewport: viewport,
              captureMode: clip ? "cropped" : "viewport",
              ...(clip ? { crop: clip } : {}),
              role: recipe.role,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              sourceRevision: revision,
              sourceLabel: `CI-baked production build (${revision.slice(0, 8)}, q=${quality})`,
              state: {
                en: step.title.en,
                zh: step.title.zh,
              },
              stepBinding: {
                guide: article.slug,
                step: recipe.stepIndex + 1,
                title: step.title,
                directionsSha256: directionsSha256(step.body),
              },
              callouts: measuredCallouts,
              review: {
                acceptedAt: capturedAt,
                method:
                  "Baked deterministically by Playwright Chromium against production next start + seeded demo DB",
              },
            });
          } catch (error) {
            console.warn(
              `Skipped ${recipe.id} (${locale}, ${recipe.route}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    info: {
      sourceRevision: revision,
      releaseRef: `Baked automatically in GitHub Actions from production build ${revision.slice(0, 8)} using synthetic demo data.`,
      capturedAt: new Date().toISOString(),
      assetOrigin: "ci-baked" as const,
    },
    screenshots,
  };

  const manifestFile = writeManifest
    ? path.join(outDir, "captures.json")
    : path.join(outDir, "capture-manifest.json");
  await fs.writeFile(
    manifestFile,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  console.log(
    `Baked ${screenshots.length} screenshots (${(totalBytes / (1024 * 1024)).toFixed(2)} MB total, budget max ${Math.round(budget.maxFileBytes / 1000)} KB/image) -> ${manifestFile}`,
  );

  if (renderPdfs) {
    const { helpAudiences } = await import("../src/lib/help/catalogue");
    const { renderHelpPdf } = await import("../src/server/help/pdf");
    await fs.mkdir(pdfOutDir, { recursive: true });
    for (const audience of helpAudiences) {
      for (const locale of locales) {
        const pdf = await renderHelpPdf(audience, locale);
        await fs.writeFile(
          path.join(pdfOutDir, `shbs-help-${audience}-${locale}.pdf`),
          pdf,
        );
      }
    }
    console.log(
      `Rendered ${helpAudiences.length * locales.length} Geist PDF handbooks -> ${pdfOutDir}`,
    );
  }
}

if (process.argv[1]?.endsWith("capture-help-screenshots.ts")) {
  void run();
}
