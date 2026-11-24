import { describe, expect, it } from "vitest";
import { helpArticles } from "./catalogue";
import { validatePublishedCaptureRoute } from "./capture-route";
import {
  DEMO_ACCOUNTS,
  accountForAudience,
  buildCaptureRecipes,
} from "../../../scripts/capture-help-screenshots";

describe("help screenshot capture recipes", () => {
  it("assigns unique canonical step IDs across every authored screenshot step", () => {
    const recipes = buildCaptureRecipes();
    const expectedIds = helpArticles.flatMap((article) =>
      article.steps.flatMap((step, index) =>
        step.screenshot ? [`${article.slug}-step-${index + 1}`] : [],
      ),
    );
    expect(recipes.map((recipe) => recipe.id)).toEqual(expectedIds);
    expect(new Set(recipes.map((recipe) => recipe.id)).size).toBe(
      recipes.length,
    );

    const coveredSlugs = new Set(recipes.map((recipe) => recipe.guideSlug));
    for (const article of helpArticles) {
      expect(coveredSlugs.has(article.slug), article.slug).toBe(true);
    }
  });

  it("uses valid published routes, role-appropriate demo accounts and non-public isolation", () => {
    const recipes = buildCaptureRecipes();
    for (const recipe of recipes) {
      expect(() => validatePublishedCaptureRoute(recipe.route)).not.toThrow();
      const article = helpArticles.find((item) => item.slug === recipe.guideSlug);
      expect(article, recipe.id).toBeDefined();
      if (article?.audience === "public") {
        expect(recipe.accountKey, recipe.id).toBe("guest");
        expect(recipe.role, recipe.id).toBe("PUBLIC");
      } else {
        expect(recipe.accountKey, recipe.id).not.toBe("guest");
        expect(
          DEMO_ACCOUNTS[recipe.accountKey as keyof typeof DEMO_ACCOUNTS],
          recipe.id,
        ).toBeDefined();
      }
    }
  });

  it("maps student, observer, translator, crew and tutor audiences to distinct demo roles", () => {
    expect(accountForAudience("public")).toEqual({
      accountKey: "guest",
      role: "PUBLIC",
    });
    expect(accountForAudience("student")).toEqual({
      accountKey: "student",
      role: "STUDENT",
    });
    expect(accountForAudience("observer")).toEqual({
      accountKey: "observer",
      role: "VIEWER",
    });
    expect(accountForAudience("translator")).toEqual({
      accountKey: "translator",
      role: "TRANSLATOR",
    });
    expect(accountForAudience("crew")).toEqual({
      accountKey: "crew",
      role: "CREW",
    });
    expect(accountForAudience("tutor")).toEqual({
      accountKey: "tutor",
      role: "TUTOR",
    });
    expect(accountForAudience("staff")).toEqual({
      accountKey: "head",
      role: "HEAD",
    });
  });

  it("routes multi-screenshot secondary steps to their distinct surfaces", () => {
    const byId = new Map(
      buildCaptureRecipes().map((recipe) => [recipe.id, recipe]),
    );
    expect(byId.get("use-help-catalogue-step-2")?.route).toBe(
      "/help/use-help-catalogue",
    );
    expect(byId.get("request-tutoring-step-3")?.route).toBe(
      "/register-account",
    );
    expect(byId.get("sign-in-recover-step-3")?.route).toBe("/forgot-password");
    expect(byId.get("account-security-step-2")?.route).toBe(
      "/my-account#account-twofactor",
    );
    expect(byId.get("tutee-workspace-step-2")?.route).toBe(
      "/student?view=schedule",
    );
    expect(byId.get("tutee-feedback-appeals-step-3")?.route).toBe(
      "/student?view=support",
    );
    expect(byId.get("tutor-membership-hours-step-4")?.route).toBe("/history");
  });
});
