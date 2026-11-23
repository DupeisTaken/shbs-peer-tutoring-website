import { expect, it } from "vitest";
import { validatePublishedCaptureRoute } from "./capture-route";

it.each([
  "/admin",
  "/student?view=schedule",
  "/student?view=account",
  "/localization?view=review",
  "/my-account#academic-details",
  "/dashboard#tutor-pairings",
  "/help/request-tutoring#step-2",
  "/help/request-tutoring/screenshots/2?view=3",
  "/reports/service-hours/[private-link]",
  "/reports/service-hours/[private-link]/csv",
])("accepts canonical published page context %s", (route) => {
  expect(validatePublishedCaptureRoute(route)).toBe(route);
});

it.each([
  "/request-appeal?%74oken=opaque",
  "/request-appeal?%2574oken=opaque",
  "/request-appeal?token=[private-link]",
  "/reset-password?code=opaque",
  "/student?view=opaque",
  "/student?view=schedule&token=opaque",
  "/student?view=schedule&view=messages",
  "/student?%76iew=schedule",
  "/student?view=%73chedule",
  "/reports/service-hours/%76%31%2Eopaque%2E1%2Esignature",
  "/reports/service-hours/%2576%2532%252Eopaque",
  "/reports/service-hours/MASKED",
  "/reports/service-hours/[token]",
  "/reports/service-hours/[private-link]/opaque",
  "/register-account/opaque",
  "/admin#token=opaque",
  "/my-account#%74oken=opaque",
  "/my-account#%2574oken%253Dopaque",
  "/dashboard#v2.opaque.1.signature",
  "/dashboard#%76%32%2Eopaque%2E1%2Esignature",
  "/my-account#academic-details?token=opaque",
  "/my-account#academic-details%3Ftoken%3Dopaque",
  `/api/session-calendar/${"a".repeat(43)}`,
  "/%61pi/session-calendar/opaque",
  "/api/public-qr",
  "/%2e%2e/admin",
  "//outside.example/private",
  "/\\outside.example/private",
])(
  "rejects encoded, ambiguous or credential-bearing provenance %s",
  (route) => {
    expect(() => validatePublishedCaptureRoute(route)).toThrow(
      "Unsafe published capture route",
    );
  },
);

it("keeps rejected private values out of error messages", () => {
  const secret = "synthetic-private-value";
  try {
    validatePublishedCaptureRoute(`/reset-password?%74oken=${secret}`);
  } catch (error) {
    expect(String(error)).not.toContain(secret);
    return;
  }
  throw new Error("Expected the private route to be rejected");
});
