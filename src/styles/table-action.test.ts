import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parse, type AnyNode, type Declaration } from "postcss";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
let output: ReturnType<typeof parse>;

/** Compile the production rules with the installed theme. jsdom cannot measure
 * layout, so real-page screenshots and bounding boxes remain a separate check. */
beforeAll(async () => {
  const stylesheet = parse(
    readFileSync(
      fileURLToPath(new URL("./globals.css", import.meta.url)),
      "utf8",
    ),
  );
  const fragments: string[] = [];
  stylesheet.walkAtRules("theme", (rule) => {
    fragments.push(rule.toString());
  });
  for (const selector of [".table-action-list", ".table-action-link"]) {
    let matches = 0;
    stylesheet.walkRules(selector, (rule) => {
      fragments.push(rule.toString());
      matches += 1;
    });
    expect(matches).toBe(1);
  }
  const theme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
  const compiler = await compile(`${theme}\n${fragments.join("\n")}`);
  output = parse(compiler.build([]));
});

function declarations(selector: string, property: string) {
  const found: Declaration[] = [];
  output.walkRules(selector, (rule) => {
    rule.walkDecls(property, (declaration) => {
      found.push(declaration);
    });
  });
  return found;
}

function mediaConditions(declaration: Declaration) {
  const conditions: string[] = [];
  for (
    let parent: AnyNode | undefined = declaration.parent;
    parent;
    parent = parent.parent
  ) {
    if (parent.type === "atrule" && parent.name === "media") {
      conditions.push(parent.params);
    }
  }
  return conditions;
}

describe("shared table action spacing", () => {
  it("emits 44px touch targets and switches to 24px only at the desktop breakpoint", () => {
    const heights = declarations(".table-action-link", "min-height");
    expect(
      heights.map((declaration) => ({
        value: declaration.value,
        media: mediaConditions(declaration),
      })),
    ).toEqual([
      { value: "calc(var(--spacing) * 11)", media: [] },
      { value: "calc(var(--spacing) * 6)", media: ["(width >= 64rem)"] },
    ]);
    // The actual theme spacing unit makes these minima 44px and 24px at 16px/rem.
    const spacing: string[] = [];
    output.walkDecls("--spacing", (declaration) => {
      spacing.push(declaration.value);
    });
    expect(spacing).toEqual(["0.25rem"]);
  });

  it("keeps stacked actions adjacent without a fixed height that clips long labels", () => {
    expect(
      declarations(".table-action-list", "gap").map((entry) => entry.value),
    ).toEqual(["0"]);
    expect(
      declarations(".table-action-list", "flex-direction").map(
        (entry) => entry.value,
      ),
    ).toEqual(["column"]);
    for (const property of [
      "height",
      "max-height",
      "block-size",
      "max-block-size",
    ]) {
      expect(declarations(".table-action-link", property)).toHaveLength(0);
    }
  });
});
