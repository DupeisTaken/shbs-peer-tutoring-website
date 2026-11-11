/** Synthetic offline previews: never import the database, secrets, or live transport. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderEmail } from "../src/server/email/template";
import { emailPreviewSamples } from "./email-preview-samples";

const output = resolve(process.argv[2] ?? ".validation/email-previews");
await mkdir(output, { recursive: true });
const brand = "SHBS Peer Tutoring";
const iconUrl = "https://tutoring.example.edu/icon.png";
// Embed the real site icon only in offline previews; sent mail uses the public site URL.
const iconDataUrl = `data:image/png;base64,${(await readFile(new URL("../src/app/icon.png", import.meta.url))).toString("base64")}`;
const samples = [...emailPreviewSamples("en"), ...emailPreviewSamples("zh")];
for (const sample of samples) {
  const html = (
    sample.html ?? renderEmail({ brand, ...sample, iconUrl })
  ).replace(`src="${iconUrl}"`, `src="${iconDataUrl}"`);
  await writeFile(resolve(output, `${sample.name}.html`), html);
  await writeFile(resolve(output, `${sample.name}.txt`), sample.text);
  await writeFile(
    resolve(output, `${sample.name}.json`),
    JSON.stringify(sample, null, 2),
  );
  if (
    sample.name.startsWith("invitation-") &&
    !sample.name.startsWith("invitation-verification-")
  )
    await writeFile(
      resolve(output, `${sample.name}-no-stylesheet-or-images.html`),
      html
        .replace(/<style>[\s\S]*?<\/style>/g, "")
        .replace(/<img\b[^>]*>/g, ""),
    );
  if (sample.name.startsWith("school-r2-"))
    await writeFile(
      resolve(output, `${sample.name}-no-css-or-images.html`),
      html
        .replace(/<style>[\s\S]*?<\/style>/g, "")
        .replace(/\sstyle="[^"]*"/g, "")
        .replace(/<img\b[^>]*>/g, ""),
    );
}
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email previews</title><style>body{font:16px/1.7 system-ui;max-width:960px;margin:32px auto;padding:0 20px;color:#17202a}li{margin:10px 0}a{color:#174cbe}</style><h1>Delivery email previews · synthetic data</h1><p>Production copy builders, HTML and plain text. No mail is sent and sample links grant no access. Each draft uses one delivery language. Account Settings controls an established recipient’s email language independently from the website language. Accountless sources retain their signup language; external school recipients default to English. Names and recorded free text remain unchanged.</p><ol>${samples.map((sample) => `<li><a href="${sample.name}.html">${sample.name}</a> · <a href="${sample.name}.txt">plain text</a></li>`).join("")}</ol><p><a href="invitation-en-no-stylesheet-or-images.html">Invitation with stylesheet and images removed</a></p></html>`,
);
await writeFile(
  resolve(output, "manifest.json"),
  JSON.stringify(
    samples.map(({ name, subject, text }) => ({
      name,
      subject,
      textCharacters: text.length,
    })),
    null,
    2,
  ),
);
console.log(
  `Wrote ${samples.length} production-copy email previews to ${output}`,
);
