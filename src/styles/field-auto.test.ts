import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "postcss";
import { compile } from "tailwindcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Check emitted CSS and actual JSX consumers. jsdom has no layout engine;
 * enlarged real-browser width/screenshot checks remain an independent gate. */
function controls(relative: string) {
  const tree = ts.createSourceFile(
    relative,
    source(relative),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: { classes: string[]; wrapper: string[] }[] = [];
  const classes = (attributes: ts.JsxAttributes) => {
    const attribute = attributes.properties.find(
      (entry): entry is ts.JsxAttribute =>
        ts.isJsxAttribute(entry) && entry.name.getText(tree) === "className",
    );
    return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
      ? attribute.initializer.text.split(/\s+/)
      : [];
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const own = classes(node.attributes);
      if (own.includes("field-auto") || own.includes("field-auto-bounded")) {
        const parent = ts.isJsxOpeningElement(node)
          ? node.parent.parent
          : node.parent;
        found.push({
          classes: own,
          wrapper: ts.isJsxElement(parent)
            ? classes(parent.openingElement.attributes)
            : [],
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

async function compiledControls() {
  const stylesheet = parse(source("./globals.css"));
  const utilities = stylesheet.nodes.filter(
    (node) =>
      node.type === "atrule" &&
      node.name === "utility" &&
      ["field-auto", "field-auto-bounded"].includes(node.params),
  );
  expect(utilities).toHaveLength(2);
  const compiler = await compile(
    `${utilities.map((utility) => utility.toString()).join("\n")}\n@tailwind utilities;`,
  );
  return parse(
    compiler.build([
      "field-auto",
      "min-w-[12rem]",
      "field-auto-bounded",
      "[--field-min-width:12rem]",
    ]),
  );
}

function declarationsFor(output: ReturnType<typeof parse>, selector: string) {
  const declarations: Record<string, string> = {};
  output.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
  });
  return declarations;
}

describe("content-sized controls in wrapping forms", () => {
  it("emits a container-bounded preferred minimum without losing content sizing", async () => {
    const output = await compiledControls();
    expect(declarationsFor(output, ".field-auto-bounded")).toMatchObject({
      "field-sizing": "content",
      "min-width": "min(100%, var(--field-min-width, 0px))",
      "max-width": "100%",
      width: "auto",
    });
    let preferredMinimum: string | undefined;
    output.walkDecls("--field-min-width", (declaration) => {
      preferredMinimum = declaration.value;
    });
    expect(preferredMinimum).toBe("12rem");
  });

  it("leaves existing field-auto minima independent of custom-property validity and cascade order", async () => {
    const output = await compiledControls();
    const legacy = declarationsFor(output, ".field-auto");
    expect(legacy).toEqual({
      "field-sizing": "content",
      width: "auto",
      "max-width": "100%",
    });
    expect(declarationsFor(output, ".min-w-\\[12rem\\]")).toEqual({
      "min-width": "12rem",
    });
    // No min-width declaration on field-auto can override the caller's utility,
    // including when no --field-min-width property exists on the element.
    expect(legacy).not.toHaveProperty("min-width");
  });

  it.each([
    ["registration-codes", ["8rem", "11rem", "13rem"]],
    ["meetings", ["12rem", "9rem", "7rem"]],
  ] as const)(
    "caps every %s creation control rather than overriding the cap with a fixed minimum",
    (route, minimums) => {
      const fields = controls(`../app/(admin)/admin/${route}/page.tsx`);
      expect(fields).toHaveLength(minimums.length);
      fields.forEach((field, index) => {
        expect(field.classes).toContain(`[--field-min-width:${minimums[index]}]`);
        expect(field.classes).toContain("field-auto-bounded");
        expect(field.classes.some((value) => /(?:^|:)min-w-/.test(value))).toBe(false);
      });
      if (route === "registration-codes") {
        // A max-width on the input alone cannot constrain an intrinsic flex wrapper.
        fields.forEach((field) => {
          expect(field.wrapper).toContain("min-w-0");
          expect(field.wrapper).toContain("max-w-full");
        });
      }
    },
  );
});
