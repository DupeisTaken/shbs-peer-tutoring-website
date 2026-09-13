import { describe, expect, it } from "vitest";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { recoverInvalidSession } from "./session-recovery";

const secret = "isolated-session-recovery-test-secret-2026";
const cookieName = "authjs.session-token";
const request = (cookie: string, path = "/messages") =>
  new NextRequest(`http://localhost:3109${path}`, { headers: { cookie } });
const token = (key = secret, salt = cookieName, maxAge = 3600) =>
  encode({
    secret: key,
    salt,
    maxAge,
    token: { sub: "test-user", role: "HEAD", tutorId: null },
  });

describe("session recovery at the HTTP boundary", () => {
  it("leaves anonymous and valid sessions to the normal authorization checks", async () => {
    expect(
      await recoverInvalidSession(request("theme=dark"), undefined),
    ).toBeNull();
    expect(
      await recoverInvalidSession(
        request(`${cookieName}=${await token()}`),
        secret,
      ),
    ).toBeNull();
  });

  it.each([
    "/",
    "/admin/approvals",
    "/student",
    "/messages",
    "/signin?callbackUrl=https://evil.example",
  ])(
    "clears a previous-secret cookie and offers local sign-in on %s",
    async (path) => {
      const response = await recoverInvalidSession(
        request(`${cookieName}=${await token("old-secret")}; theme=dark`, path),
        secret,
      );
      expect(response?.headers.get("location")).toBe(
        "http://localhost:3109/signin?reason=session-expired",
      );
      expect(response?.cookies.get(cookieName)?.maxAge).toBe(0);
      expect(response?.cookies.get("theme")).toBeUndefined();
    },
  );

  it("expires malformed and expired cookies without accepting the payload", async () => {
    for (const value of ["invalid", await token(secret, cookieName, -60)]) {
      const response = await recoverInvalidSession(
        request(`${cookieName}=${value}`),
        secret,
      );
      expect(response?.cookies.get(cookieName)?.maxAge).toBe(0);
    }
  });

  it("supports valid chunks, secure-cookie salt and configured secret rotation", async () => {
    const name = `__Secure-${cookieName}`;
    const value = await token("previous-rotation-secret", name);
    const chunks = `${name}.1=${value.slice(90)}; ${name}.0=${value.slice(0, 90)}`;
    expect(
      await recoverInvalidSession(request(chunks), [
        secret,
        "previous-rotation-secret",
      ]),
    ).toBeNull();
    const response = await recoverInvalidSession(request(chunks), secret);
    expect(response?.cookies.get(`${name}.0`)).toMatchObject({
      maxAge: 0,
      secure: true,
      httpOnly: true,
    });
    expect(response?.cookies.get(`${name}.1`)?.maxAge).toBe(0);
  });

  it("removes only rejected cookies from API requests and lets handlers enforce authorization", async () => {
    const response = await recoverInvalidSession(
      request(
        `${cookieName}.0=bad; ${cookieName}.1=token; theme=dark; authjs.csrf-token=csrf`,
        "/api/auth/session",
      ),
      secret,
    );
    expect(response?.headers.get("location")).toBeNull();
    expect(response?.headers.get("x-middleware-request-cookie")).toBe(
      "theme=dark; authjs.csrf-token=csrf",
    );
    expect(response?.cookies.getAll()).toHaveLength(3);
    expect(response?.cookies.get("shbs-session-recovery")).toMatchObject({
      value: "1",
      maxAge: 60,
      httpOnly: true,
    });
  });

  it("does not treat missing secret configuration as an expired user session", async () => {
    await expect(
      recoverInvalidSession(request(`${cookieName}=invalid`), undefined),
    ).rejects.toThrow("stable AUTH_SECRET");
    await expect(
      recoverInvalidSession(request(`${cookieName}=invalid`), []),
    ).rejects.toThrow("stable AUTH_SECRET");
  });
});
