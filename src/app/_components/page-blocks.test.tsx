// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageBlocks } from "./page-blocks";
import type { Block } from "~/lib/page-blocks";

afterEach(cleanup);

function language(element: Element) {
  return element.closest("[lang]")?.getAttribute("lang");
}

it("marks each rich-text field independently in a Chinese interface, including column leaves", () => {
  const blocks: Block[] = [
    { id: "en", type: "RICH_TEXT", text: { en: "English body" } },
    {
      id: "zh",
      type: "RICH_TEXT",
      text: { en: "Unselected English", zh: "中文正文" },
    },
    {
      id: "columns",
      type: "COLUMNS",
      columns: [
        [
          {
            id: "column-en",
            type: "RICH_TEXT",
            text: { en: "English column" },
          },
          { id: "column-zh", type: "RICH_TEXT", text: { zh: "中文分栏" } },
          {
            id: "column-first",
            type: "RICH_TEXT",
            text: { fr: "Colonne française" },
          },
        ],
      ],
    },
    {
      id: "empty",
      type: "RICH_TEXT",
      text: { zh: "", en: "Suppressed English" },
    },
  ];
  render(
    <div lang="zh">
      <PageBlocks blocks={blocks} locale="zh" />
      <p>界面文字</p>
    </div>,
  );
  for (const [text, locale] of [
    ["English body", "en"],
    ["中文正文", "zh"],
    ["English column", "en"],
    ["中文分栏", "zh"],
    ["Colonne française", "fr"],
    ["界面文字", "zh"],
  ]) {
    expect(language(screen.getByText(text!))).toBe(locale);
  }
  expect(screen.queryByText("Suppressed English")).toBeNull();
  expect(screen.queryByText("Unselected English")).toBeNull();
});

it("uses each image caption/alt and button label's own language at both block levels", () => {
  const leaves: Block[] = [
    {
      id: "image-en",
      type: "IMAGE",
      imageId: "synthetic-en",
      caption: { en: "English image" },
    },
    {
      id: "image-zh",
      type: "IMAGE",
      imageId: "synthetic-zh",
      caption: { en: "English", zh: "中文图片" },
    },
    {
      id: "decorative",
      type: "IMAGE",
      imageId: "synthetic-decoration",
      caption: { zh: "", en: "Suppressed caption" },
    },
    {
      id: "buttons",
      type: "BUTTONS",
      buttons: [
        {
          label: { en: "Request help" },
          href: "/tutee-signup?source=synthetic#form",
          style: "primary",
        },
        {
          label: { zh: "学校网站" },
          href: "https://school.example.test/",
          style: "secondary",
        },
      ],
    },
  ];
  const columnLeaves = leaves.filter(
    (block) => block.type === "IMAGE" || block.type === "BUTTONS",
  );
  render(
    <div lang="zh">
      <PageBlocks
        blocks={[
          ...leaves,
          { id: "columns", type: "COLUMNS", columns: [columnLeaves] },
        ]}
        locale="zh"
      />
    </div>,
  );
  for (const [name, locale] of [
    ["English image", "en"],
    ["中文图片", "zh"],
  ] as const) {
    const images = screen.getAllByRole("img", { name });
    const captions = screen.getAllByText(name);
    expect(images).toHaveLength(2);
    expect(captions).toHaveLength(2);
    for (const image of images) expect(language(image)).toBe(locale);
    for (const caption of captions) {
      expect(caption.tagName).toBe("FIGCAPTION");
      expect(language(caption)).toBe(locale);
    }
  }
  const decorativeImages = screen.getAllByAltText("");
  expect(decorativeImages).toHaveLength(2);
  for (const image of decorativeImages) {
    expect(image.closest("figure")?.hasAttribute("lang")).toBe(false);
    expect(language(image)).toBe("zh");
  }
  const requestLinks = screen.getAllByRole("link", { name: "Request help" });
  expect(requestLinks).toHaveLength(2);
  for (const link of requestLinks) {
    expect(link.getAttribute("lang")).toBe("en");
    expect(link.getAttribute("href")).toBe("/tutee?source=synthetic#form");
  }
  const schoolLinks = screen.getAllByRole("link", { name: "学校网站" });
  expect(schoolLinks).toHaveLength(2);
  for (const link of schoolLinks) {
    expect(link.getAttribute("lang")).toBe("zh");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }
});

it("preserves Markdown heading, link and sanitation behavior under a fallback language", () => {
  const { container } = render(
    <PageBlocks
      locale="zh"
      blocks={[
        {
          id: "markdown",
          type: "RICH_TEXT",
          text: {
            en: "# English heading\n\n[Request help](/tutee-signup?source=synthetic#form)\n\n<script>window.synthetic = true</script>\n\n[Unsafe](javascript:alert(1))",
          },
        },
      ]}
    />,
  );
  expect(
    language(
      screen.getByRole("heading", { level: 2, name: "English heading" }),
    ),
  ).toBe("en");
  expect(
    screen.getByRole("link", { name: "Request help" }).getAttribute("href"),
  ).toBe("/tutee?source=synthetic#form");
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});
