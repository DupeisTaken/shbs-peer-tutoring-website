import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  helpArticles,
  helpAudiences,
  helpAudienceTitles,
  handbookArticles,
} from "../src/lib/help/catalogue";
import {
  getHelpScreenshot,
  getScreenshotSource,
  getStepCallouts,
  getStepCaptureViews,
  stepForCaptureView,
  helpCaptureInfo,
} from "../src/lib/help/screenshots";
import type { HelpArticle, HelpLocale, HelpStep } from "../src/lib/help/types";
import type { HelpScreenshot } from "../src/lib/help/screenshots";
import {
  getScreenshotCaption,
  getStepFocus,
} from "../src/lib/help/screenshot-copy";
import { layoutHelpCallouts } from "../src/app/help/screenshot-annotations";
import {
  annotationOverlaySvg,
  annotationRecipeHash,
  annotationWebpEncoding,
  annotationWebpRecipeHash,
  assertAnnotationImageDimensions,
  encodeAnnotationWebp,
  isCurrentAnnotationWebpMetadata,
  renderAnnotatedCapture,
  verifyAnnotationWebp,
  type AnnotationWebpMetadata,
} from "../src/app/help/annotation-assets";

const root = path.join(process.cwd(), "docs/guides/help");
const check = process.argv.includes("--check");
const text = (value: string) =>
  value.replaceAll("\r", "").replaceAll("\n", " ");
const anchor = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replaceAll(" ", "-");
const outputs = new Map<string, string>();
type DerivedCapture = AnnotationWebpMetadata & {
  article: string;
  step: number;
  locale: HelpLocale;
  file: string;
  screenshot: string;
  view: number;
  rawFile: string;
  rawSha256: string;
  recipeSha256: string;
  sha256: string;
};
const derivedCaptures: DerivedCapture[] = [];
const previousDerivatives = JSON.parse(
  await fs
    .readFile(path.join(root, "annotations.json"), "utf8")
    .catch(() => "[]"),
) as DerivedCapture[];
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const verifiedOriginals = new Set<string>();
const verifiedDerivatives = new Set<string>();

async function exportStepImage(
  article: HelpArticle,
  step: HelpStep,
  index: number,
  screenshot: HelpScreenshot,
  locale: HelpLocale,
  view: number,
  annotated: boolean,
) {
  assertAnnotationImageDimensions(
    screenshot.viewport.width,
    screenshot.viewport.height,
  );
  const originalKey = `${screenshot.file}:${screenshot.sha256}`;
  if (!verifiedOriginals.has(originalKey)) {
    const raw = await fs.readFile(path.join(root, "assets", screenshot.file));
    if (hash(raw) !== screenshot.sha256)
      throw new Error(`Original help capture changed: ${screenshot.id}`);
    verifiedOriginals.add(originalKey);
  }
  if (!annotated) return `assets/${screenshot.file}`;
  const overlay = annotationOverlaySvg(step, screenshot, locale);
  const pngRecipeSha256 = annotationRecipeHash(
    screenshot,
    overlay,
    step,
    locale,
  );
  const recipeSha256 = annotationWebpRecipeHash(pngRecipeSha256);
  // Content addressing reuses identical bitmap/geometry/label/font recipes.
  const file = `assets/annotated/${recipeSha256}.webp`;
  const destination = path.join(root, file);
  const previous = [...previousDerivatives, ...derivedCaptures].find(
    (item) => item.recipeSha256 === recipeSha256 && item.file === file,
  );
  let sha256: string;
  let pixelParity: AnnotationWebpMetadata["pixelParity"];
  const existing = await fs.readFile(destination).catch(() => undefined);
  if (
    previous &&
    isCurrentAnnotationWebpMetadata(
      previous,
      pngRecipeSha256,
      screenshot.viewport,
    ) &&
    previous.recipeSha256 === recipeSha256 &&
    previous.file === file &&
    existing &&
    hash(existing) === previous.sha256
  ) {
    sha256 = previous.sha256;
    pixelParity = previous.pixelParity;
    const key = `${file}:${sha256}:${pixelParity.pngRgbaSha256}`;
    if (!verifiedDerivatives.has(key)) {
      await verifyAnnotationWebp(existing, pixelParity);
      verifiedDerivatives.add(key);
    }
  } else {
    if (check)
      throw new Error(
        `Annotated help image is stale: ${article.slug}, step ${index + 1}, ${locale}. Run npm run help:export.`,
      );
    const png = await renderAnnotatedCapture(screenshot, overlay);
    const image = await encodeAnnotationWebp(png);
    if (
      image.pixelParity.width !== screenshot.viewport.width ||
      image.pixelParity.height !== screenshot.viewport.height
    )
      throw new Error(
        `Annotated help image dimensions changed: ${screenshot.id}`,
      );
    sha256 = hash(image.bytes);
    pixelParity = image.pixelParity;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, image.bytes);
    verifiedDerivatives.add(`${file}:${sha256}:${pixelParity.pngRgbaSha256}`);
  }
  derivedCaptures.push({
    schemaVersion: 2,
    format: "webp",
    encoding: annotationWebpEncoding,
    pngRecipeSha256,
    pixelParity,
    article: article.slug,
    step: index + 1,
    locale,
    file,
    screenshot: screenshot.id,
    view,
    rawFile: screenshot.file,
    rawSha256: screenshot.sha256,
    recipeSha256,
    sha256,
  });
  return file;
}

