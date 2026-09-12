import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(root, entry.name))
      : [join(root, entry.name)],
  );
}
/** Validate route references against Next's filesystem routes, including groups and dynamic slugs.
 * Runtime CMS URLs and interpolated IDs are checked separately in the browser/API audit. */
it("every literal internal page/notification link resolves to a deployed route", () => {
  const routes = files("src/app")
    .filter((path) => /[\\/](page|route)\.[tj]sx?$/.test(path))
    .map((path) => {
      const parts = relative("src/app", path)
        .replaceAll("\\", "/")
        .split("/")
        .slice(0, -1)
        .filter((part) => !part.startsWith("("));
      return new RegExp(
        "^/" +
          parts
            .map((part) =>
              part.startsWith("[...")
                ? ".+"
                : part.startsWith("[[...")
                  ? ".*"
                  : part.startsWith("[")
                    ? "[^/]+"
                    : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("/") +
          "/?$",
      );
    });
  const missing: string[] = [];
  for (const path of files("src").filter(
    (path) => /\.[tj]sx?$/.test(path) && !path.includes(".test."),
  )) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /\b(?:href|link)\s*(?:=\s*\{?\s*|:\s*)["'`]([^"'`]+)["'`]/g,
    )) {
      const href = match[1]!;
      if (!href.startsWith("/") || href.startsWith("//") || href.includes("${"))
        continue;
      const pathname = href.split(/[?#]/)[0]!;
      if (!routes.some((route) => route.test(pathname)))
        missing.push(`${path}: ${href}`);
    }
  }
  expect(missing).toEqual([]);
});

it("every shared button variant used by the UI has a definition", () => {
  const css = readFileSync("src/styles/globals.css", "utf8");
  const variants = new Set(
    files("src/app")
      .filter((path) => path.endsWith(".tsx") && !path.includes(".test."))
      .flatMap((path) =>
        [...readFileSync(path, "utf8").matchAll(/\bbtn-([a-z]+)\b/g)].map(
          (match) => match[0],
        ),
      ),
  );
  expect([...variants].filter((name) => !css.includes(`.${name} {`))).toEqual(
    [],
  );
});
