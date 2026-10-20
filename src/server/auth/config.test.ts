import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { authConfig } from "./config";

it("allows signed-out mailbox recovery without opening adjacent protected routes", () => {
  for (const [pathname, allowed] of [
    ["/unsubscribe?token=signed-link", true],
    ["/request-appeal?token=signed-link", true],
    // Modern mailbox appeals carry their own authority in the fragment. A login
    // redirect cannot preserve that fragment in its server-generated callback.
    ["/tutee-signup/appeal", true],
    ["/tutee-signup/appeal#token=synthetic-proof", true],
    ["/tutee-signup/appeal/admin", false],
    ["/tutee-signup/appeal-private", false],
    ["/request-appeal/admin", false],
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
