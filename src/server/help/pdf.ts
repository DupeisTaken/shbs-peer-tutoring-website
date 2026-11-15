import "server-only";
import PDFDocument from "pdfkit";
import path from "node:path";
import { handbookArticles, helpAudienceTitles } from "~/lib/help/catalogue";
import { getHelpScreenshot, helpCaptureInfo } from "~/lib/help/screenshots";
import type { HelpAudience, HelpLocale } from "~/lib/help/types";
import { readScreenshot } from "./assets";

/** Each request renders the maintained article records and reviewed capture files.
 * No browser, network font, participant query or separately maintained PDF is involved. */
export async function renderHelpPdf(
  audience: HelpAudience,
  locale: HelpLocale,
) {
  const articles = handbookArticles(audience);
  // Both editions quote Chinese interface labels, so embed the reviewed CJK
  // subset for Latin and Chinese text instead of losing glyphs in English PDFs.
  const fontFile = "public/fonts/help/noto-sans-sc.otf";
  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    bufferPages: true,
    font: path.join(process.cwd(), fontFile),
    info: {
      Title: `SHBS — ${helpAudienceTitles[audience][locale]}`,
      Author: "SHBS Peer Tutoring",
      Subject: "Help & how-to",
    },
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  // A synchronous layout failure must also dispose the stream, including when
  // the consumer has not reached its await on the completion promise yet.
  void complete.catch(() => undefined);
  try {
    const text = (en: string, zh: string) => (locale === "zh" ? zh : en);
    const width = doc.page.width - 96;
    const paragraph = (value: string, size = 10) => {
      doc
        .fontSize(size)
        .fillColor("#334155")
        .text(value, { width, lineGap: 3, paragraphGap: 8 });
      doc.moveDown(0.4);
    };
    const heading = (value: string) => {
      if (doc.y > doc.page.height - 135) doc.addPage();
      doc
        .fontSize(13)
        .fillColor("#4338ca")
        .text(value, { width, paragraphGap: 6 });
      doc.moveDown(0.3);
    };
    paragraph("SHBS PEER TUTORING", 12);
    doc.moveDown(1);
    paragraph(helpAudienceTitles[audience][locale], 26);
    paragraph(text("Help & how-to", "帮助与操作指南"), 20);
    paragraph(
      text(
        "Step-by-step instructions, screenshots and troubleshooting.",
        "分步操作、真实截图与问题排查。",
      ),
    );
    paragraph(
      `${text("Source revision", "来源版本")}: ${helpCaptureInfo.sourceRevision}`,
    );
    paragraph(
      `${text("Screenshots captured", "截图时间")}: ${helpCaptureInfo.capturedAt}`,
    );
    paragraph(
      text(
        "Examples use synthetic data. Available actions depend on your current access, program settings and the record you open. A handbook does not grant access or replace published policy.",
        "示例使用虚构数据。实际操作取决于当前权限、项目设置和记录状态。手册不会授予权限，也不能替代已发布的政策。",
      ),
    );
    paragraph(helpCaptureInfo.releaseRef);
    heading(text("In this handbook", "本手册内容"));
    for (const article of articles) {
      doc.fontSize(10).fillColor("#4338ca").text(article.title[locale], {
        goTo: article.slug,
        width,
        paragraphGap: 5,
      });
    }
    for (const article of articles) {
      doc.addPage();
      doc.addNamedDestination(article.slug);
      doc.outline.addItem(article.title[locale]);
      paragraph(article.title[locale], 21);
      paragraph(article.summary[locale]);
      paragraph(
        article.requiresPrivateLink
          ? text(
              "Open the complete private link from your email.",
              "请使用邮件中的完整私密链接。",
            )
          : `${text("Open", "打开")}: ${article.route}`,
        9,
      );
      heading(text("Before you begin", "开始之前"));
      for (const value of article.prerequisites)
        paragraph(`• ${value[locale]}`);
      heading(text("Walkthrough", "操作步骤"));
      const shown = new Set<string>();
      for (let index = 0; index < article.steps.length; index++) {
        const step = article.steps[index]!;
        heading(`${index + 1}. ${step.title[locale]}`);
        paragraph(step.body[locale]);
        if (step.focus)
          paragraph(`${text("Look for", "请注意")}: ${step.focus[locale]}`, 9);
        if (step.screenshot && !shown.has(step.screenshot)) {
          const screenshot = getHelpScreenshot(step.screenshot, locale);
          if (screenshot) {
            shown.add(step.screenshot);
            const imageHeight = Math.min(
              300,
              (width * screenshot.viewport.height) / screenshot.viewport.width,
            );
            if (doc.y + imageHeight + 50 > doc.page.height - 48) doc.addPage();
            const imageY = doc.y;
            doc.image(await readScreenshot(screenshot), 48, imageY, {
              fit: [width, imageHeight],
              align: "center",
            });
            doc.y = imageY + imageHeight + 8;
            paragraph(
              `${screenshot.route} · ${screenshot.locale.toUpperCase()} · ${screenshot.capturedAt.slice(0, 10)}`,
              8,
            );
          }
        }
      }
      heading(text("What you should see", "预期结果"));
      paragraph(article.expected[locale]);
      heading(text("How it works", "工作原理"));
      for (const value of article.explanation) paragraph(value[locale]);
      heading(text("If something goes wrong", "遇到问题时"));
      for (const issue of article.troubleshooting) {
        paragraph(issue.problem[locale], 11);
        paragraph(issue.solution[locale]);
      }
    }
    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page++) {
      doc.switchToPage(page);
      // PDFKit still applies the bottom margin to absolute text with lineBreak
      // disabled. Relax it only while drawing the footer to prevent extra pages.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fontSize(8)
        .fillColor("#64748b")
        .text(
          `SHBS · ${helpCaptureInfo.sourceRevision.slice(0, 8)} · ${page + 1} / ${range.count}`,
          48,
          doc.page.height - 32,
          { width, lineBreak: false, align: "right" },
        );
      doc.page.margins.bottom = bottomMargin;
    }
    if (doc.bufferedPageRange().count !== range.count)
      throw new Error("Handbook footer changed the page count");
    doc.end();
    return await complete;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}
