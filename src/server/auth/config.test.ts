import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { authConfig } from "./config";

it("allows signed-out recipients onto the unsubscribe page without opening protected routes", () => {
  for (const [pathname, allowed] of [
    ["/unsubscribe?token=signed-link", true],
    ["/my-account", false],
    ["/unsubscribe/admin", false],
  ] as const) {
    expect(
      authConfig.callbacks.authorized({
        auth: null,
        request: new NextRequest(`https://pt.shbs.org.cn${pathname}`),
      }),
    ).toBe(allowed);
  }
});
