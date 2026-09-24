// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BrandingProvider, useBranding } from "./branding-provider";
import { DEFAULT_BRANDING, resolveBranding } from "~/lib/branding-config";

function Consumer() {
  const branding = useBranding();
  return <p>{Object.values(branding).join(" | ")}</p>;
}
afterEach(cleanup);
it("uses repository defaults in isolated components", () => {
  const { container } = render(<Consumer />);
  expect(container.textContent).toBe(
    Object.values(DEFAULT_BRANDING).join(" | "),
  );
});
it("hydrates the server's runtime values and preserves safe text escaping", async () => {
  const branding = resolveBranding({
    APP_TITLE: 'Campus <script>alert("x")</script>',
    TEAM_TITLE: "Runtime Team",
    ORG_NAME: "Runtime School",
    SUPPORT_EMAIL: "help@example.test",
    PROGRAM_TERM_LABEL: "2026–27",
  });
  const ui = (
    <BrandingProvider branding={branding}>
      <Consumer />
    </BrandingProvider>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(ui);
  document.body.append(container);
  const onRecoverableError = vi.fn();
  const root = hydrateRoot(container, ui, { onRecoverableError });
  try {
    await act(async () => undefined);
    expect(container.textContent).toBe(Object.values(branding).join(" | "));
    expect(container.querySelector("script")).toBeNull();
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
