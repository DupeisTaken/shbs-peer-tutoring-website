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
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { helpArticles } from "../src/lib/help/catalogue";
import { validatePublishedCaptureRoute } from "../src/lib/help/capture-route";
import type { HelpAudience, HelpLocale } from "../src/lib/help/types";
import {
  encodeWithinBudget,
  resolveHelpImageBudget,
} from "../src/lib/help/image-budget";
import { directionsSha256 } from "./help-capture-validation";

export type DemoAccountKey =
  | "guest"
  | "student"
  | "tutor"
  | "crew"
  | "observer"
  | "translator"
  | "head";

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

export const DEMO_ACCOUNTS: Record<
  Exclude<DemoAccountKey, "guest">,
  { identifier: string; password: string; role: string }
> = {
  student: {
    identifier: "emma@example.test",
    password: "Password123!",
    role: "STUDENT",
  },
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
  observer: {
    identifier: "parent@example.edu",
    password: "Password123!",
    role: "VIEWER",
  },
  translator: {
    identifier: "translator@example.test",
    password: "Password123!",
    role: "TRANSLATOR",
  },
  head: {
    identifier: "admin@example.edu",
    password: "Password123!",
    role: "HEAD",
  },
};

export function accountForAudience(audience: HelpAudience): {
  accountKey: DemoAccountKey;
  role: string;
} {
  switch (audience) {
    case "public":
      return { accountKey: "guest", role: "PUBLIC" };
    case "account":
    case "tutor":
      return { accountKey: "tutor", role: "TUTOR" };
    case "student":
      return { accountKey: "student", role: "STUDENT" };
    case "crew":
      return { accountKey: "crew", role: "CREW" };
    case "observer":
      return { accountKey: "observer", role: "VIEWER" };
    case "translator":
      return { accountKey: "translator", role: "TRANSLATOR" };
    case "staff":
    case "admin":
    case "head":
      return { accountKey: "head", role: "HEAD" };
  }
}

type CaptureOverride = {
  route?: string;
  cropSelector?: string;
  readySelector?: string;
  callouts?: CaptureRecipe["callouts"];
};

