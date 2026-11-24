import "server-only";
import PDFDocument from "pdfkit";
import path from "node:path";
import { handbookArticles, helpAudienceTitles } from "~/lib/help/catalogue";
import {
  getHelpScreenshot,
  getLocalizedReleaseRef,
  getScreenshotSource,
  getStepCaptureViews,
  stepForCaptureView,
  helpCaptureInfo,
} from "~/lib/help/screenshots";
import type { HelpAudience, HelpLocale } from "~/lib/help/types";
import { getScreenshotCaption, getStepFocus } from "~/lib/help/screenshot-copy";
import { readScreenshot } from "./assets";
import {
  annotationColors,
  layoutHelpCallouts,
} from "~/app/help/screenshot-annotations";

export function pdfImageHeight(
  viewport: { width: number; height: number },
  contentWidth: number,
  maxPageHeight: number,
  captureMode?: "viewport" | "full-page" | "cropped",
) {
  const naturalHeight = (contentWidth * viewport.height) / viewport.width;
  // Tall full-page captures become microscopic when clamped to 300 pt; let them
  // occupy most of a page while leaving room for caption/legend rows below.
  const isTall =
    captureMode === "full-page" || viewport.height / viewport.width > 1.05;
  const maxHeight = isTall ? Math.max(300, maxPageHeight - 110) : 300;
  return Math.min(maxHeight, naturalHeight);
}

/** Palette aligned with docs/contributing/design.md: slate surfaces, white canvas,
 * brand indigo accent, and semantic emerald/amber strictly for outcomes and recovery. */
const palette = {
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  subtle: "#94a3b8",
  rule: "#e2e8f0",
  wash: "#f8fafc",
  accent: "#4f46e5",
  accentInk: "#3730a3",
  accentWash: "#eef2ff",
  emerald: "#10b981",
  emeraldInk: "#065f46",
  emeraldWash: "#f0fdf4",
  amber: "#f59e0b",
  amberInk: "#92400e",
  amberWash: "#fffbeb",
  white: "#ffffff",
} as const;

type FontWeight = "regular" | "medium" | "semibold" | "bold" | "mono";

const HAS_CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F]/u;

const FONT_NAME: Record<FontWeight, string> = {
  regular: "Geist",
  medium: "Geist-Medium",
  semibold: "Geist-SemiBold",
  bold: "Geist-Bold",
  mono: "Geist-Mono",
};

const DOWNLOAD_TIME_ZONE = "Asia/Shanghai";

function shanghaiDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DOWNLOAD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year ?? "0000",
    month: parts.month ?? "00",
    day: parts.day ?? "00",
    hour: parts.hour ?? "00",
    minute: parts.minute ?? "00",
  };
}

/** Human-readable download timestamp stamped into PDF cover metadata and footers. */
export function formatDownloadTimestamp(date: Date): string {
  const { year, month, day, hour, minute } = shanghaiDateParts(date);
  return `${year}-${month}-${day} ${hour}:${minute} UTC+8`;
}

/** ASCII-safe download timestamp segment for Content-Disposition PDF filenames. */
export function formatDownloadFilenameStamp(date: Date): string {
  const { year, month, day, hour, minute } = shanghaiDateParts(date);
  return `${year}-${month}-${day}-${hour}${minute}`;
}

/** Each request renders the maintained article records and baked capture files.
 * Typography uses the website's Geist TTF stack with Noto Sans SC for Chinese spans. */
