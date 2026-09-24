import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING, resolveBranding } from "./branding-config";

describe("public branding projection", () => {
  it("retains repository defaults without environment configuration", () => {
    expect(resolveBranding({})).toEqual(DEFAULT_BRANDING);
  });
  it("treats blank overrides as unset and falls back to the effective app title", () => {
    expect(
      resolveBranding({
        APP_TITLE: "  Campus Help  ",
        TEAM_TITLE: " ",
        ORG_NAME: "",
        SUPPORT_EMAIL: "  ",
      }),
    ).toEqual({
      ...DEFAULT_BRANDING,
      APP_TITLE: "Campus Help",
      ORG_NAME: "Campus Help",
    });
  });
  it("projects all five overrides while dropping secrets and unknown fields", () => {
    const values = {
      APP_TITLE: "Campus Help",
      TEAM_TITLE: "Campus Crew",
      ORG_NAME: "School",
      SUPPORT_EMAIL: "help@example.test",
      PROGRAM_TERM_LABEL: "2026–27",
      AUTH_SECRET: "never-public",
      SMTP_PASSWORD: "never-public",
      DATABASE_URL: "never-public",
      EMAIL_FROM: "private@example.test",
      DOMAIN: "internal.example.test",
    };
    expect(resolveBranding(values)).toEqual({
      APP_TITLE: values.APP_TITLE,
      TEAM_TITLE: values.TEAM_TITLE,
      ORG_NAME: values.ORG_NAME,
      SUPPORT_EMAIL: values.SUPPORT_EMAIL,
      PROGRAM_TERM_LABEL: values.PROGRAM_TERM_LABEL,
    });
    expect(JSON.stringify(resolveBranding(values))).not.toContain(
      "never-public",
    );
  });
});
