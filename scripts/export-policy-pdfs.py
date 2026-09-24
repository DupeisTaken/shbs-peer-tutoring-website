"""Print the maintained EN/ZH policy Markdown as four consistently styled A4 PDFs.

Requires ReportLab. Fonts are embedded so Chinese remains printable offline.
The deliberately small Markdown renderer supports the policy sources' headings,
paragraphs, bold text and tables; unsupported constructs fail instead of disappearing.
"""

import argparse
from html import escape
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageTemplate, Paragraph, Table, TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
INK = colors.HexColor("#1D3039")
TEAL = colors.HexColor("#176560")
MUTED = colors.HexColor("#58666C")
RULE = colors.HexColor("#CCD9D8")


def inline(text):
    # Normalize dashes for portable extraction while retaining arrows and Chinese.
    text = escape(text.replace("–", "-").replace("—", "-"))
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)


class PolicyDocument(BaseDocTemplate):
    """Add PDF outline entries from the same headings used on the printed page."""

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == "section":
            key = f"section-{self.seq.nextf('section')}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(flowable.getPlainText(), key, level=0)


def export(source, destination, locale):
    is_zh = locale == "zh"
    regular, bold = ("PolicyZH", "PolicyZH-Bold") if is_zh else ("PolicyEN", "PolicyEN-Bold")
    body = ParagraphStyle(
        "body", fontName=regular, fontSize=10.2, leading=15.5 if is_zh else 14,
        textColor=INK, spaceAfter=7, alignment=TA_LEFT,
        wordWrap="CJK" if is_zh else None, allowWidows=0, allowOrphans=0,
    )
    styles = {
        "body": body,
        "title": ParagraphStyle("title", parent=body, fontName=bold, fontSize=22,
                                leading=30, textColor=TEAL, spaceAfter=12, keepWithNext=True),
        "section": ParagraphStyle("section", parent=body, fontName=bold, fontSize=14,
                                  leading=21, textColor=TEAL, spaceBefore=14,
                                  spaceAfter=8, keepWithNext=True),
        "subsection": ParagraphStyle("subsection", parent=body, fontName=bold,
                                     fontSize=10.8, leading=17, spaceBefore=6,
                                     spaceAfter=5, keepWithNext=True),
        "meta": ParagraphStyle("meta", parent=body, fontSize=9, leading=14,
                               textColor=MUTED, spaceAfter=14),
        "cell": ParagraphStyle("cell", parent=body, fontSize=9.5, leading=13, spaceAfter=0),
    }
    content = source.read_text(encoding="utf-8")
    lines = content.splitlines()
    title = lines[0].removeprefix("# ")
    revision = re.search(r"\b\d{4}\.\d{2}\.\d{2}\b", content).group()
    audience = "TUTOR" if source.name.startswith("tutor-") else "TUTEE"
    doc = PolicyDocument(str(destination), pagesize=A4, leftMargin=48, rightMargin=48,
                         topMargin=55, bottomMargin=49, title=title,
                         author="SHBS Peer Tutoring Team", subject=f"Review draft {revision}")

    def page_furniture(canvas, document):
        canvas.saveState()
        width, height = A4
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.6)
        canvas.line(48, height - 38, width - 48, height - 38)
        canvas.setFont("PolicyEN-Bold", 8)
        canvas.setFillColor(TEAL)
        canvas.drawString(48, height - 28, "SHBS / PEER TUTORING")
        canvas.setFont("PolicyEN", 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(width - 48, height - 28, f"{audience} POLICY / {locale.upper()}")
        canvas.line(48, 34, width - 48, 34)
        canvas.setFont(regular, 8)
        status = "待校方审核草案" if is_zh else "DRAFT FOR SCHOOL REVIEW"
        canvas.drawString(48, 21, f"{status}  |  {revision}")
        canvas.drawRightString(width - 48, 21, str(document.page))
        canvas.restoreState()

    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates(PageTemplate(id="policy", frames=frame, onPage=page_furniture))
    story = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line.startswith("|"):
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", cell) for cell in cells):
                    rows.append([Paragraph(inline(cell), styles["cell"]) for cell in cells])
                index += 1
            table = Table(rows, colWidths=[doc.width * 0.4, doc.width * 0.6], repeatRows=1,
                          hAlign="LEFT", spaceAfter=10)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E4EFED")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F8F8")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, RULE),
            ]))
            # The short reference table should remain on one page for printing.
            story.append(KeepTogether([table]))
            continue
        heading = re.match(r"^(#{1,3}) (.+)$", line)
        if heading:
            style = {1: "title", 2: "section", 3: "subsection"}[len(heading[1])]
            story.append(Paragraph(inline(heading[2]), styles[style]))
            index += 1
            continue
        if re.match(r"^(?:#|[-*] |[0-9]+\. |>|```)", line) or "](" in line:
            raise ValueError(f"Unsupported Markdown at {source}:{index + 1}")
        paragraph = [line]
        index += 1
        while index < len(lines) and lines[index].strip():
            if lines[index].startswith(("#", "|")):
                break
            paragraph.append(lines[index].strip())
            index += 1
        style = "meta" if paragraph[0].startswith(("**Revision:", "**修订版：")) else "body"
        story.append(Paragraph(inline(" ".join(paragraph)), styles[style]))
    doc.build(story)
    print(f"Created {destination.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/pdf")
    parser.add_argument("--font-en", type=Path, default=Path("C:/Windows/Fonts/arial.ttf"))
    parser.add_argument("--font-en-bold", type=Path, default=Path("C:/Windows/Fonts/arialbd.ttf"))
    parser.add_argument("--font-zh", type=Path, default=Path("C:/Windows/Fonts/msyh.ttc"))
    parser.add_argument("--font-zh-bold", type=Path, default=Path("C:/Windows/Fonts/msyhbd.ttc"))
    args = parser.parse_args()
    for name, path in [("PolicyEN", args.font_en), ("PolicyEN-Bold", args.font_en_bold),
                       ("PolicyZH", args.font_zh), ("PolicyZH-Bold", args.font_zh_bold)]:
        if not path.is_file():
            parser.error(f"Font missing: {path}; supply its --font option")
        pdfmetrics.registerFont(TTFont(name, str(path)))
    for family in ("PolicyEN", "PolicyZH"):
        pdfmetrics.registerFontFamily(family, normal=family, bold=family + "-Bold")
    args.output.mkdir(parents=True, exist_ok=True)
    for audience in ("tutor", "tutee"):
        for locale in ("en", "zh"):
            filename = f"{audience}-policy.{locale}"
            export(ROOT / f"prisma/policies/{filename}.md", args.output / f"{filename}.pdf", locale)


if __name__ == "__main__":
    main()