/** Focused crop & callout overrides for routes where a specific form/card makes a sharper frame. */
const ROUTE_CROP_OVERRIDES: Record<string, CaptureOverride> = {
  "/help": {
    cropSelector: "main",
    readySelector: "input[type='search']",
    callouts: [
      {
        selector: "input[type='search']",
        label: { en: "Search guides", zh: "搜索指南" },
      },
    ],
  },
  "/signin": {
    cropSelector: "main form",
    readySelector: "form",
    callouts: [
      {
        selector: "main form button[type='submit']",
        label: { en: "Sign in", zh: "登录" },
      },
    ],
  },
  "/forgot-password": {
    cropSelector: "main form",
    readySelector: "main form",
    callouts: [
      {
        selector: "main form button[type='submit']",
        label: { en: "Request recovery", zh: "申请恢复" },
      },
    ],
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
  "/viewer-signup": {
    cropSelector: "main form",
    readySelector: "main form",
  },
  "/register-account": {
    cropSelector: "main form",
    readySelector: "main form",
  },
  "/request-appeal": {
    cropSelector: "main",
    readySelector: "main",
  },
};

/** Exact route/framing overrides for secondary steps in multi-screenshot guides. */
const STEP_CAPTURE_OVERRIDES: Record<string, CaptureOverride> = {
  "use-help-catalogue-step-2": {
    route: "/help/use-help-catalogue",
    cropSelector: "main article",
    readySelector: "#guide-title",
    callouts: [
      {
        selector: "#walkthrough",
        label: { en: "Step-by-step walkthrough", zh: "分步操作" },
      },
    ],
  },
  "request-tutoring-step-3": {
    route: "/register-account",
    cropSelector: "main form",
    readySelector: "main form",
  },
  "sign-in-recover-step-3": {
    route: "/forgot-password",
    cropSelector: "main form",
    readySelector: "main form",
    callouts: [
      {
        selector: "main form button[type='submit']",
        label: { en: "Request recovery", zh: "申请恢复" },
      },
    ],
  },
  "account-security-step-2": {
    route: "/my-account#account-twofactor",
    cropSelector: "#account-twofactor",
    readySelector: "#account-twofactor",
  },
  "tutee-workspace-step-2": {
    route: "/student?view=schedule",
    cropSelector: "main",
    readySelector: "main",
  },
  "tutee-feedback-appeals-step-2": {
    route: "/student?view=attendance",
    cropSelector: "main",
    readySelector: "main",
  },
  "tutee-feedback-appeals-step-3": {
    route: "/student?view=support",
    cropSelector: "main",
    readySelector: "main",
  },
  "combine-split-pairings-step-2": {
    route: "/dashboard#tutor-pairings",
    cropSelector: "#tutor-pairings",
    readySelector: "#tutor-pairings",
  },
  "record-attendance-step-2": {
    route: "/dashboard#sessions",
    cropSelector: "#sessions",
    readySelector: "#sessions",
  },
  "plan-dated-session-step-2": {
    route: "/dashboard#sessions",
    cropSelector: "#sessions",
    readySelector: "#sessions",
  },
  "tutor-membership-hours-step-4": {
    route: "/history",
    cropSelector: "main",
    readySelector: "main",
  },
  "tutor-program-information-step-2": {
    route: "/dashboard#tutor-pairings",
    cropSelector: "#tutor-pairings",
    readySelector: "#tutor-pairings",
  },
};

function anchorSelectorForRoute(route: string): string | undefined {
  const hashIndex = route.indexOf("#");
  if (hashIndex < 0) return undefined;
  const fragment = route.slice(hashIndex + 1);
  return /^[a-z0-9-]+$/i.test(fragment) ? `#${fragment}` : undefined;
}

/** Derive a deterministic capture plan with unique canonical step IDs across
 * every guide step that declares a screenshot. */
export function buildCaptureRecipes(limit?: number): CaptureRecipe[] {
  const recipes: CaptureRecipe[] = [];
  for (const article of helpArticles) {
    const { accountKey, role } = accountForAudience(article.audience);
    for (let stepIndex = 0; stepIndex < article.steps.length; stepIndex++) {
      const step = article.steps[stepIndex];
      if (!step?.screenshot) continue;
      const id = `${article.slug}-step-${stepIndex + 1}`;
      const stepOverride = STEP_CAPTURE_OVERRIDES[id];
      const route = validatePublishedCaptureRoute(
        stepOverride?.route ?? article.route,
      );
      const routeOverride = ROUTE_CROP_OVERRIDES[route];
      const anchorSelector = anchorSelectorForRoute(route);
      recipes.push({
        id,
        guideSlug: article.slug,
        stepIndex,
        route,
        role,
        accountKey,
        cropSelector:
          stepOverride?.cropSelector ??
          routeOverride?.cropSelector ??
          anchorSelector ??
          "main",
        readySelector:
          stepOverride?.readySelector ??
          routeOverride?.readySelector ??
          anchorSelector ??
          "main",
        callouts: stepOverride?.callouts ?? routeOverride?.callouts,
      });
      if (limit && recipes.length >= limit) return recipes;
    }
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
  const outcome = await page.evaluate(
    async ({ id, pw }: { id: string; pw: string }) => {
      const csrfRes = await fetch("/api/auth/csrf");
      if (!csrfRes.ok) {
        return {
          ok: false as const,
          reason: `CSRF endpoint failed with HTTP ${csrfRes.status} (ensure AUTH_TRUST_HOST=true for local next start)`,
        };
      }
      const { csrfToken } = (await csrfRes.json()) as {
        csrfToken?: string;
      };
      if (!csrfToken) {
        return { ok: false as const, reason: "Missing csrfToken from /api/auth/csrf" };
      }
      const body = new URLSearchParams({
        identifier: id,
        password: pw,
        csrfToken,
        callbackUrl: "/",
        json: "true",
      });
      const loginRes = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const sessionRes = await fetch("/api/auth/session");
      const session = sessionRes.ok
        ? ((await sessionRes.json()) as { user?: { email?: string } } | null)
        : null;
      if (!session?.user) {
        return {
          ok: false as const,
          reason: `Credentials login did not establish a session (HTTP ${loginRes.status})`,
        };
      }
      return { ok: true as const };
    },
    { id: account.identifier, pw: account.password },
  );
  if (!outcome.ok) {
    throw new Error(
      `Failed to sign in demo account ${account.identifier}: ${outcome.reason}`,
    );
  }
}

function normalizeCalloutBounds(
  box: { x: number; y: number; width: number; height: number },
  frameOriginX: number,
  frameOriginY: number,
  frameWidth: number,
  frameHeight: number,
) {
  const left = Math.max(0, Math.min(0.98, (box.x - frameOriginX) / frameWidth));
  const top = Math.max(0, Math.min(0.98, (box.y - frameOriginY) / frameHeight));
  const right = Math.max(
    left + 0.01,
    Math.min(1, (box.x + box.width - frameOriginX) / frameWidth),
  );
  const bottom = Math.max(
    top + 0.01,
    Math.min(1, (box.y + box.height - frameOriginY) / frameHeight),
  );
  return {
    x: Number(left.toFixed(5)),
    y: Number(top.toFixed(5)),
    width: Number((right - left).toFixed(5)),
    height: Number((bottom - top).toFixed(5)),
  };
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
  const allowPartial = args.includes("--allow-partial");
  const outDir = path.resolve(
    arg(
      "--out=",
      writeManifest ? "docs/guides/help" : ".validation/ci-help-captures",
    ),
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
  const failures: string[] = [];
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

            const docHeight = await page.evaluate(() =>
              Math.max(
                document.documentElement.scrollHeight,
                document.body.scrollHeight,
                window.innerHeight,
              ),
            );

            let clip:
              | { x: number; y: number; width: number; height: number }
              | undefined;
            if (cropMode === "focused") {
              const candidates = [
                ...(recipe.cropSelector ? [recipe.cropSelector] : []),
                "main",
              ];
              for (const selector of candidates) {
                const box = await page
                  .locator(selector)
                  .first()
                  .boundingBox()
                  .catch(() => null);
                if (box && box.width >= 40 && box.height >= 40) {
                  const pad = budget.cropPaddingPx;
                  const x = Math.max(
                    0,
                    Math.min(viewport.width - 40, Math.floor(box.x - pad)),
                  );
                  const y = Math.max(
                    0,
                    Math.min(Math.max(0, docHeight - 40), Math.floor(box.y - pad)),
                  );
                  const width = Math.min(
                    viewport.width - x,
                    Math.ceil(box.width + pad * 2),
                  );
                  const height = Math.min(
                    1400,
                    Math.max(40, docHeight - y),
                    Math.ceil(box.height + pad * 2),
                  );
                  if (width >= 40 && height >= 40) {
                    clip = { x, y, width, height };
                    break;
                  }
                }
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
                .boundingBox()
                .catch(() => null);
              if (box && box.width > 0 && box.height > 0) {
                measuredCallouts.push({
                  bounds: normalizeCalloutBounds(
                    box,
                    frameOriginX,
                    frameOriginY,
                    frameWidth,
                    frameHeight,
                  ),
                  label: calloutDef.label,
                });
              }
            }
            if (measuredCallouts.length === 0) {
              for (const fallbackSelector of [
                "main h1",
                "h1",
                "main form button[type='submit']",
                "main button",
                "main input",
              ]) {
                const box = await page
                  .locator(fallbackSelector)
                  .first()
                  .boundingBox()
                  .catch(() => null);
                if (
                  box &&
                  box.width > 12 &&
                  box.height > 12 &&
                  box.y + box.height > frameOriginY &&
                  box.y < frameOriginY + frameHeight
                ) {
                  measuredCallouts.push({
                    bounds: normalizeCalloutBounds(
                      box,
                      frameOriginX,
                      frameOriginY,
                      frameWidth,
                      frameHeight,
                    ),
                    label: { en: step.title.en, zh: step.title.zh },
                  });
                  break;
                }
              }
            }
            if (measuredCallouts.length === 0) {
              measuredCallouts.push({
                bounds: { x: 0.04, y: 0.04, width: 0.35, height: 0.08 },
                label: { en: step.title.en, zh: step.title.zh },
              });
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
            const detail = `${recipe.id} (${locale}, ${recipe.route}): ${error instanceof Error ? error.message : String(error)}`;
            failures.push(detail);
            console.warn(`Failed ${detail}`);
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (screenshots.length === 0 || (failures.length > 0 && !allowPartial)) {
    throw new Error(
      `Help screenshot capture failed (${failures.length} failures, ${screenshots.length} captured):\n${failures.slice(0, 20).join("\n")}`,
    );
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
    // Run PDF rendering in a fresh Node process so it loads the freshly written
    // `docs/guides/help/captures.json` rather than this process's cached static import.
    const tsxCli = require.resolve("tsx/cli");
    execFileSync(
      process.execPath,
      [
        tsxCli,
        "--conditions=react-server",
        path.resolve(import.meta.dirname, "render-help-pdfs.ts"),
        `--locales=${locales.join(",")}`,
        `--pdf-out=${pdfOutDir}`,
      ],
      { stdio: "inherit" },
    );
  }
}

if (process.argv[1]?.endsWith("capture-help-screenshots.ts")) {
  void run();
}
