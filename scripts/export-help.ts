import fs from "node:fs/promises";
import path from "node:path";
import {
  helpArticles,
  helpAudiences,
  helpAudienceTitles,
  handbookArticles,
} from "../src/lib/help/catalogue";
import {
  getHelpScreenshot,
  helpCaptureInfo,
} from "../src/lib/help/screenshots";
import type { HelpLocale } from "../src/lib/help/types";

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
          : `${label("Open", "打开")}: \`${article.route}\``,
        "",
        `### ${label("Before you start", "开始之前")}`,
        "",
        ...article.prerequisites.map((value) => `- ${text(value[locale])}`),
        "",
        `### ${label("Walkthrough", "操作步骤")}`,
        "",
      );
      const shown = new Set<string>();
      for (let index = 0; index < article.steps.length; index++) {
        const step = article.steps[index]!;
        lines.push(
          `${index + 1}. **${text(step.title[locale])}** ${text(step.body[locale])}`,
          "",
        );
        if (step.focus)
          lines.push(
            `   ${label("Look for", "请注意")}: ${text(step.focus[locale])}`,
            "",
          );
        if (step.screenshot && !shown.has(step.screenshot)) {
          const screenshot = getHelpScreenshot(step.screenshot, locale);
          if (!screenshot)
            throw new Error(
              `Missing screenshot: ${article.slug}: ${step.screenshot}`,
            );
          shown.add(step.screenshot);
          lines.push(
            `   ![${text(step.focus?.[locale] ?? step.title[locale])}](assets/${screenshot.file})`,
            "",
            `   ${screenshot.route} · ${screenshot.locale.toUpperCase()} · ${screenshot.capturedAt.slice(0, 10)}`,
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
            step.screenshot ? [step.screenshot] : [],
          ),
        ),
      ],
    })),
    null,
    2,
  ) + "\n",
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
