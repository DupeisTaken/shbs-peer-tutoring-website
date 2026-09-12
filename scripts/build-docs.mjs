import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const reports = ["user-guide", "technical-report"];
const repository =
  "https://github.com/DupeisTaken/shbs-peer-tutoring-website/blob/main/";
const h = React.createElement;

function plainText(value) {
  if (Array.isArray(value)) return value.map(plainText).join("");
  if (React.isValidElement(value)) return plainText(value.props.children);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** Match GitHub's heading convention, retaining Unicode letters for translated policies. */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/ /g, "-");
}

export function reportLink(href, source) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  const [file, fragment] = href.split("#");
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(source), file),
  );
  const suffix = fragment ? `#${fragment}` : "";
  if (reports.some((name) => resolved === `docs/${name}.md`)) {
    return `${path.posix.basename(resolved, ".md")}.html${suffix}`;
  }
  return (
    repository + resolved.split("/").map(encodeURIComponent).join("/") + suffix
  );
}

/** One renderer supplies the HTML and the link/heading model used by validation. */
export function markdownModel(content, source, linkMapper = (href) => href) {
  const headings = [],
    links = [],
    used = new Set();
  const components = {
    a: ({ href, children }) => {
      if (href) links.push(href);
      return h("a", { href: linkMapper(href, source) }, children);
    },
    img: ({ src, alt }) => {
      if (src) links.push(src);
      return h("img", { src: linkMapper(src, source), alt });
    },
    table: ({ children }) =>
      h(
        "div",
        {
          className: "table-scroll",
          tabIndex: 0,
          role: "region",
          "aria-label": "Scrollable table",
        },
        h("table", {}, children),
      ),
  };
  for (let level = 1; level <= 6; level++) {
    components[`h${level}`] = ({ children }) => {
      const text = plainText(children),
        base = slug(text);
      let id = base,
        count = 0;
      while (used.has(id)) id = `${base}-${++count}`;
      used.add(id);
      headings.push({ level, text, id });
      return h(`h${level}`, { id }, children);
    };
  }
  const html = renderToStaticMarkup(
    h(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm], components, skipHtml: true },
      content,
    ),
  );
  return { html, headings, links };
}

export function renderReport(name) {
  const source = `docs/${name}.md`;
  const model = markdownModel(
    fs.readFileSync(path.join(root, source), "utf8"),
    source,
    reportLink,
  );
  const title = model.headings[0].text;
  const nav = renderToStaticMarkup(
    h(
      "nav",
      { "aria-label": "Report contents" },
      h("p", { className: "eyebrow" }, "In this report"),
      ...model.headings
        .filter((x) => x.level === 2 && x.text !== "Contents")
        .map((x) => h("a", { key: x.id, href: `#${x.id}` }, x.text)),
    ),
  );
  const css = fs.readFileSync(path.join(root, "scripts/report.css"), "utf8");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title} · SHBS Peer Tutoring</title><style>${css}</style></head>
<body><a class="skip" href="#report">Skip to report</a>
<header><a class="brand" href="${repository}docs/README.md"><span class="mark" aria-hidden="true">S</span>SHBS <span class="muted">/ Peer Tutoring</span></a><div class="tools"><a href="user-guide.html" ${name === "user-guide" ? 'aria-current="page"' : ""}>User guide</a><a href="technical-report.html" ${name === "technical-report" ? 'aria-current="page"' : ""}>Technical report</a><button type="button" onclick="window.print()">Print / PDF</button></div></header>
<div class="layout"><aside>${nav}<div class="aside-note">Program reference<br><strong>Maintained role documentation</strong><br>Release status: see repository verification record</div></aside><main id="report"><div class="edition"><span>SHBS / Documentation</span><span>${name === "user-guide" ? "01 · Participation & roles" : "02 · Engineering & operations"}</span></div><article>${model.html}</article><footer>Maintained in the repository · <a href="${repository}${source}">View Markdown source</a><br>Local report navigation works offline. Repository and policy links require internet access.</footer></main></div>
</body></html>
`;
}

export function buildReports(check = false) {
  for (const name of reports) {
    const output = path.join(root, `docs/reports/${name}.html`),
      html = renderReport(name);
    if (check) {
      if (
        !fs.existsSync(output) ||
        fs.readFileSync(output, "utf8").replace(/\r\n/g, "\n") !==
          html.replace(/\r\n/g, "\n")
      ) {
        throw new Error(`Stale report: ${name}. Run npm run docs:build.`);
      }
    } else {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, html);
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  buildReports(process.argv.includes("--check"));
  console.log("Both HTML reports are current.");
}
