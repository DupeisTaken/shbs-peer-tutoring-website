import { expect, it, vi } from "vitest";
import { renderHelpPdf } from "./pdf";

vi.mock("~/lib/help/catalogue", () => {
  const text = { en: "Read guide", zh: "查看指南" };
  return {
    helpArticles: [],
    helpAudienceTitles: { observer: text },
    handbookArticles: () => [
      {
        slug: "short-guide",
        title: text,
        summary: text,
        route: "/help",
        prerequisites: [text],
        steps: [
          {
            title: text,
            body: { en: "中文", zh: "中文" },
            screenshot: "admin-crew",
            focus: text,
          },
        ],
        expected: text,
        explanation: [text],
        troubleshooting: [{ problem: text, solution: text }],
      },
    ],
  };
});

it.each(["en", "zh"] as const)(
  "renders the real %s font, image and footer without appending footer-only pages",
  async (locale) => {
    const bytes = await renderHelpPdf("observer", locale);
    const pdf = bytes.toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(pdf).toContain("/FontFile3");
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).toContain("/Outlines");
  },
);
