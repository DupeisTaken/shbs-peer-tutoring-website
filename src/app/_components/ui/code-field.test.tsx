// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { parse, type AnyNode, type Rule } from "postcss";
import { compile } from "tailwindcss";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { CodeDisplay, CodeInput } from "./code-field";

afterEach(cleanup);
function mount(
  purpose: "invitation" | "email",
  props: Partial<React.ComponentProps<typeof CodeInput>> = {},
  locale: "en" | "zh" = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <CodeInput purpose={purpose} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("purpose-specific code entry", () => {
  it.each([
    ["invitation", 5],
    ["email", 4],
  ] as const)(
    "keeps one legacy %s box with its placeholder count and preserves zeros",
    (purpose, count) => {
      const { container } = mount(purpose);
      const input = screen.getByRole<HTMLInputElement>("textbox");
      expect(container.querySelectorAll("input")).toHaveLength(1);
      expect(container.querySelector(".code-positions")).toBeNull();
      expect(input.placeholder).toBe("X".repeat(count));
      expect(input.getAttribute("inputmode")).toBe(
        purpose === "invitation" ? "text" : "numeric",
      );
      expect(input.autocomplete).toBe("one-time-code");
      expect(input.getAttribute("aria-describedby")).toBeTruthy();
      fireEvent.change(input, { target: { value: "01" } });
      expect(input.value).toBe("01");
      expect(input.placeholder).toBe("X".repeat(count));
      expect(input.validity.valid).toBe(false);
      fireEvent.change(input, { target: { value: "0".repeat(count) } });
      expect(input.value).toBe("0".repeat(count));
      expect(input.validity.valid).toBe(true);
    },
  );

  it("supports full-code paste, selected correction and deletion without losing zeros", () => {
    mount("invitation");
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const paste = (text: string) =>
      fireEvent.paste(input, { clipboardData: { getData: () => text } });
    paste("00-123");
    expect(input.value).toBe("00123");
    input.setSelectionRange(2, 4);
    paste("90");
    expect(input.value).toBe("00903");
    fireEvent.change(input, { target: { value: "0090" } });
    expect(input.value).toBe("0090");
    expect(input.placeholder).toBe("XXXXX");
  });

  it.each(["A1B2C", "A1B2C3D4E5F6"])(
    "keeps outstanding invitation %s intact through paste and correction",
    (legacy) => {
      mount("invitation");
      const input = screen.getByRole<HTMLInputElement>("textbox");
      fireEvent.paste(input, { clipboardData: { getData: () => legacy } });
      expect(input.value).toBe(legacy);
      expect(input.validity.valid).toBe(true);
      fireEvent.change(input, { target: { value: legacy.slice(0, 5) } });
      expect(input.value).toBe("A1B2C");
    },
  );

  it.each(["0123", "AB123", "A1B2C3", "A1B2C3D4E5F6"])(
    "accepts newly issued and outstanding emailed code %s",
    (code) => {
      mount("email");
      const input = screen.getByRole<HTMLInputElement>("textbox");
      fireEvent.change(input, { target: { value: code } });
      expect(input.value).toBe(code);
      expect(input.validity.valid).toBe(true);
    },
  );

  it("rejects invalid lengths and letters in a new four-position code", () => {
    mount("email");
    const input = screen.getByRole<HTMLInputElement>("textbox");
    for (const code of ["123", "ABCD", "1234567"]) {
      fireEvent.change(input, { target: { value: code } });
      expect(input.checkValidity()).toBe(false);
    }
  });

  it("uses a text keyboard for mixed invitations without extra visible controls", () => {
    mount("invitation");
    const input = screen.getByRole<HTMLInputElement>("textbox");
    expect(input.inputMode).toBe("text");
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.change(input, { target: { value: "A1B2C" } });
    expect(input.value).toBe("A1B2C");
    expect(input.value).toBe("A1B2C");
  });

  it("keeps pasted outstanding email letters editable and guidance accessible", () => {
    mount("email");
    const input = screen.getByRole<HTMLInputElement>("textbox");
    expect(input.inputMode).toBe("numeric");
    fireEvent.paste(input, {
      clipboardData: { getData: () => "A1-B2-C3" },
    });
    expect(input.value).toBe("A1B2C3");
    expect(input.inputMode).toBe("text");
    expect(input.checkValidity()).toBe(true);
    const help = document.getElementById(
      input.getAttribute("aria-describedby")!,
    );
    expect(help?.textContent).toBe(en.codes.emailHelp);
    expect(help?.classList.contains("sr-only")).toBe(true);
  });

  it("retains the draft and focus target when pending or errors change", () => {
    const onValueChange = vi.fn();
    const view = mount("email", { value: "0123", onValueChange });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    input.focus();
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <CodeInput
          purpose="email"
          value="0123"
          disabled
          aria-invalid="true"
          aria-describedby="challenge-error"
          onValueChange={onValueChange}
        />
        <p id="challenge-error" role="alert">
          Incorrect code. Retry.
        </p>
      </NextIntlClientProvider>,
    );
    expect(input.value).toBe("0123");
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("challenge-error");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("uses translated purpose labels and exports the complete code as text", () => {
    mount("email", {}, "zh");
    expect(screen.getByLabelText(new RegExp(zh.codes.emailLabel))).toBeTruthy();
    cleanup();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CodeDisplay code="A2B3C" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("A2B3C").textContent).toBe("A2B3C");
    expect(screen.getByText(en.codes.invitationLabel)).toBeTruthy();
    expect(screen.queryByText(en.codes.invitationHelp)).toBeNull();
  });
});

/** The installed palette is OKLCH; purpose backgrounds are opaque hex colors.
 * Convert both to linear sRGB before applying WCAG relative-luminance weights. */
function luminance(color: string) {
  const rawHex = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(color)?.[1];
  const hex =
    rawHex?.length === 3
      ? [...rawHex].map((channel) => channel.repeat(2)).join("")
      : rawHex;
  let linear: number[];
  if (hex) {
    linear = [0, 2, 4].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  } else {
    const match = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(color);
    if (!match)
      throw new Error(`Expected opaque hex or OKLCH, received ${color}`);
    const lightness = Number(match[1]) / 100;
    const chroma = Number(match[2]);
    const angle = (Number(match[3]) * Math.PI) / 180;
    const a = chroma * Math.cos(angle);
    const b = chroma * Math.sin(angle);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }
  // These neutral colors are in gamut; fail rather than silently clip a new one.
  expect(linear.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
  return linear.reduce(
    (sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!,
    0,
  );
}

describe("purpose-specific code display contrast", () => {
  let compiler: Awaited<ReturnType<typeof compile>>;
  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const stylesheet = parse(
      readFileSync(require.resolve("../../../styles/globals.css"), "utf8"),
    );
    const fragments = stylesheet.nodes.filter(
      (node) =>
        (node.type === "atrule" && node.name === "theme") ||
        (node.type === "rule" &&
          (node.selectors.includes(".code-display") ||
            node.selectors.some((selector) =>
              selector.startsWith("[data-code-purpose="),
            ))),
    );
    const theme = readFileSync(
      require.resolve("tailwindcss/theme.css"),
      "utf8",
    );
    compiler = await compile(
      `${theme}\n${fragments.join("\n")}\n@tailwind utilities;`,
    );
  });

  it.each([
    ["en", "invitation"],
    ["zh", "invitation"],
    ["en", "email"],
    ["zh", "email"],
  ] as const)(
    "keeps the %s %s label above 4.5:1 on its purpose background",
    (locale, purpose) => {
      const messages = locale === "en" ? en : zh;
      const code = purpose === "email" ? "0123" : "A1B2C3D4E5F6";
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <CodeDisplay purpose={purpose} code={code} />
        </NextIntlClientProvider>,
      );
      const label = screen.getByText(messages.codes[`${purpose}Label`]);
      const surface = label.parentElement!;
      expect(surface.getAttribute("data-code-purpose")).toBe(purpose);
      const output = parse(
        compiler.build([...label.classList, ...surface.classList]),
      );
      const variables: Record<string, string> = {};
      output.walkDecls(/^--color-/, (declaration) => {
        variables[declaration.prop] = declaration.value;
      });
      function declarations(element: Element) {
        const values: Record<string, string> = {};
        output.walkRules((rule) => {
          if (
            rule.parent?.type !== "root" ||
            rule.selector.includes(":host") ||
            !element.matches(rule.selector)
          )
            return;
          for (const node of rule.nodes) {
            if (node.type === "decl") values[node.prop] = node.value;
          }
        });
        return values;
      }
      const background = declarations(surface);
      const foreground = declarations(label);
      const values = { ...variables, ...background, ...foreground };
      function resolvedColor(value: string | undefined) {
        expect(value).toBeDefined();
        const variable = /^var\((--[\w-]+)\)$/.exec(value!)?.[1];
        const color = variable ? values[variable] : value;
        expect(color).toBeDefined();
        return color!;
      }
      // Compile the actual rendered leaf classes and production purpose rules.
      // This checks color contrast, not class spelling; native paint remains a gate.
      const labelLuminance = luminance(resolvedColor(foreground.color));
      const backgroundLuminance = luminance(
        resolvedColor(
          foreground["background-color"] ?? background["background-color"],
        ),
      );
      expect(
        (Math.max(labelLuminance, backgroundLuminance) + 0.05) /
          (Math.min(labelLuminance, backgroundLuminance) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
      expect(screen.getByText(code).textContent).toBe(code);
    },
  );
});

type PlaceholderCase = {
  name: string;
  tag: "input" | "textarea";
  purpose?: "invitation" | "email";
  fontSize: number;
};
const placeholderCases: PlaceholderCase[] = [
  { name: "ordinary input", tag: "input", fontSize: 14 },
  { name: "ordinary textarea", tag: "textarea", fontSize: 14 },
  {
    name: "invitation code",
    tag: "input",
    purpose: "invitation",
    fontSize: 24,
  },
  { name: "email code", tag: "input", purpose: "email", fontSize: 24 },
];

function placeholderControl(row: PlaceholderCase) {
  if (row.purpose) mount(row.purpose);
  else {
    render(
      <label>
        Ordinary field
        {row.tag === "textarea" ? (
          <textarea className="textarea" placeholder="Example text" />
        ) : (
          <input className="input" placeholder="Example text" />
        )}
      </label>,
    );
  }
  const control = screen.getByRole<HTMLInputElement | HTMLTextAreaElement>(
    "textbox",
  );
  expect(control.value).toBe("");
  expect(control.disabled).toBe(false);
  return control;
}

function emittedSelectors(rule: Rule): string[] {
  if (rule.parent?.type !== "rule") return rule.selectors;
  return emittedSelectors(rule.parent).flatMap((parent) =>
    rule.selectors.map((selector) => selector.replaceAll("&", parent)),
  );
}

/** Resolve the selected production rules at rest, including their actual layers.
 * Purpose backgrounds are unlayered; placeholder color belongs to its pseudo leaf. */
function emittedDeclarations(
  output: ReturnType<typeof parse>,
  element: Element,
  pseudo = "",
) {
  const matches: { layer: number; values: Record<string, string> }[] = [];
  output.walkRules((rule) => {
    let layer = 2;
    for (
      let parent: AnyNode | undefined = rule.parent;
      parent;
      parent = parent.parent
    ) {
      if (parent.type !== "atrule") continue;
      if (parent.name !== "layer") return;
      layer = parent.params === "utilities" ? 1 : 0;
    }
    const applies = emittedSelectors(rule).some((selector) => {
      if (selector.includes(":host")) return false;
      if (pseudo) {
        return (
          selector.endsWith(pseudo) &&
          element.matches(selector.slice(0, -pseudo.length))
        );
      }
      return !selector.includes("::") && element.matches(selector);
    });
    if (!applies) return;
    const values: Record<string, string> = {};
    for (const node of rule.nodes) {
      if (node.type === "decl") values[node.prop] = node.value;
    }
    matches.push({ layer, values });
  });
  const declarations: Record<string, string> = {};
  for (const match of matches.sort((left, right) => left.layer - right.layer)) {
    Object.assign(declarations, match.values);
  }
  return declarations;
}

function placeholderContrast(
  compiler: Awaited<ReturnType<typeof compile>>,
  control: HTMLInputElement | HTMLTextAreaElement,
) {
  const output = parse(compiler.build([...control.classList]));
  const variables: Record<string, string> = {};
  output.walkDecls(/^--(?:color|text)-/, (declaration) => {
    variables[declaration.prop] = declaration.value;
  });
  // Inherit only matching ancestor declarations: the other purpose must not win.
  const ancestors: Element[] = [];
  for (
    let parent = control.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    ancestors.unshift(parent);
  }
  for (const ancestor of ancestors) {
    for (const [property, value] of Object.entries(
      emittedDeclarations(output, ancestor),
    )) {
      if (property.startsWith("--")) variables[property] = value;
    }
  }
  const normal = emittedDeclarations(output, control);
  const placeholder = emittedDeclarations(output, control, "::placeholder");
  Object.assign(variables, normal, placeholder);
  function resolved(value: string | undefined): string {
    expect(value).toBeDefined();
    for (let depth = 0; depth < 10; depth += 1) {
      const variable = /^var\((--[\w-]+)\)$/.exec(value!)?.[1];
      if (!variable) return value!;
      value = variables[variable];
      expect(value).toBeDefined();
    }
    throw new Error("Unexpected cyclic style variable");
  }
  const size = resolved(normal["font-size"]);
  expect(size).toMatch(/^[\d.]+rem$/);
  const fontSize = Number.parseFloat(size) * 16;
  const foreground = luminance(resolved(placeholder.color));
  const background = luminance(resolved(normal["background-color"]));
  return {
    fontSize,
    minimum: fontSize >= 24 ? 3 : 4.5,
    ratio:
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05),
  };
}

describe("shared enabled placeholder contrast", () => {
  let current: Awaited<ReturnType<typeof compile>>;
  let legacy: Awaited<ReturnType<typeof compile>>;
  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const stylesheet = parse(
      readFileSync(require.resolve("../../../styles/globals.css"), "utf8"),
    );
    const shared: Rule[] = [];
    stylesheet.walkRules((rule) => {
      if (rule.selectors.includes(".input")) shared.push(rule);
    });
    expect(shared).toHaveLength(1);
    const fragments = stylesheet.nodes.filter(
      (node) =>
        (node.type === "atrule" && node.name === "theme") ||
        (node.type === "rule" &&
          (node.selectors.includes(".code-native") ||
            node.selectors.some((selector) =>
              selector.startsWith("[data-code-purpose="),
            ))),
    );
    const theme = readFileSync(
      require.resolve("tailwindcss/theme.css"),
      "utf8",
    );
    const previous = shared[0]!.clone();
    let replacements = 0;
    previous.walkAtRules("apply", (rule) => {
      rule.params = rule.params.replace(
        /placeholder:text-slate-\d{3}\b/g,
        () => {
          replacements += 1;
          return "placeholder:text-slate-400";
        },
      );
    });
    expect(replacements).toBe(1);
    const compileShared = (rule: Rule) =>
      compile(
        `${theme}\n${fragments.join("\n")}\n@layer components {${rule.toString()}}\n@layer utilities {@tailwind utilities;}`,
      );
    current = await compileShared(shared[0]!);
    legacy = await compileShared(previous);
  });

  it.each(placeholderCases)(
    "keeps the $name placeholder readable on its actual surface",
    (row) => {
      const measurement = placeholderContrast(current, placeholderControl(row));
      expect(measurement.fontSize).toBe(row.fontSize);
      expect(measurement.ratio).toBeGreaterThanOrEqual(measurement.minimum);
    },
  );

  it.each(placeholderCases)(
    "rejects the former shared token for the $name placeholder",
    (row) => {
      const measurement = placeholderContrast(legacy, placeholderControl(row));
      expect(measurement.fontSize).toBe(row.fontSize);
      expect(measurement.ratio).toBeLessThan(measurement.minimum);
    },
  );
});
