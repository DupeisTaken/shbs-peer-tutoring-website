import { describe, expect, it } from "vitest";
import { BUNDLED_POLICIES, POLICY_VERSION } from "../../prisma/policies";
import { localizedPolicy } from "./policy";
import { shCount } from "../lib/service-hours";

describe("bundled policy publication boundaries", () => {
  it("keeps both policy example lists consistent with the actual session calculator", () => {
    for (const locale of ["en", "zh"]) {
      const policy = BUNDLED_POLICIES.find(
        (p) => p.slug === "tutor-policy" && p.locale === locale,
      )!;
      const examples = [...policy.body.matchAll(/^- (\d+) → ([\d.]+)$/gm)];
      expect(examples).toHaveLength(8);
      for (const example of examples) {
        expect(shCount(Number(example[1]), 1)).toBe(Number(example[2]));
        expect(shCount(Number(example[1]), 3)).toBe(Number(example[2]) * 3);
      }
    }
  });
  it("loads matching English and Chinese samples with their source revision", () => {
    expect(BUNDLED_POLICIES.map((p) => `${p.slug}.${p.locale}`).sort()).toEqual(
      [
        "tutee-policy.en",
        "tutee-policy.zh",
        "tutor-policy.en",
        "tutor-policy.zh",
      ],
    );
    for (const policy of BUNDLED_POLICIES) {
      expect(policy.version).toBe(POLICY_VERSION);
      expect(policy.body).toContain(POLICY_VERSION);
      expect(policy.body.startsWith(`# ${policy.title}\n`)).toBe(true);
    }
  });

  it("discloses the sample status before participation instructions in every locale", () => {
    for (const policy of BUNDLED_POLICIES) {
      const introduction = policy.body.split("\n## ")[0]!;
      if (policy.locale === "en") {
        expect(policy.title).toMatch(/^Sample .* participation policy$/);
        expect(introduction).toContain("not an approved school policy");
        expect(introduction).toContain("Adapt and approve before publication");
      } else {
        expect(policy.title).toMatch(/参与政策示例$/);
        expect(introduction).toContain("并非已经批准的校方政策");
        expect(introduction).toContain("请按学校要求调整并审核后发布");
      }
    }
  });

  it("falls back to English for a missing locale and keeps Chinese when available", async () => {
    const calls: string[] = [];
    const client = {
      policyDocument: {
        findUnique: async ({
          where,
        }: {
          where: { slug_locale: { slug: string; locale: string } };
        }) => {
          const { slug, locale } = where.slug_locale;
          calls.push(locale);
          const found = BUNDLED_POLICIES.find(
            (p) => p.slug === slug && p.locale === locale,
          );
          return found ? { title: found.title, body: found.body } : null;
        },
      },
    } as unknown as Parameters<typeof localizedPolicy>[0];
    expect(
      (await localizedPolicy(client, "tutor-policy", "de"))?.body,
    ).toContain(`Sample revision ${POLICY_VERSION}`);
    expect(calls).toEqual(["de", "en"]);
    calls.length = 0;
    expect((await localizedPolicy(client, "tutor-policy", "zh"))?.title).toBe(
      "辅导伙伴参与政策示例",
    );
    expect(calls).toEqual(["zh"]);
  });
});