export async function renderHelpPdf(
  audience: HelpAudience,
  locale: HelpLocale,
  downloadedAt: Date = new Date(),
) {
  const articles = handbookArticles(audience);
  const downloadedStamp = formatDownloadTimestamp(downloadedAt);
  const root = process.cwd();
  const notoPath = path.join(root, "public/fonts/help/noto-sans-sc.otf");
  const geistSans = (file: string) =>
    path.join(root, "node_modules/geist/dist/fonts/geist-sans", file);
  const geistMono = (file: string) =>
    path.join(root, "node_modules/geist/dist/fonts/geist-mono", file);

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true,
    font: notoPath,
    info: {
      Title: `SHBS — ${helpAudienceTitles[audience][locale]}`,
      Author: "SHBS Peer Tutoring",
      Subject: "Help Center",
      CreationDate: downloadedAt,
    },
  });
  doc.registerFont("Noto-SC", notoPath);
  doc.registerFont("Geist", geistSans("Geist-Regular.ttf"));
  doc.registerFont("Geist-Medium", geistSans("Geist-Medium.ttf"));
  doc.registerFont("Geist-SemiBold", geistSans("Geist-SemiBold.ttf"));
  doc.registerFont("Geist-Bold", geistSans("Geist-Bold.ttf"));
  doc.registerFont("Geist-Mono", geistMono("GeistMono-Regular.ttf"));

  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  void complete.catch(() => undefined);

  try {
    const text = (en: string, zh: string) => (locale === "zh" ? zh : en);
    const fontFor = (value: string, weight: FontWeight = "regular") =>
      HAS_CJK.test(value) ? "Noto-SC" : FONT_NAME[weight];

    const sources = new Map<string, ReturnType<typeof getScreenshotSource>>();
    const margin = 50;
    const width = doc.page.width - margin * 2;
    const captionGap = 7;

    const bodyStyle = {
      options: { width, lineGap: 3.5, paragraphGap: 6 },
      after: 0.3,
      color: palette.body,
      weight: "regular" as FontWeight,
    };
    const sectionLabelStyle = {
      options: { width, paragraphGap: 3 },
      after: 0.2,
      color: palette.accent,
      weight: "semibold" as FontWeight,
    };
    const stepTitleStyle = {
      options: { width, lineGap: 2, paragraphGap: 3 },
      after: 0.2,
      color: palette.ink,
      weight: "semibold" as FontWeight,
    };
    const captionStyle = {
      options: { width, lineGap: 2.5, paragraphGap: 2 },
      after: 0.15,
      color: palette.body,
      weight: "regular" as FontWeight,
    };
    type TextStyle = {
      options: PDFKit.Mixins.TextOptions;
      after: number;
      color: string;
      weight: FontWeight;
    };

    const writeText = (
      value: string,
      size: number,
      style: TextStyle,
      link?: string,
    ) => {
      doc
        .font(fontFor(value, style.weight))
        .fontSize(size)
        .fillColor(link ? palette.accent : style.color)
        .text(value, {
          ...style.options,
          ...(link ? { link, underline: true } : {}),
        });
      doc.moveDown(style.after);
    };

    const measureText = (value: string, size: number, style: TextStyle) => {
      doc.font(fontFor(value, style.weight)).fontSize(size);
      return (
        doc.heightOfString(value, style.options) +
        doc.currentLineHeight(true) * style.after
      );
    };

    const paragraph = (value: string, size = 10, link?: string) =>
      writeText(value, size, bodyStyle, link);

    const drawHairline = (y: number, color: string = palette.rule) => {
      doc.save();
      doc
        .moveTo(margin, y)
        .lineTo(margin + width, y)
        .lineWidth(0.5)
        .stroke(color);
      doc.restore();
    };

    const sectionHeading = (value: string) => {
      if (doc.y > doc.page.height - 135) doc.addPage();
      doc.x = margin;
      writeText(value, 10.5, sectionLabelStyle);
    };

    const remainingHeight = () => doc.page.maxY() - doc.y;
    const pageHeight = () => doc.page.maxY() - doc.page.margins.top;
    const captionHeight = (value: string) =>
      value ? measureText(value, 8.5, captionStyle) : 0;

    /** Clean Swiss left-bar callout strip: minimal chrome, instant hierarchy. */
    const drawAccentStrip = ({
      title,
      lines,
      accent,
      wash,
      titleColor,
      bodyColor = palette.body,
      fontSize = 9.5,
    }: {
      title?: string;
      lines: string[];
      accent: string;
      wash?: string;
      titleColor: string;
      bodyColor?: string;
      fontSize?: number;
    }) => {
      const barWidth = 2.5;
      const padLeft = 12;
      const padRight = 12;
      const padY = 9;
      const innerX = margin + padLeft;
      const innerWidth = width - padLeft - padRight;
      const lineOpts = { width: innerWidth, lineGap: 3 };
      let contentH = 0;
      if (title) {
        doc.font(fontFor(title, "semibold")).fontSize(10);
        contentH += doc.heightOfString(title, lineOpts) + 4;
      }
      for (const line of lines) {
        doc.font(fontFor(line, "regular")).fontSize(fontSize);
        contentH += doc.heightOfString(line, lineOpts) + 3.5;
      }
      const boxH = contentH + padY * 2 - 3.5;
      if (boxH <= pageHeight() && boxH > remainingHeight()) doc.addPage();
      const boxY = doc.y;
      if (boxH <= remainingHeight()) {
        doc.save();
        if (wash) {
          doc.rect(margin, boxY, width, boxH).fill(wash);
        }
        doc.rect(margin, boxY, barWidth, boxH).fill(accent);
        doc.restore();
      }
      doc.y = boxY + padY;
      if (title) {
        doc
          .font(fontFor(title, "semibold"))
          .fontSize(10)
          .fillColor(titleColor)
          .text(title, innerX, doc.y, lineOpts);
        doc.y += 4;
      }
      for (const line of lines) {
        doc
          .font(fontFor(line, "regular"))
          .fontSize(fontSize)
          .fillColor(bodyColor)
          .text(line, innerX, doc.y, lineOpts);
        doc.y += 3;
      }
      doc.x = margin;
      doc.y = Math.max(doc.y + padY - 3, boxY + boxH) + 12;
    };

    // --- Clean Swiss Cover Page ---
    doc.save();
    doc.rect(0, 0, doc.page.width, 3.5).fill(palette.accent);
    doc.restore();

    const kicker = text(
      "SHBS PEER TUTORING · HELP CENTER",
      "SHBS 同伴辅导 · 帮助中心",
    );
    doc
      .font(fontFor(kicker, "semibold"))
      .fontSize(8.5)
      .fillColor(palette.accent)
      .text(kicker, margin, 52, {
        width,
        characterSpacing: locale === "en" ? 0.8 : 0,
      });

    const coverTitle = helpAudienceTitles[audience][locale];
    doc
      .font(fontFor(coverTitle, "bold"))
      .fontSize(28)
      .fillColor(palette.ink)
      .text(coverTitle, margin, doc.y + 10, { width, lineGap: 2 });

    const coverSubtitle = `${text("Step-by-step instructions, screenshots and troubleshooting", "分步操作、真实截图与问题排查")} · ${articles.length} ${locale === "zh" ? "篇指南" : articles.length === 1 ? "guide" : "guides"}`;
    doc
      .font(fontFor(coverSubtitle, "regular"))
      .fontSize(11)
      .fillColor(palette.muted)
      .text(coverSubtitle, margin, doc.y + 8, { width, lineGap: 3 });

    const metaTop = doc.y + 18;
    drawHairline(metaTop);
    doc.y = metaTop + 10;
    const metaLine = `${text("Revision", "版本")} ${helpCaptureInfo.sourceRevision.slice(0, 12)}   ·   ${text("Updated", "更新")} ${helpCaptureInfo.capturedAt.slice(0, 10)}   ·   ${text("Downloaded", "下载时间")} ${downloadedStamp}`;
    doc
      .font(fontFor(metaLine, "mono"))
      .fontSize(8.5)
      .fillColor(palette.body)
      .text(metaLine, margin, doc.y, { width });
    const provenanceNote = `${getLocalizedReleaseRef(locale)} ${text(
      "Examples use synthetic data; available actions depend on your current permissions.",
      "示例使用虚构数据；实际可执行的操作取决于你当前的权限。",
    )}`;
    doc
      .font(fontFor(provenanceNote, "regular"))
      .fontSize(8.5)
      .fillColor(palette.muted)
      .text(provenanceNote, margin, doc.y + 4, { width, lineGap: 2.5 });
    const metaBottom = doc.y + 10;
    drawHairline(metaBottom);
    doc.x = margin;
    doc.y = metaBottom + 22;

    // Clean Table of Contents
    const tocLabel = text("CONTENTS", "目录");
    doc
      .font(fontFor(tocLabel, "semibold"))
      .fontSize(8.5)
      .fillColor(palette.muted)
      .text(tocLabel, margin, doc.y, {
        width,
        characterSpacing: locale === "en" ? 0.8 : 0,
      });
    doc.y += 10;

    for (const [idx, article] of articles.entries()) {
      if (remainingHeight() < 24) doc.addPage();
      const rowY = doc.y;
      const num = String(idx + 1).padStart(2, "0");
      doc
        .font("Geist-Mono")
        .fontSize(8.5)
        .fillColor(palette.subtle)
        .text(num, margin, rowY + 1.5, { width: 24, lineBreak: false });
      const guideTitle = article.title[locale];
      doc
        .font(fontFor(guideTitle, "medium"))
        .fontSize(10.5)
        .fillColor(palette.ink)
        .text(guideTitle, margin + 26, rowY, {
          goTo: article.slug,
          width: width - 26,
          paragraphGap: 4,
        });
      const lineY = doc.y + 2;
      drawHairline(lineY, "#f1f5f9");
      doc.x = margin;
      doc.y = lineY + 5;
    }

    // --- Article Pages ---
    for (const article of articles) {
      doc.addPage();
      doc.addNamedDestination(article.slug);
      doc.outline.addItem(article.title[locale]);

      // Direct minimal kicker: Audience · N steps
      const audienceLabel =
        helpAudienceTitles[article.audience]?.[locale] ??
        helpAudienceTitles[audience][locale];
      const kickerLine = `${locale === "en" ? audienceLabel.toUpperCase() : audienceLabel}  ·  ${article.steps.length} ${locale === "zh" ? "个步骤" : article.steps.length === 1 ? "step" : "steps"}`;
      doc
        .font(fontFor(kickerLine, "semibold"))
        .fontSize(8)
        .fillColor(palette.accent)
        .text(kickerLine, margin, doc.y, {
          width,
          characterSpacing: locale === "en" ? 0.6 : 0,
        });

      // Bold Geist Guide Title + concise summary
      const articleTitle = article.title[locale];
      doc
        .font(fontFor(articleTitle, "bold"))
        .fontSize(20)
        .fillColor(palette.ink)
        .text(articleTitle, margin, doc.y + 4, { width, lineGap: 2 });

      const summary = article.summary[locale];
      doc
        .font(fontFor(summary, "regular"))
        .fontSize(10.5)
        .fillColor(palette.muted)
        .text(summary, margin, doc.y + 4, { width, lineGap: 3 });

      // Direct inline route / action strip
      const actionLine = article.requiresPrivateLink
        ? text(
            "Open the complete private link from your email.",
            "请使用邮件中的完整私密链接。",
          )
        : article.externalAction
          ? `${article.externalAction.label[locale]}: ${article.externalAction.href}`
          : `${text("Open", "打开")}: ${article.route}`;
      const actionLink = article.requiresPrivateLink
        ? undefined
        : article.externalAction?.href;
      const actionFont = article.requiresPrivateLink
        ? fontFor(actionLine, "medium")
        : fontFor(actionLine, "mono");
      doc.font(actionFont).fontSize(8.5);
      const barH = doc.heightOfString(actionLine, { width: width - 18 }) + 12;
      const barY = doc.y + 10;
      doc.save();
      doc
        .roundedRect(margin, barY, width, barH, 4)
        .fill(article.requiresPrivateLink ? palette.accentWash : palette.wash);
      doc.restore();
      doc
        .font(actionFont)
        .fontSize(8.5)
        .fillColor(
          actionLink
            ? palette.accent
            : article.requiresPrivateLink
              ? palette.accentInk
              : palette.ink,
        )
        .text(actionLine, margin + 9, barY + 6, {
          width: width - 18,
          ...(actionLink ? { link: actionLink, underline: true } : {}),
        });
      doc.x = margin;
      doc.y = barY + barH + 14;

      // Before you begin — light, direct, hairline-separated
      const beforeTitle = text("Before you begin", "开始之前");
      doc
        .font(fontFor(beforeTitle, "semibold"))
        .fontSize(9.5)
        .fillColor(palette.ink)
        .text(beforeTitle, margin, doc.y, { width });
      doc.y += 4;
      for (const value of article.prerequisites) {
        const bullet = `•  ${value[locale]}`;
        doc
          .font(fontFor(bullet, "regular"))
          .fontSize(9.5)
          .fillColor(palette.body)
          .text(bullet, margin + 2, doc.y, { width: width - 2, lineGap: 2.5 });
        doc.y += 2;
      }
      drawHairline(doc.y + 6);
      doc.x = margin;
      doc.y += 16;

      // Walkthrough steps
      for (let index = 0; index < article.steps.length; index++) {
        const step = article.steps[index]!;
        const walkthrough = index === 0 ? text("Walkthrough", "操作步骤") : "";
        const title = `${index + 1}. ${step.title[locale]}`;
        const focusHint = getStepFocus(step, locale);
        const focus = focusHint
          ? `${text("Look for", "请注意")}: ${focusHint}`
          : undefined;
        const views = getStepCaptureViews(step);
        const figures = views.map(({ id, view }) => {
          const screenshot = getHelpScreenshot(id, locale);
          if (!screenshot) return undefined;
          const imageHeight = pdfImageHeight(
            screenshot.viewport,
            width,
            pageHeight(),
            screenshot.captureMode,
          );
          const frameStep = stepForCaptureView(step, view);
          const caption = getScreenshotCaption(frameStep, screenshot, locale);
          const scale = imageHeight / screenshot.viewport.height;
          const inline = layoutHelpCallouts(frameStep, screenshot, locale);
          const annotations = inline.some(
            (annotation) =>
              annotation.showLabel && annotation.fontSize * scale < 8,
          )
            ? layoutHelpCallouts(frameStep, screenshot, locale, false)
            : inline;
          const source = getScreenshotSource(screenshot, locale);
          sources.set(`${source.revision}:${source.label}`, source);
          const rows = [
            ...(caption
              ? [{ value: caption, size: 8.5, kind: "caption" as const }]
              : []),
            ...annotations
              .filter((annotation) => !annotation.showLabel)
              .map(({ number, text: labelText }) => ({
                value: `${number}. ${labelText}`,
                size: 8.5,
                kind: "legend" as const,
              })),
            {
              value: `${screenshot.route} · ${screenshot.locale.toUpperCase()} · ${screenshot.capturedAt.slice(0, 10)} · ${source.revision.slice(0, 12)}`,
              size: 7.5,
              kind: "meta" as const,
            },
          ].map((row) => ({
            ...row,
            height: measureText(row.value, row.size, captionStyle),
          }));
          const label =
            views.length > 1 ? `${text("View", "视图")} ${view}` : "";
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
          measureText(title, 12, stepTitleStyle) +
          (walkthrough ? measureText(walkthrough, 10.5, sectionLabelStyle) : 0);
        const introHeight =
          titleHeight +
          measureText(step.body[locale], 10, bodyStyle) +
          (focus ? measureText(focus, 9, bodyStyle) + 12 : 0);
        const first = figures.find((figure) => figure !== undefined);
        const completeHeight =
          introHeight + (first ? first.height + captionHeight(first.label) : 0);
        const introStartHeight =
          completeHeight <= pageHeight()
            ? completeHeight
            : Math.min(
                introHeight,
                titleHeight +
                  doc.font(fontFor(step.body[locale])).fontSize(10).currentLineHeight(true),
              );
        if (
          introStartHeight <= pageHeight() &&
          introStartHeight > remainingHeight()
        )
          doc.addPage();
        const stepPage = doc.page;
        if (walkthrough) {
          doc
            .font(fontFor(walkthrough, "semibold"))
            .fontSize(10.5)
            .fillColor(palette.accent)
            .text(walkthrough, margin, doc.y, { width });
          doc.y += 6;
        }
        // Step title with clean left accent indicator
        const stepTitleY = doc.y;
        doc.save();
        doc.rect(margin, stepTitleY + 2, 2.5, 13).fill(palette.accent);
        doc.restore();
        doc
          .font(fontFor(title, "semibold"))
          .fontSize(12)
          .fillColor(palette.ink)
          .text(title, margin + 9, stepTitleY, { width: width - 9, lineGap: 2 });
        doc.x = margin;
        doc.y += 4;

        paragraph(step.body[locale]);

        if (focus) {
          drawAccentStrip({
            lines: [focus],
            accent: palette.accent,
            wash: palette.wash,
            titleColor: palette.accentInk,
            bodyColor: palette.ink,
            fontSize: 9,
          });
        }

        for (const figure of figures) {
          if (!figure) continue;
          const {
            screenshot,
            imageHeight,
            annotations,
            rows,
            continuedLabel,
          } = figure;
          let label = doc.page === stepPage ? figure.label : continuedLabel;
          const labelHeight = captionHeight(label);
          const continuedHeight = captionHeight(continuedLabel);
          const imageAndLabelHeight = labelHeight + imageHeight + captionGap;
          const firstRowHeight = rows[0]!.height;
          const minimumHeight =
            imageAndLabelHeight + firstRowHeight <= pageHeight()
              ? imageAndLabelHeight + firstRowHeight
              : imageAndLabelHeight;
          if (
            figure.height + labelHeight > remainingHeight() &&
            (figure.height + continuedHeight <= pageHeight() ||
              minimumHeight > remainingHeight()) &&
            doc.y > doc.page.margins.top
          ) {
            doc.addPage();
            label = continuedLabel;
          }
          if (label) {
            doc
              .font(fontFor(label, "medium"))
              .fontSize(8.5)
              .fillColor(palette.muted)
              .text(label, margin, doc.y, captionStyle.options);
            doc.moveDown(captionStyle.after);
          }
          const imageY = doc.y;
          const imageWidth = Math.min(
            width,
            (imageHeight * screenshot.viewport.width) /
              screenshot.viewport.height,
          );
          const imageX = margin + (width - imageWidth) / 2;
          const scale = imageWidth / screenshot.viewport.width;

          // Subtle crisp rounded frame around screenshot
          doc.save();
          doc.roundedRect(imageX, imageY, imageWidth, imageHeight, 4).clip();
          doc.image(await readScreenshot(screenshot), margin, imageY, {
            fit: [width, imageHeight],
            align: "center",
          });
          doc.restore();
          doc.save();
          doc
            .roundedRect(imageX, imageY, imageWidth, imageHeight, 4)
            .lineWidth(0.5)
            .stroke(palette.rule);
          doc.restore();

          // Leaders paint below all labels, and target numbers paint above them.
          for (const annotation of annotations) {
            if (!annotation.leader) continue;
            const x = (value: number) => imageX + value * scale;
            const y = (value: number) => imageY + value * scale;
            doc.save();
            doc
              .moveTo(x(annotation.leader.from.x), y(annotation.leader.from.y))
              .lineTo(x(annotation.leader.to.x), y(annotation.leader.to.y))
              .lineCap("round")
              .lineWidth(Math.max(2, 4.5 * scale))
              .stroke(annotationColors.backing);
            doc
              .moveTo(x(annotation.leader.from.x), y(annotation.leader.from.y))
              .lineTo(x(annotation.leader.to.x), y(annotation.leader.to.y))
              .lineCap("round")
              .lineWidth(Math.max(0.9, 1.75 * scale))
              .stroke(annotationColors.outline);
            doc.restore();
          }
          for (const annotation of annotations) {
            const x = (value: number) => imageX + value * scale;
            const y = (value: number) => imageY + value * scale;
            doc.save();
            doc
              .roundedRect(
                x(annotation.target.x),
                y(annotation.target.y),
                annotation.target.width * scale,
                annotation.target.height * scale,
                Math.max(2, 7 * scale),
              )
              .fillOpacity(0.07)
              .fill(annotationColors.outline);
            doc.restore();
            doc.save();
            doc
              .roundedRect(
                x(annotation.target.x),
                y(annotation.target.y),
                annotation.target.width * scale,
                annotation.target.height * scale,
                Math.max(2, 7 * scale),
              )
              .lineWidth(Math.max(2, 4.5 * scale))
              .stroke(annotationColors.backing);
            doc
              .roundedRect(
                x(annotation.target.x),
                y(annotation.target.y),
                annotation.target.width * scale,
                annotation.target.height * scale,
                Math.max(2, 7 * scale),
              )
              .lineWidth(Math.max(1.2, 2.5 * scale))
              .stroke(annotationColors.outline);
            if (annotation.showLabel) {
              doc
                .roundedRect(
                  x(annotation.label.x),
                  y(annotation.label.y),
                  annotation.label.width * scale,
                  annotation.label.height * scale,
                  Math.max(3, 10 * scale),
                )
                .lineWidth(Math.max(1, 2 * scale))
                .fillAndStroke(annotationColors.ink, annotationColors.backing);
              const badgeX =
                annotation.label.x +
                annotation.padding +
                annotation.badgeSize / 2;
              const badgeY = annotation.label.y + annotation.label.height / 2;
              doc
                .circle(x(badgeX), y(badgeY), (annotation.badgeSize / 2) * scale)
                .fill(annotationColors.accent);
              doc
                .font("Geist-SemiBold")
                .fontSize(annotation.fontSize * 0.92 * scale)
                .fillColor(annotationColors.text)
                .text(
                  String(annotation.number),
                  x(badgeX - annotation.badgeSize / 2),
                  y(badgeY - annotation.fontSize * 0.54),
                  {
                    width: annotation.badgeSize * scale,
                    align: "center",
                    lineBreak: false,
                  },
                );
              for (const [lineIndex, line] of annotation.lines.entries()) {
                doc
                  .font(fontFor(line, "medium"))
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
                        annotation.fontSize * 0.14,
                    ),
                    { lineBreak: false },
                  );
              }
            }
            doc.restore();
          }
          for (const annotation of annotations) {
            const x = (value: number) => imageX + value * scale;
            const y = (value: number) => imageY + value * scale;
            const badgeRadius = Math.max(
              6.5,
              annotation.targetBadge.radius * scale,
            );
            const badgeFontSize = Math.max(
              7,
              annotation.fontSize * 0.85 * scale,
            );
            const cx = Math.max(
              imageX + badgeRadius,
              Math.min(
                x(annotation.targetBadge.x),
                imageX + imageWidth - badgeRadius,
              ),
            );
            const cy = Math.max(
              imageY + badgeRadius,
              Math.min(
                y(annotation.targetBadge.y),
                imageY + imageHeight - badgeRadius,
              ),
            );
            doc.save();
            doc
              .circle(cx, cy, badgeRadius)
              .lineWidth(Math.max(1.1, 2.25 * scale))
              .fillAndStroke(annotationColors.accent, annotationColors.backing);
            doc
              .font("Geist-SemiBold")
              .fontSize(badgeFontSize)
              .fillColor(annotationColors.text)
              .text(
                String(annotation.number),
                cx - badgeRadius,
                cy - badgeFontSize * 0.58,
                {
                  width: badgeRadius * 2,
                  align: "center",
                  lineBreak: false,
                },
              );
            doc.restore();
          }

          doc.x = margin;
          doc.y = imageY + imageHeight + captionGap;
          for (const { value, size, height, kind } of rows) {
            if (height > remainingHeight()) {
              doc.addPage();
              writeText(continuedLabel, 8.5, captionStyle);
            }
            doc
              .font(
                kind === "meta"
                  ? fontFor(value, "mono")
                  : kind === "legend"
                    ? fontFor(value, "medium")
                    : fontFor(value, "regular"),
              )
              .fontSize(size)
              .fillColor(
                kind === "meta"
                  ? palette.muted
                  : kind === "legend"
                    ? palette.ink
                    : palette.body,
              )
              .text(value, margin, doc.y, captionStyle.options);
            doc.moveDown(captionStyle.after);
          }
          doc.moveDown(0.35);
        }
      }

      // What you should see — clean emerald left bar
      drawAccentStrip({
        title: text("What you should see", "预期结果"),
        lines: [article.expected[locale]],
        accent: palette.emerald,
        wash: palette.emeraldWash,
        titleColor: palette.emeraldInk,
        bodyColor: palette.emeraldInk,
        fontSize: 9.5,
      });

      // How it works
      sectionHeading(text("How it works", "工作原理"));
      for (const value of article.explanation) paragraph(value[locale]);

      // If something goes wrong — clean amber left bar
      drawAccentStrip({
        title: text("If something goes wrong", "遇到问题时"),
        lines: article.troubleshooting.map(
          (issue) => `•  ${issue.problem[locale]} — ${issue.solution[locale]}`,
        ),
        accent: palette.amber,
        wash: palette.amberWash,
        titleColor: palette.amberInk,
        bodyColor: palette.body,
        fontSize: 9.5,
      });
    }

    if (sources.size) {
      sectionHeading(text("Capture sources", "截图来源"));
      for (const { revision, label } of sources.values()) {
        const line = `${revision} · ${label}`;
        doc
          .font(fontFor(line, "mono"))
          .fontSize(8)
          .fillColor(palette.muted)
          .text(line, margin, doc.y, bodyStyle.options);
        doc.moveDown(0.2);
      }
    }

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page++) {
      doc.switchToPage(page);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerRuleY = doc.page.height - 40;
      if (page > range.start) {
        drawHairline(footerRuleY, palette.rule);
        const leftFooter = `SHBS Peer Tutoring · ${helpAudienceTitles[audience][locale]}`;
        doc
          .font(fontFor(leftFooter, "regular"))
          .fontSize(7.5)
          .fillColor(palette.muted)
          .text(leftFooter, margin, doc.page.height - 32, {
            width: width * 0.65,
            lineBreak: false,
            align: "left",
          });
      }
      const rightFooter = `${downloadedStamp} · ${helpCaptureInfo.sourceRevision.slice(0, 8)} · ${String(page + 1).padStart(2, "0")} / ${String(range.count).padStart(2, "0")}`;
      doc
        .font("Geist-Mono")
        .fontSize(7.5)
        .fillColor(palette.muted)
        .text(rightFooter, margin, doc.page.height - 32, {
          width,
          lineBreak: false,
          align: "right",
        });
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
