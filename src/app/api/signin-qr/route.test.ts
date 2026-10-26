import { it, expect, vi, afterEach } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { GET } from "./route";
afterEach(() => vi.unstubAllEnvs());
it("downloads a real scannable PNG containing only the configured sign-in URL", async () => {
  vi.stubEnv("AUTH_URL", "https://tutoring.example.edu");
  const result = await GET(
    new Request("https://internal:3000/api/signin-qr?download=1&token=private"),
  );
  expect(result.headers.get("Content-Disposition")).toContain(
    'attachment; filename="student-signin.png"',
  );
  expect(result.headers.get("Content-Type")).toBe("image/png");
  const png = PNG.sync.read(Buffer.from(await result.arrayBuffer()));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toBe("https://tutoring.example.edu/signin");
});

it("preserves the existing inline interface and identical download pixels", async () => {
  vi.stubEnv("AUTH_URL", "https://tutoring.example.edu");
  const inline = await GET(new Request("https://internal:3000/api/signin-qr"));
  const download = await GET(
    new Request("https://internal:3000/api/signin-qr?download=1"),
  );
  expect(inline.headers.get("Content-Disposition")).toBe(
    'inline; filename="student-signin.png"',
  );
  expect(inline.headers.get("Cache-Control")).toBe("private, max-age=3600");
  expect(inline.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(Buffer.from(await inline.arrayBuffer())).toEqual(
    Buffer.from(await download.arrayBuffer()),
  );
});
