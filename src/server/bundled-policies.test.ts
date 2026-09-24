import { describe, expect, it } from "vitest";
import { BUNDLED_POLICIES, POLICY_VERSION } from "../../prisma/policies";
import { localizedPolicy } from "./policy";
import { shCount } from "../lib/service-hours";

describe("bundled policy publication boundaries", () => {
  it("keeps both policy example tables consistent with the actual session calculator", () => {
    for (const locale of ["en", "zh"]) {
      const policy = BUNDLED_POLICIES.find(
        (p) => p.slug === "tutor-policy" && p.locale === locale,
      )!;
      const examples = [...policy.body.matchAll(/^\| (\d+) \| ([\d.]+) \|$/gm)];
      expect(examples).toHaveLength(8);
      for (const example of examples) {
        expect(shCount(Number(example[1]), 1)).toBe(Number(example[2]));
        expect(shCount(Number(example[1]), 3)).toBe(Number(example[2]) * 3);
      }
    }
  });
  it("loads matching English and Chinese drafts with their source revision", () => {
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

  it("discloses draft status and the approval requirement before participation instructions", () => {
    for (const policy of BUNDLED_POLICIES) {
      const introduction = policy.body.split("\n## ")[0]!;
      if (policy.locale === "en") {
        expect(policy.title).toMatch(/^SHBS Peer Tutoring .* Policy$/);
        expect(introduction).toContain("Draft for school review");
        expect(introduction).toContain(
          "only after school approval and publication",
        );
      } else {
        expect(policy.title).toMatch(/^SHBS 同伴辅导项目.*政策$/);
        expect(introduction).toContain("待校方审核草案");
        expect(introduction).toContain("本草案须经校方批准");
        expect(introduction).toContain("正式发布后，方可生效");
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
    expect((await localizedPolicy(client, "tutor-policy", "de"))?.body).toBe(
      BUNDLED_POLICIES.find(
        (p) => p.slug === "tutor-policy" && p.locale === "en",
      )!.body,
    );
    expect(calls).toEqual(["de", "en"]);
    calls.length = 0;
    expect((await localizedPolicy(client, "tutor-policy", "zh"))?.title).toBe(
      "SHBS 同伴辅导项目辅导伙伴政策",
    );
    expect(calls).toEqual(["zh"]);
  });
});
