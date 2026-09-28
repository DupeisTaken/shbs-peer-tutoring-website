import { afterEach, expect, it, vi } from "vitest";
import { signupIngress, signupLane } from "./signup-ingress";
import { signupNetwork, signupBurst } from "./signup-admission";

afterEach(() => vi.unstubAllEnvs());
it("trusts only the explicitly enabled overwritten proxy header and normalizes networks", () => {
  vi.stubEnv("SIGNUP_TRUST_PROXY", "false");
  expect(signupNetwork(new Headers({ "x-signup-client-ip": "1.2.3.4" }))).toBe(
    "unknown",
  );
  vi.stubEnv("SIGNUP_TRUST_PROXY", "true");
  expect(
    signupNetwork(
      new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "2.3.4.5" }),
    ),
  ).toBe("unknown");
  for (const value of ["garbage", "1.2.3.4, 5.6.7.8", "fe80::1%eth0", ""])
    expect(signupNetwork(new Headers({ "x-signup-client-ip": value }))).toBe(
      "unknown",
    );
  expect(
    signupNetwork(new Headers({ "x-signup-client-ip": "::ffff:192.0.2.1" })),
  ).toBe("192.0.2.1");
  expect(
    signupNetwork(new Headers({ "x-signup-client-ip": "2001:0db8:0:0:12::1" })),
  ).toBe("2001:db8:0:0::/64");
});
it("classifies the legacy alias and reserves completion separately", () => {
  expect(signupLane("tutee.requestSignup")).toBe("mail");
  expect(signupLane("tutee.inspectSurvey")).toBe("complete");
  expect(signupLane("viewer.complete")).toBe("complete");
  expect(signupLane("account.resetPassword")).toBeNull();
});
it("rejects oversized declared and chunked bodies and batches before the handler", async () => {
  const handle = vi.fn(async () => new Response("ok"));
  const request = (path: string, body: string) =>
    new Request(`http://localhost/api/trpc/${path}`, { method: "POST", body });
  expect(
    (
      await signupIngress(
        request("tutee.submitSurvey", "x".repeat(32_769)),
        handle,
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await signupIngress(
        request(Array(21).fill("tutee.signupOptions").join(","), "{}"),
        handle,
      )
    ).status,
  ).toBe(413);
  expect(handle).not.toHaveBeenCalled();
  expect(
    (await signupIngress(request("tutee.submitSurvey", "{malformed"), handle))
      .status,
  ).toBe(200);
  expect(handle).toHaveBeenCalledTimes(1);
});
it("counts individual batched operations and leaves another lane usable", async () => {
  vi.stubEnv("SIGNUP_TRUST_PROXY", "true");
  const handle = vi.fn(async () => new Response("ok"));
  const headers = { "x-signup-client-ip": "192.0.2.22" };
  for (let i = 0; i < 12; i++)
    expect(
      (
        await signupIngress(
          new Request(
            `http://localhost/api/trpc/${Array(20).fill("viewer.start").join(",")}`,
            { headers },
          ),
          handle,
        )
      ).status,
    ).toBe(200);
  const blocked = await signupIngress(
    new Request("http://localhost/api/trpc/viewer.start", { headers }),
    handle,
  );
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("retry-after")).toBeTruthy();
  expect(
    (
      await signupIngress(
        new Request("http://localhost/api/trpc/viewer.complete", { headers }),
        handle,
      )
    ).status,
  ).toBe(200);
});
it("bounds rotating identities before durable work", () => {
  const now = Date.now() + 120_000;
  let accepted = 0;
  for (let i = 0; i < 1000; i++) {
    try {
      signupBurst("read", `rotating-${i}`, now);
      accepted++;
    } catch {
      /* expected admission rejection */
    }
  }
  expect(accepted).toBe(600);
});
