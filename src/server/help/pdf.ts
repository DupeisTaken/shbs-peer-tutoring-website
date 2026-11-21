import "server-only";
import PDFDocument from "pdfkit";
import path from "node:path";
import { handbookArticles, helpAudienceTitles } from "~/lib/help/catalogue";
import {
  getHelpScreenshot,
  getScreenshotSource,
  getStepCaptureViews,
  stepForCaptureView,
  helpCaptureInfo,
} from "~/lib/help/screenshots";
import type { HelpAudience, HelpLocale } from "~/lib/help/types";
import { readScreenshot } from "./assets";
import {
  annotationColors,
  annotationNotice,
  layoutHelpCallouts,
} from "~/app/help/screenshot-annotations";

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
    const captionGap = 8;
    const bodyStyle = {
      options: { width, lineGap: 3, paragraphGap: 8 },
      after: 0.4,
      color: "#334155",
    };
    const titleStyle = {
      options: { width, paragraphGap: 6 },
      after: 0.3,
      color: "#4338ca",
    };
    const captionStyle = {
      options: { width, lineGap: 2, paragraphGap: 2 },
      after: 0.15,
      color: bodyStyle.color,
    };
    type TextStyle = {
      options: PDFKit.Mixins.TextOptions;
      after: number;
      color: string;
    };
    const writeText = (
      value: string,
      size: number,
      style: TextStyle,
      link?: string,
    ) => {
      doc
        .fontSize(size)
        .fillColor(link ? titleStyle.color : style.color)
        .text(value, {
          ...style.options,
          ...(link ? { link, underline: true } : {}),
        });
      doc.moveDown(style.after);
    };
    const measureText = (value: string, size: number, style: TextStyle) => {
      doc.fontSize(size);
      return (
        doc.heightOfString(value, style.options) +
        doc.currentLineHeight(true) * style.after
      );
    };
    const paragraph = (value: string, size = 10, link?: string) =>
      writeText(value, size, bodyStyle, link);
    const heading = (value: string) => {
      if (doc.y > doc.page.height - 135) doc.addPage();
      writeText(value, 13, titleStyle);
    };
    const remainingHeight = () => doc.page.maxY() - doc.y;
    const pageHeight = () => doc.page.maxY() - doc.page.margins.top;
    const captionHeight = (value: string) =>
      value ? measureText(value, 9, captionStyle) : 0;
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
          : article.externalAction
            ? `${article.externalAction.label[locale]}: ${article.externalAction.href}`
            : `${text("Open", "打开")}: ${article.route}`,
        9,
        article.requiresPrivateLink ? undefined : article.externalAction?.href,
      );
      heading(text("Before you begin", "开始之前"));
      for (const value of article.prerequisites)
        paragraph(`• ${value[locale]}`);
      for (let index = 0; index < article.steps.length; index++) {
        const step = article.steps[index]!;
        const walkthrough = index === 0 ? text("Walkthrough", "操作步骤") : "";
        const title = `${index + 1}. ${step.title[locale]}`;
        const focus = step.focus
          ? `${text("Look for", "请注意")}: ${step.focus[locale]}`
          : undefined;
        const views = getStepCaptureViews(step);
        const figures = views.map(({ id, view }) => {
          const screenshot = getHelpScreenshot(id, locale);
          if (!screenshot) return undefined;
          const imageHeight = Math.min(
            300,
            (width * screenshot.viewport.height) / screenshot.viewport.width,
          );
          const annotations = layoutHelpCallouts(
            stepForCaptureView(step, view),
            screenshot,
            locale,
          );
          const source = getScreenshotSource(screenshot);
          const rows = [
            ...(screenshot.state
              ? [{ value: screenshot.state[locale], size: 8 }]
              : []),
            {
              value: `${screenshot.route} · ${screenshot.locale.toUpperCase()} · ${screenshot.capturedAt.slice(0, 10)}`,
              size: 8,
            },
            {
              value: `${text("Capture source", "截图来源")}: ${source.revision} · ${source.label}`,
              size: 8,
            },
            ...(annotations.length
              ? [{ value: annotationNotice[locale], size: 8 }]
              : []),
            ...annotations.map(({ number, text }) => ({
              value: `${number}. ${text}`,
              size: 9,
            })),
          ].map((row) => ({
            ...row,
            height: measureText(row.value, row.size, captionStyle),
          }));
          const label = views.length > 1 ? `${text("View", "视图")} ${view}` : "";
          return {
            screenshot,
            imageHeight,
            annotations,
            rows,
            label,
            continuedLabel: text(
              `Step ${index + 1} · View ${view} (continued)`,
              `步骤 ${index + 1} · 视图 ${view}（续）`,
            ),
            height:
              imageHeight +
              captionGap +
              rows.reduce((height, row) => height + row.height, 0),
          };
        });
        const titleHeight =
          measureText(title, 13, titleStyle) +
          (walkthrough ? measureText(walkthrough, 13, titleStyle) : 0);
        const introHeight =
          titleHeight +
          measureText(step.body[locale], 10, bodyStyle) +
          (focus ? measureText(focus, 9, bodyStyle) : 0);
        const first = figures.find((figure) => figure !== undefined);
        const completeHeight =
          introHeight + (first ? first.height + captionHeight(first.label) : 0);
        // Keep readable groups together when they fit a fresh page. Longer
        // instructions may flow across pages before a numbered figure continuation.
        const introStartHeight =
          completeHeight <= pageHeight()
            ? completeHeight
            : Math.min(
                introHeight,
                titleHeight + doc.fontSize(10).currentLineHeight(true),
              );
        if (
          introStartHeight <= pageHeight() &&
          introStartHeight > remainingHeight()
        )
          doc.addPage();
        const stepPage = doc.page;
        if (walkthrough) writeText(walkthrough, 13, titleStyle);
        writeText(title, 13, titleStyle);
        paragraph(step.body[locale]);
        if (focus) paragraph(focus, 9);
        for (const figure of figures) {
          if (figure) {
            const { screenshot, imageHeight, annotations, rows, continuedLabel } =
              figure;
            let label = doc.page === stepPage ? figure.label : continuedLabel;
            const labelHeight = captionHeight(label);
            const continuedHeight = captionHeight(continuedLabel);
            const imageAndLabelHeight = labelHeight + imageHeight + captionGap;
            const firstRowHeight = rows[0]!.height;
            const minimumHeight =
              imageAndLabelHeight + firstRowHeight <= pageHeight()
                ? imageAndLabelHeight + firstRowHeight
                : imageAndLabelHeight;
            // Oversized captions can continue after the intact image. Reserve
            // the first caption row with the image when that much fits a page.
            if (
              figure.height + labelHeight > remainingHeight() &&
              (figure.height + continuedHeight <= pageHeight() ||
                minimumHeight > remainingHeight()) &&
              doc.y > doc.page.margins.top
            ) {
              doc.addPage();
              label = continuedLabel;
            }
            if (label) writeText(label, 9, captionStyle);
            const imageY = doc.y;
            doc.image(await readScreenshot(screenshot), 48, imageY, {
              fit: [width, imageHeight],
              align: "center",
            });
            const imageWidth = Math.min(
              width,
              (imageHeight * screenshot.viewport.width) /
                screenshot.viewport.height,
            );
            const imageX = 48 + (width - imageWidth) / 2;
            const scale = imageWidth / screenshot.viewport.width;
            // Leaders paint below all labels, and target numbers paint above them.
            for (const annotation of annotations) {
              if (!annotation.leader) continue;
              const x = (value: number) => imageX + value * scale;
              const y = (value: number) => imageY + value * scale;
              doc.save();
              doc
                .moveTo(
                  x(annotation.leader.from.x),
                  y(annotation.leader.from.y),
                )
                .lineTo(x(annotation.leader.to.x), y(annotation.leader.to.y))
                .lineWidth(6 * scale)
                .stroke(annotationColors.backing);
              doc
                .moveTo(
                  x(annotation.leader.from.x),
                  y(annotation.leader.from.y),
                )
                .lineTo(x(annotation.leader.to.x), y(annotation.leader.to.y))
                .lineWidth(2 * scale)
                .stroke(annotationColors.outline);
              doc.restore();
            }
            for (const annotation of annotations) {
              // Map to page coordinates before text layout: PDFKit paginates text
              // using page-space bounds even when the drawing context is scaled.
              const x = (value: number) => imageX + value * scale;
              const y = (value: number) => imageY + value * scale;
              doc.save();
              doc
                .roundedRect(
                  x(annotation.target.x),
                  y(annotation.target.y),
                  annotation.target.width * scale,
                  annotation.target.height * scale,
                  4 * scale,
                )
                .lineWidth(5 * scale)
                .stroke(annotationColors.backing);
              doc
                .roundedRect(
                  x(annotation.target.x),
                  y(annotation.target.y),
                  annotation.target.width * scale,
                  annotation.target.height * scale,
                  4 * scale,
                )
                .lineWidth(3 * scale)
                .stroke(annotationColors.outline);
              if (annotation.showLabel) {
                doc
                  .roundedRect(
                    x(annotation.label.x),
                    y(annotation.label.y),
                    annotation.label.width * scale,
                    annotation.label.height * scale,
                    6 * scale,
                  )
                  .lineWidth(2 * scale)
                  .fillAndStroke(
                    annotationColors.ink,
                    annotationColors.backing,
                  );
                const badgeX =
                  annotation.label.x +
                  annotation.padding +
                  annotation.badgeSize / 2;
                const badgeY = annotation.label.y + annotation.label.height / 2;
                doc
                  .circle(
                    x(badgeX),
                    y(badgeY),
                    (annotation.badgeSize / 2) * scale,
                  )
                  .fill(annotationColors.backing);
                doc
                  .fontSize(annotation.fontSize * scale)
                  .fillColor(annotationColors.ink)
                  .text(
                    String(annotation.number),
                    x(badgeX - annotation.badgeSize / 2),
                    y(badgeY - annotation.fontSize * 0.64),
                    {
                      width: annotation.badgeSize * scale,
                      align: "center",
                      lineBreak: false,
                    },
                  );
                for (const [lineIndex, line] of annotation.lines.entries()) {
                  doc
                    .fontSize(annotation.fontSize * scale)
                    .fillColor(annotationColors.text)
                    .text(
                      line,
                      x(
                        annotation.label.x +
                          annotation.padding * 2 +
                          annotation.badgeSize,
                      ),
                      y(
                        annotation.label.y +
                          annotation.padding +
                          lineIndex * annotation.lineHeight -
                          annotation.fontSize * 0.18,
                      ),
                      { lineBreak: false },
                    );
                }
              }
              doc.restore();
            }
            // Matching target numbers paint last, above every label and leader.
            for (const annotation of annotations) {
              const x = (value: number) => imageX + value * scale;
              const y = (value: number) => imageY + value * scale;
              doc.save();
              doc
                .circle(
                  x(annotation.targetBadge.x),
                  y(annotation.targetBadge.y),
                  annotation.targetBadge.radius * scale,
                )
                .lineWidth(2 * scale)
                .fillAndStroke(annotationColors.ink, annotationColors.backing);
              const targetNumberSize = annotation.fontSize * 0.85;
              doc
                .fontSize(targetNumberSize * scale)
                .fillColor(annotationColors.text)
                .text(
                  String(annotation.number),
                  x(annotation.targetBadge.x - annotation.targetBadge.radius),
                  y(annotation.targetBadge.y - targetNumberSize * 0.64),
                  {
                    width: annotation.targetBadge.radius * 2 * scale,
                    align: "center",
                    lineBreak: false,
                  },
                );
              doc.restore();
            }
            doc.x = 48;
            doc.y = imageY + imageHeight + captionGap;
            for (const { value, size, height } of rows) {
              if (height > remainingHeight()) {
                doc.addPage();
                writeText(continuedLabel, 9, captionStyle);
              }
              writeText(value, size, captionStyle);
            }
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
