import { expect, it } from "vitest";
import { decode, encode } from "next-auth/jwt";
import { Auth } from "@auth/core";
import { NextRequest, type NextFetchEvent } from "next/server";
import proxy from "./proxy";
import { authConfig } from "./server/auth/config";
import { withoutSessionRefreshCookies } from "./server/auth/session-recovery";

// Model the forwarded HTTP origin that Next supplies in a live request. Auth.js
// derives cookie security from these headers, not this test constructor's URL.
function pageRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  const headers = new Headers(init?.headers);
  headers.set("host", new URL(url).host);
  headers.set("x-forwarded-proto", new URL(url).protocol.slice(0, -1));
  return new NextRequest(url, { ...init, headers });
}

const event = { waitUntil: () => undefined } as unknown as NextFetchEvent;
it("consumes the API-first recovery notice on the next sign-in response", async () => {
  const response = await proxy(
    pageRequest("http://localhost:3109/signin", {
      headers: { cookie: "shbs-session-recovery=1" },
    }),
    event,
  );
  expect(response?.headers.getSetCookie()).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/shbs-session-recovery=;.*Max-Age=0/),
    ]),
  );
});
it("keeps the unauthenticated redirect and public/API authorization boundaries", async () => {
  const privateResponse = await proxy(
    pageRequest("http://localhost:3109/messages"),
    event,
  );
  expect(privateResponse?.status).toBe(307);
  expect(new URL(privateResponse!.headers.get("location")!).pathname).toBe(
    "/signin",
  );
  for (const path of ["/", "/privacy", "/signin", "/api/trpc/approval.list"]) {
    const response = await proxy(
      pageRequest(`http://localhost:3109${path}`),
      event,
    );
    expect(response?.headers.get("location")).toBeNull();
  }
});

it("does not make nested or similarly named privacy routes public", async () => {
  for (const path of ["/privacy/admin", "/privacy-settings"]) {
    const response = await proxy(pageRequest(`http://localhost:3109${path}`), event);
    expect(response?.status).toBe(307);
    expect(new URL(response!.headers.get("location")!).pathname).toBe("/signin");
  }
});

it("delivers a delayed prefetch response after real Auth.js sign-out without resurrecting the login", async () => {
  const name = "authjs.session-token";
  const secret = process.env.AUTH_SECRET!;
  const token = await encode({
    secret,
    salt: name,
    token: { sub: "head", role: "HEAD", tutorId: null },
  });
  const config = {
    ...authConfig,
    secret,
    trustHost: true,
    basePath: "/api/auth",
  };
  const lateResponse = await proxy(
    pageRequest("http://localhost:3109/admin/approvals", {
      headers: { cookie: `${name}=${token}`, "next-router-prefetch": "1" },
    }),
    event,
  );
  const csrfResponse = await Auth(
    new Request("http://localhost:3109/api/auth/csrf"),
    config,
  );
  const csrf = (await csrfResponse.json()) as { csrfToken: string };
  const csrfCookies = csrfResponse.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  const signedOut = await Auth(
    new Request("http://localhost:3109/api/auth/signout", {
      method: "POST",
      headers: {
        cookie: `${name}=${token}; ${csrfCookies}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrfToken: csrf.csrfToken }),
    }),
    config,
  );
  // Deliver cookie writes in the adverse order, like a browser receiving an old
  // prefetch after the sign-out response. No session value is logged.
  const jar = new Map([[name, token]]);
  const deliver = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const key = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (/max-age=0/i.test(cookie)) jar.delete(key);
      else jar.set(key, value);
    }
  };
  deliver(signedOut);
  expect(jar.has(name)).toBe(false);
  deliver(lateResponse!);
  expect(jar.has(name)).toBe(false);
  const newAccount = await encode({
    secret,
    salt: name,
    token: { sub: "coordinator", role: "COORDINATOR", tutorId: null },
  });
  jar.set(name, newAccount);
  deliver(lateResponse!);
  expect(jar.get(name)).toBe(newAccount);
});

it("preserves document expiry/secret rotation and Auth.js deletion of a valid but rejected token", async () => {
  const name = "authjs.session-token";
  const oldSecret = "old-rotation-key";
  const secret = process.env.AUTH_SECRET!;
  const token = await encode({
    secret: oldSecret,
    salt: name,
    token: { sub: "head", role: "HEAD", tutorId: null },
  });
  const request = new Request("http://localhost:3109/api/auth/session", {
    headers: { cookie: `${name}=${token}` },
  });
  const config = {
    ...authConfig,
    secret: [secret, oldSecret],
    trustHost: true,
    basePath: "/api/auth",
  };
  const rotated = await Auth(request, config);
  const documentRequest = pageRequest("http://localhost:3109/admin", {
    headers: { "sec-fetch-dest": "document" },
  });
  const kept = withoutSessionRefreshCookies(rotated, documentRequest)
    .headers.getSetCookie()
    .find((c) => c.startsWith(name))!;
  expect(kept).toContain("Expires=");
  const renewed = kept.split(";")[0]!.slice(name.length + 1);
  expect(await decode({ token: renewed, salt: name, secret })).toMatchObject({
    sub: "head",
  });
  const rejected = await Auth(request, {
    ...config,
    callbacks: { ...authConfig.callbacks, jwt: () => null },
  });
  expect(withoutSessionRefreshCookies(rejected).headers.getSetCookie()).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/authjs\.session-token=;.*Max-Age=0/i),
    ]),
  );
});

it("never renews an old valid cookie from a late page/prefetch response after sign-out", async () => {
  const name = "authjs.session-token";
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    salt: name,
    token: { sub: "head", role: "HEAD", tutorId: null },
  });
  for (const method of ["GET", "POST"]) {
    const response = await proxy(
      pageRequest("http://localhost:3109/admin/approvals", {
        method,
        headers: { cookie: `${name}=${token}` },
      }),
      event,
    );
    expect(response?.headers.get("location")).toBeNull();
    expect(
      response?.headers.getSetCookie().filter((c) => c.startsWith(name)),
    ).toEqual([]);
  }
});
