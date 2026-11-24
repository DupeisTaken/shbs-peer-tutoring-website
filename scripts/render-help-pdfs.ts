import fs from "node:fs/promises";
import path from "node:path";
import { helpAudiences } from "../src/lib/help/catalogue";
import type { HelpLocale } from "../src/lib/help/types";
import { renderHelpPdf } from "../src/server/help/pdf";

async function run() {
  const args = process.argv.slice(2);
  const arg = (prefix: string, fallback: string) =>
    args.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? fallback;

  const locales = arg("--locales=", "en,zh")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is HelpLocale => s === "en" || s === "zh");
  const pdfOutDir = path.resolve(
    arg("--pdf-out=", ".validation/ci-help-captures/pdfs"),
  );

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

void run();
