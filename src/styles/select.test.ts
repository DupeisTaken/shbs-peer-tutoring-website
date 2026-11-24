import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type AnyNode, type Declaration } from "postcss";
import { compile } from "tailwindcss";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
let output: ReturnType<typeof parse>;

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsx(full, out);
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

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
  stylesheet.walkAtRules("layer", (layer) => {
    if (layer.params !== "components") return;
    layer.each((node) => {
      const text = node.toString();
      if (
        text.includes(".select") ||
        text.includes(".control-compact") ||
        text.includes(".popover-surface")
      ) {
        fragments.push(text);
      }
    });
  });
  const theme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
  const compiler = await compile(`${theme}\n${fragments.join("\n")}`);
  output = parse(compiler.build([]));
});

function rulesMatching(matcher: (selector: string) => boolean) {
  const matched: { selector: string; decls: Declaration[] }[] = [];
  output.walkRules((rule) => {
    if (!matcher(rule.selector)) return;
    const decls: Declaration[] = [];
    rule.walkDecls((decl) => {
      decls.push(decl);
    });
    matched.push({ selector: rule.selector, decls });
  });
  return matched;
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

describe("shared .select and .popover-surface styles", () => {
  it("applies custom SVG chevron and logical padding only to single-value .select controls", () => {
    const singleRules = rulesMatching(
      (sel) =>
        sel.includes(".select:not([multiple]):not([size])") &&
        !sel.includes(".control-compact") &&
        !sel.includes(":dir(rtl)"),
    );
    expect(singleRules.length).toBeGreaterThan(0);

    const screenRule = singleRules.find((r) =>
      r.decls.some((d) => d.prop === "appearance" && d.value === "none"),
    );
    expect(screenRule).toBeDefined();
    expect(
      screenRule!.decls.some(
        (d) =>
          d.prop === "background-image" &&
          d.value.includes("data:image/svg+xml") &&
          d.value.includes("%2364748b"),
      ),
    ).toBe(true);
    expect(
      screenRule!.decls.some(
        (d) =>
          d.prop === "background-position" &&
          d.value === "right 0.625rem center",
      ),
    ).toBe(true);
    expect(
      screenRule!.decls.some(
        (d) => d.prop === "background-size" && d.value === "0.875rem 0.875rem",
      ),
    ).toBe(true);
    expect(
      screenRule!.decls.some(
        (d) =>
          d.prop === "padding-inline-start" &&
          d.value === "calc(var(--spacing) * 3)",
      ),
    ).toBe(true);
    expect(
      screenRule!.decls.some(
        (d) =>
          d.prop === "padding-inline-end" &&
          d.value === "calc(var(--spacing) * 8)",
      ),
    ).toBe(true);
  });

  it("tightens .select.control-compact padding, chevron inset, and 44px/32px touch-desktop heights", () => {
    const compactRules = rulesMatching(
      (sel) =>
        sel.includes(".select.control-compact:not([multiple]):not([size])") &&
        !sel.includes(":dir(rtl)"),
    );
    expect(compactRules).toHaveLength(1);
    const decls = compactRules[0]!.decls;
    expect(
      decls.some(
        (d) => d.prop === "background-position" && d.value === "right 0.5rem center",
      ),
    ).toBe(true);
    expect(
      decls.some(
        (d) =>
          d.prop === "padding-inline-start" &&
          d.value === "calc(var(--spacing) * 2.5)",
      ),
    ).toBe(true);
    expect(
      decls.some(
        (d) =>
          d.prop === "padding-inline-end" &&
          d.value === "calc(var(--spacing) * 7)",
      ),
    ).toBe(true);
    const heights = decls
      .filter((d) => d.prop === "min-height")
      .map((d) => ({ value: d.value, media: mediaConditions(d) }));
    expect(heights).toEqual([
      { value: "calc(var(--spacing) * 11)", media: [] },
      { value: "calc(var(--spacing) * 8)", media: ["(width >= 64rem)"] },
    ]);
  });

  it("flips chevron alignment in RTL and restores native arrow under forced-colors", () => {
    const rtlStandard = rulesMatching(
      (sel) =>
        sel.includes(".select:not([multiple]):not([size]):dir(rtl)") &&
        !sel.includes(".control-compact"),
    );
    expect(
      rtlStandard.some((r) =>
        r.decls.some(
          (d) =>
            d.prop === "background-position" &&
            d.value === "left 0.625rem center",
        ),
      ),
    ).toBe(true);

    const rtlCompact = rulesMatching((sel) =>
      sel.includes(".select.control-compact:not([multiple]):not([size]):dir(rtl)"),
    );
    expect(
      rtlCompact.some((r) =>
        r.decls.some(
          (d) => d.prop === "background-position" && d.value === "left 0.5rem center",
        ),
      ),
    ).toBe(true);

    const forcedRules = rulesMatching((sel) =>
      sel.includes(".select:not([multiple]):not([size])"),
    );
    expect(
      forcedRules.some((r) =>
        r.decls.some(
          (d) =>
            d.prop === "appearance" &&
            d.value === "auto" &&
            mediaConditions(d).includes("(forced-colors: active)"),
        ),
      ),
    ).toBe(true);
  });

  it("applies semantic red border/ring for aria-invalid selects and sculpted card styling for .popover-surface", () => {
    const invalidRules = rulesMatching((sel) =>
      sel.includes('.select[aria-invalid="true"]'),
    );
    expect(invalidRules.length).toBeGreaterThan(0);
    expect(
      invalidRules.some((r) =>
        r.decls.some(
          (d) => d.prop === "border-color" && d.value === "var(--color-red-500)",
        ),
      ),
    ).toBe(true);

    const popoverRules = rulesMatching((sel) => sel === ".popover-surface");
    expect(popoverRules).toHaveLength(1);
    const props = new Set(popoverRules[0]!.decls.map((d) => d.prop));
    expect(props.has("border-radius")).toBe(true);
    expect(props.has("background-color")).toBe(true);
    expect(props.has("box-shadow")).toBe(true);
  });

  it("ensures every production <select> across src/app uses .select rather than .input", () => {
    const appDir = fileURLToPath(new URL("../app", import.meta.url));
    const violations: string[] = [];

    for (const file of walkTsx(appDir)) {
      const content = readFileSync(file, "utf8");
      if (!content.includes("<select")) continue;
      const sf = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const localStrings = new Map<string, string>();
      const collectConsts = (node: ts.Node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          ts.isStringLiteralLike(node.initializer)
        ) {
          localStrings.set(node.name.text, node.initializer.text);
        }
        ts.forEachChild(node, collectConsts);
      };
      collectConsts(sf);

      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(sf) === "select"
        ) {
          const classAttr = node.attributes.properties.find(
            (prop): prop is ts.JsxAttribute =>
              ts.isJsxAttribute(prop) && prop.name.getText(sf) === "className",
          );
          let resolved = "";
          if (classAttr?.initializer) {
            if (ts.isStringLiteral(classAttr.initializer)) {
              resolved = classAttr.initializer.text;
            } else if (
              ts.isJsxExpression(classAttr.initializer) &&
              classAttr.initializer.expression
            ) {
              const expr = classAttr.initializer.expression;
              if (ts.isIdentifier(expr) && localStrings.has(expr.text)) {
                resolved = localStrings.get(expr.text)!;
              } else {
                resolved = expr.getText(sf);
              }
            }
          }
          if (!/\bselect\b/.test(resolved)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            violations.push(
              `${path.relative(appDir, file).replace(/\\/g, "/")}:${line + 1} (${resolved || "missing className"})`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    expect(violations).toEqual([]);
  });
});
