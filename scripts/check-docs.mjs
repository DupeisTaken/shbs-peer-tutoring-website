import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { root, markdownModel, buildReports } from "./build-docs.mjs";

/** Resolve only repository links. External URLs are deliberately not fetched by CI. */
export function validateLinks(source, model, exists, headingsFor) {
  const errors = [];
  for (const href of model.links) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(href)) continue;
    const [file, fragment] = href.split("#");
    const target = file
      ? path.posix.normalize(
          path.posix.join(path.posix.dirname(source), decodeURIComponent(file)),
        )
      : source;
    if (target.startsWith("../") || !exists(target)) {
      errors.push(`${source}: missing target ${href}`);
    } else if (
      fragment &&
      target.endsWith(".md") &&
      !headingsFor(target).includes(decodeURIComponent(fragment))
    ) {
      errors.push(`${source}: missing heading ${href}`);
    }
  }
  return errors;
}

export function validateForm(form) {
  const errors = [],
    ids = new Set();
  if (!form?.name || !form.description || !Array.isArray(form.body))
    return ["Missing name, description or body"];
  for (const field of form.body) {
    if (
      !["markdown", "input", "textarea", "dropdown", "checkboxes"].includes(
        field.type,
      )
    )
      errors.push("Unsupported field type");
    if (field.type === "markdown") {
      if (!field.attributes?.value) errors.push("Missing markdown text");
      continue;
    }
    if (!field.id || ids.has(field.id))
      errors.push(`Missing or duplicate field id: ${field.id}`);
    ids.add(field.id);
    if (!field.attributes?.label) errors.push(`Missing label: ${field.id}`);
    if (
      ["dropdown", "checkboxes"].includes(field.type) &&
      !field.attributes?.options?.length
    )
      errors.push(`Missing options: ${field.id}`);
  }
  if (!form.body.some((f) => f.validations?.required))
    errors.push("No required report content");
  if (
    !form.body.some(
      (f) =>
        f.id === "privacy" && f.attributes?.options?.some((o) => o.required),
    )
  )
    errors.push("Missing privacy acknowledgment");
  return errors;
}

function markdownFiles(directory) {
  return fs
    .readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory())
        return entry.name === "archive" || entry.name === "reports"
          ? []
          : markdownFiles(relative);
      return entry.name.endsWith(".md") ? [relative] : [];
    });
}

export function checkDocs() {
  const files = [
    ...fs.readdirSync(root).filter((name) => name.endsWith(".md")),
    ...markdownFiles("docs"),
    ...markdownFiles("prisma/policies"),
  ];
  const cache = new Map(),
    errors = [];
  const modelFor = (file) => {
    if (!cache.has(file))
      cache.set(
        file,
        markdownModel(fs.readFileSync(path.join(root, file), "utf8"), file),
      );
    return cache.get(file);
  };
  for (const file of files) {
    errors.push(
      ...validateLinks(
        file,
        modelFor(file),
        (target) => fs.existsSync(path.join(root, target)),
        (target) => modelFor(target).headings.map((h) => h.id),
      ),
    );
  }
  const roleIds = modelFor("docs/user-guide.md").headings.map((h) => h.id);
  for (const role of [
    "tutees",
    "tutors",
    "crew",
    "coordinators",
    "administrators",
    "head",
    "viewers",
    "translators",
  ]) {
    if (!roleIds.includes(role))
      errors.push(`Missing user role section: ${role}`);
  }
  for (const name of ["bug_report", "feature_request", "documentation"]) {
    const file = `.github/ISSUE_TEMPLATE/${name}.yml`;
    errors.push(
      ...validateForm(
        yaml.load(fs.readFileSync(path.join(root, file), "utf8")),
      ).map((e) => `${file}: ${e}`),
    );
  }
  const config = yaml.load(
    fs.readFileSync(
      path.join(root, ".github/ISSUE_TEMPLATE/config.yml"),
      "utf8",
    ),
  );
  if (
    config.blank_issues_enabled !== false ||
    !config.contact_links?.every(
      (link) => link.name && link.about && /^https:\/\//.test(link.url),
    )
  )
    errors.push("Invalid issue chooser configuration");
  buildReports(true);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Validated ${files.length} Markdown documents, all role sections, three issue forms and both HTML reports.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  checkDocs();