for (const audience of helpAudiences) {
  for (const locale of ["en", "zh"] as HelpLocale[]) {
    const label = (en: string, zh: string) => (locale === "zh" ? zh : en);
    const lines = [
      `# ${helpAudienceTitles[audience][locale]}`,
      "",
      label(
        "Generated from the website help catalogue. Edit the content records, then run `npm run help:export`.",
        "由网站帮助目录生成。请修改内容源文件后运行 `npm run help:export`。",
      ),
      "",
      `[${label("Catalogue & capture provenance", "目录与截图来源")}](README.md)`,
      "",
      `${label("Screenshot source", "截图来源")}: \`${helpCaptureInfo.sourceRevision}\`. ${helpCaptureInfo.releaseRef}`,
      "",
      label(
        "This GitHub training copy includes role-specific instructions. Signing in and current program permissions are still required to use the corresponding website features. All examples are synthetic.",
        "此 GitHub 培训副本包含各角色操作说明。实际使用网站功能仍需登录并具备当前项目权限。所有示例数据均为虚构。",
      ),
      "",
      ...handbookArticles(audience).flatMap((article) => [
        `- [${article.title[locale]}](#${anchor(article.title[locale])})`,
      ]),
      "",
    ];
    for (const article of handbookArticles(audience)) {
      lines.push(
        `## ${article.title[locale]}`,
        "",
        article.summary[locale],
        "",
        article.requiresPrivateLink
          ? label(
              "Open the complete private link from your email.",
              "请使用邮件中的完整私密链接。",
            )
          : article.externalAction
            ? `[${text(article.externalAction.label[locale])}](${article.externalAction.href})`
            : `${label("Open", "打开")}: \`${article.route}\``,
        "",
        `### ${label("Before you start", "开始之前")}`,
        "",
        ...article.prerequisites.map((value) => `- ${text(value[locale])}`),
        "",
        `### ${label("Walkthrough", "操作步骤")}`,
        "",
      );
      for (let index = 0; index < article.steps.length; index++) {
        const step = article.steps[index]!;
        lines.push(
          `${index + 1}. **${text(step.title[locale])}** ${text(step.body[locale])}`,
          "",
        );
        const focus = getStepFocus(step, locale);
        if (focus)
          lines.push(`   ${label("Look for", "请注意")}: ${text(focus)}`, "");
        const views = getStepCaptureViews(step);
        for (const { id, view } of views) {
          const screenshot = getHelpScreenshot(id, locale);
          if (!screenshot)
            throw new Error(`Missing screenshot: ${article.slug}: ${id}`);
          const frameStep = stepForCaptureView(step, view);
          const annotations = layoutHelpCallouts(frameStep, screenshot, locale);
          const caption = getScreenshotCaption(frameStep, screenshot, locale);
          const viewLabel = `${label("View", "视图")} ${view}`;
          const description = [
            views.length > 1 ? viewLabel : step.title[locale],
            ...annotations
              .filter((annotation) => annotation.showLabel)
              .map((annotation) => annotation.text),
          ].join(" · ");
          const imageFile = await exportStepImage(
            article,
            frameStep,
            index,
            screenshot,
            locale,
            view,
            annotations.length > 0,
          );
          const source = getScreenshotSource(screenshot);
          lines.push(
            ...(views.length > 1 ? [`   **${viewLabel}**`, ""] : []),
            `   ![${text(description).replace(/([\\\[\]])/g, "\\$1")}](${imageFile})`,
            "",
            ...annotations
              .filter((annotation) => !annotation.showLabel)
              .flatMap((annotation) => [
                `   - **${annotation.number}.** ${text(annotation.text)}`,
                "",
              ]),
            ...(caption ? [`   ${text(caption)}`, ""] : []),
            ...(screenshot.locale !== locale
              ? [
                  `   ${screenshot.locale === "en" ? label("English screen", "英文界面") : label("Chinese screen", "中文界面")}`,
                  "",
                ]
              : []),
            "   <details>",
            `   <summary>${label("Capture details", "截图详情")}</summary>`,
            "",
            ...(screenshot.state && !caption
              ? [`   ${text(screenshot.state[locale])}`, ""]
              : []),
            `   ${screenshot.route} · ${screenshot.locale.toUpperCase()} · ${screenshot.capturedAt.slice(0, 10)}`,
            "",
            `   [${label("Original full screenshot", "原始完整截图")}](assets/${screenshot.file}) · \`${source.revision}\` · ${text(source.label)}`,
            "",
            "   </details>",
            "",
          );
        }
      }
      lines.push(
        `### ${label("What happens next", "预期结果")}`,
        "",
        article.expected[locale],
        "",
        `### ${label("How it works", "工作原理")}`,
        "",
        ...article.explanation.flatMap((value) => [value[locale], ""]),
        `### ${label("Troubleshooting", "问题排查")}`,
        "",
      );
      for (const issue of article.troubleshooting)
        lines.push(
          `- **${text(issue.problem[locale])}** ${text(issue.solution[locale])}`,
          "",
        );
    }
    outputs.set(`${audience}.${locale}.md`, lines.join("\n").trimEnd() + "\n");
  }
}
outputs.set(
  "coverage.json",
  JSON.stringify(
    helpArticles.map((article) => ({
      slug: article.slug,
      audience: article.audience,
      route: article.route,
      sources: article.sources,
      covers: article.covers,
      screenshots: [
        ...new Set(
          article.steps.flatMap((step) =>
            getStepCaptureViews(step).map(({ id }) => id),
          ),
        ),
      ],
      steps: article.steps.map((step, index) => {
        const screenshot = step.screenshot
          ? getHelpScreenshot(step.screenshot)
          : undefined;
        return {
          number: index + 1,
          screenshot: step.screenshot ?? null,
          supplementaryScreenshots: step.supplementaryScreenshots ?? [],
          views: getStepCaptureViews(step).map(({ id, view }) => {
            const frame = getHelpScreenshot(id);
            return {
              id,
              view,
              callouts: frame
                ? getStepCallouts(stepForCaptureView(step, view), frame)
                : [],
            };
          }),
          callouts: screenshot
            ? getStepCallouts(step, screenshot)
            : (step.callouts ?? []),
        };
      }),
    })),
    null,
    2,
  ) + "\n",
);
outputs.set(
  "annotations.json",
  JSON.stringify(derivedCaptures, null, 2) + "\n",
);
for (const [name, content] of outputs) {
  const destination = path.join(root, name);
  if (check) {
    if (
      (await fs.readFile(destination, "utf8").catch(() => "")).replaceAll(
        "\r\n",
        "\n",
      ) !== content
    )
      throw new Error(
        `Help export is stale: ${name}. Run npm run help:export.`,
      );
  } else await fs.writeFile(destination, content);
}
console.log(
  `${check ? "Verified" : "Generated"} ${outputs.size} help exports from ${helpArticles.length} articles.`,
);
