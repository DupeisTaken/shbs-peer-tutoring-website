import { expect, it } from "vitest";
import { shortSignupHref } from "./public-signup-links";

it.each([
  ["/register-account?code=AB3D7#entry", "/register?code=AB3D7#entry"],
  ["/signup", "/tutee"],
  ["/tutee-signup", "/tutee"],
  ["/signup/account?token=abc%2B123", "/tutee/account?token=abc%2B123"],
  ["/tutee-signup/account?token=abc", "/tutee/account?token=abc"],
  ["/tutor-signup", "/tutor"],
  ["/viewer-signup", "/viewer"],
  ["/crew-signup?source=welcome#apply", "/crew?source=welcome#apply"],
])(
  "publishes the short form of %s while preserving its parameters",
  (href, expected) => {
    expect(shortSignupHref(href)).toBe(expected);
  },
);

it.each([
  "https://example.test/signup",
  "//example.test/signup",
  "/signup/admin",
  "/tutee",
  "/crew",
  "/crew-signup/admin",
  "/admin/tutee-requests",
  "mailto:team@example.test",
])("leaves unrelated destination %s intact", (href) => {
  expect(shortSignupHref(href)).toBe(href);
});
