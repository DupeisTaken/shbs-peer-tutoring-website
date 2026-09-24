import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { BUNDLED_POLICIES } from "../../prisma/policies";
import { getHomeOverrides } from "~/server/home/content";

describe("Chinese peer roles", () => {
  it("uses the chosen glossary across the catalog and retains genuine school references", () => {
    expect(zh.admin.users.roles.TUTOR).toBe("辅导伙伴");
    expect(zh.admin.users.roles.STUDENT).toBe("学习伙伴");
    expect(zh.signupFields.tutor).toBe("辅导伙伴报名");
    expect(zh.signupFields.tutee).toBe("学习伙伴报名");
    const catalog = JSON.stringify(zh);
    expect(catalog).not.toMatch(/导师|辅导员|学员|授课|在职/);
    expect(catalog).toContain("学生家长、数学教师");
    expect(zh.workflows.schoolDay).toContain("上课日");
    expect(zh.workflows.calendarHelp).toContain("上课日");
  });

  it.each([0, 1, 2, 12])(
    "renders Chinese role plurals and names for %i participants",
    (count) => {
      const t = createTranslator({ locale: "zh", messages: zh });
      expect(t("admin.tutorRequests.affected", { count })).toBe(
        `影响 ${count} 名学习伙伴`,
      );
      expect(
        t("admin.tutorRequests.requeuePrompt", { name: "小林", count }),
      ).toBe(`将与 小林 配对的 ${count} 名学习伙伴重新加入待分配队列？`);
      expect(t("landing.intro", { appTitle: "校园互助" })).toContain(
        "校园互助",
      );
    },
  );

  it("introduces both roles as peers in English and Chinese", () => {
    expect(en.landing.intro).toContain("tutors and tutees are fellow students");
    expect(zh.landing.intro).toContain("辅导伙伴（Tutor）与学习伙伴（Tutee）");
    expect(zh.landing.intro).toContain("都是一起学习、相互支持的同学");
    expect(zh.landing.features.students.title).toBe("面向学习伙伴");
    expect(zh.landing.features.tutors.title).toBe("面向辅导伙伴");
    expect(en.landing.features.students.body).toContain("fellow students");
    expect(en.landing.features.tutors.body).toContain("peers");
  });

  it("keeps Chinese draft policy headings and referenced entry labels consistent", () => {
    for (const [slug, role] of [
      ["tutor-policy", "辅导伙伴"],
      ["tutee-policy", "学习伙伴"],
    ]) {
      const policy = BUNDLED_POLICIES.find(
        (p) => p.slug === slug && p.locale === "zh",
      )!;
      expect(policy.title).toBe(`SHBS 同伴辅导项目${role}政策`);
      // The draft may describe participants as students; role names stay peer-oriented.
      expect(policy.body).not.toMatch(/导师|辅导员|学员|授课|在职/);
      if (slug === "tutee-policy") {
        expect(policy.body).toContain(zh.components.userMenu.enterTutee);
      } else {
        expect(policy.body).toContain(zh.landing.nav.becomeTutor);
      }
    }
  });

  it("uses the same glossary in newly generated Chinese workflow notifications", () => {
    for (const file of [
      "student-workflow",
      "legacy-student-withdrawal",
      "student-survey",
    ]) {
      const source = readFileSync(
        new URL(`../server/${file}.ts`, import.meta.url),
        "utf8",
      );
      expect(source).not.toMatch(/导师|辅导员|学员|学生/);
      expect(source).toMatch(/辅导伙伴|学习伙伴/);
    }
  });
});

describe("peer introduction publication boundaries", () => {
  it("keeps stored homepage copy and leaves absent slots to the bundled defaults", async () => {
    const client = {
      homeContent: {
        findMany: async () => [
          { key: "intro", locale: "en", value: "Published English" },
          { key: "intro", locale: "zh", value: "学校已审核的介绍" },
        ],
      },
    } as unknown as Parameters<typeof getHomeOverrides>[0];
    expect(await getHomeOverrides(client, "zh")).toEqual({
      intro: "学校已审核的介绍",
    });
    expect(await getHomeOverrides(client, "en")).toEqual({
      intro: "Published English",
    });
    expect(await getHomeOverrides(client, "fr")).toEqual({});
  });

  it("seeds an About page with coherent peer introductions, role cards and actions in both languages", () => {
    // Read only the literal content declaration: importing the seed would execute database writes.
    const source = ts.createSourceFile(
      "seed.ts",
      readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    let literal = "";
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(source) === "SUBPAGES"
      )
        literal = node.initializer!.getText(source);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(literal).not.toBe("");
    const pages = runInNewContext(
      `(${literal})`,
      {},
      { timeout: 1000 },
    ) as Array<{
      slug: string;
      title: Record<string, string>;
      blocks: Array<{
        id: string;
        text?: Record<string, string>;
        columns?: Array<Array<{ text: Record<string, string> }>>;
        buttons?: Array<{ label: Record<string, string>; href: string }>;
      }>;
    }>;
    const about = pages.find((page) => page.slug === "about")!;
    expect(about.title.zh).toBe("关于同伴辅导项目");
    const intro = about.blocks.find(
      (block) => block.id === "about-intro",
    )!.text!;
    expect(intro.en).toContain("Tutors and tutees are fellow students");
    expect(intro.zh).toContain("辅导伙伴（Tutor）与学习伙伴（Tutee）");
    const cards = about.blocks.find(
      (block) => block.id === "about-cols",
    )!.columns!;
    expect(cards[0]![0]!.text.zh).toContain("面向学习伙伴");
    expect(cards[1]![0]!.text.zh).toContain("面向辅导伙伴");
    const buttons = about.blocks.find(
      (block) => block.id === "about-cta",
    )!.buttons!;
    expect(buttons.map((button) => [button.href, button.label.zh])).toEqual([
      ["/signup", "申请同伴辅导"],
      ["/tutor-signup", "成为辅导伙伴"],
    ]);
  });
});
