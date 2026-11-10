import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

type StoredImage = {
  id: string;
  data: Uint8Array;
  mimeType: string;
  byteSize: number;
  alt: string | null;
  createdByName: string | null;
  createdAt: Date;
};
const fixture = vi.hoisted(() => {
  const access: {
    session: { user: { id: string; name: string } } | null;
    account: {
      role: string;
      canTranslate: boolean;
      suspendedAt: Date | null;
    } | null;
  } = {
    session: {
      user: { id: "media-audit-editor", name: "Synthetic media editor" },
    },
    account: { role: "ADMIN", canTranslate: true, suspendedAt: null },
  };
  return {
    ...access,
    create: vi.fn(),
    find: vi.fn(),
    accountRead: vi.fn(),
    images: new Map<string, StoredImage>(),
  };
});
vi.mock("~/server/auth", () => ({ auth: async () => fixture.session }));
vi.mock("~/server/db", () => ({
  db: {
    user: { findUnique: fixture.accountRead },
    homeImage: { create: fixture.create, findUnique: fixture.find },
  },
}));

// Both handlers and their current-account authorization helper are real. Only
// storage/auth discovery are replaced; no server, file upload or network starts.
import { POST } from "./route";
import { GET } from "../../images/[id]/route";
import { MAX_IMAGE_BYTES } from "~/server/home/images";

const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
);
function multipart(file: File | string | null, alt?: string) {
  const form = new FormData();
  if (file !== null) form.set("file", file);
  if (alt !== undefined) form.set("alt", alt);
  return new Request("https://example.test/api/admin/home-images", {
    method: "POST",
    body: form,
  }) as NextRequest;
}
function imageFile(bytes = png, type = "image/png") {
  return new File([bytes], "synthetic-raster.png", { type });
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.session = {
    user: { id: "media-audit-editor", name: "Synthetic media editor" },
  };
  fixture.account = { role: "ADMIN", canTranslate: true, suspendedAt: null };
  fixture.images.clear();
  fixture.accountRead.mockImplementation(async () => fixture.account);
  fixture.create.mockImplementation(
    async ({ data }: { data: Omit<StoredImage, "id" | "createdAt"> }) => {
      const image = {
        ...data,
        data: new Uint8Array(data.data),
        id: "synthetic-image",
        createdAt: new Date("2026-11-09T00:00:00Z"),
      };
      fixture.images.set(image.id, image);
      return image;
    },
  );
  fixture.find.mockImplementation(
    async ({ where }: { where: { id: string } }) =>
      fixture.images.get(where.id) ?? null,
  );
});

describe("audit: real landing-image upload and immutable public serving", () => {
  it.each([
    ["anonymous", null, null],
    ["missing current account", true, null],
    [
      "demoted session",
      true,
      { role: "TUTOR", canTranslate: true, suspendedAt: null },
    ],
    [
      "manager without Translator",
      true,
      { role: "ADMIN", canTranslate: false, suspendedAt: null },
    ],
    [
      "suspended editor",
      true,
      { role: "HEAD", canTranslate: true, suspendedAt: new Date() },
    ],
  ] as const)(
    "refuses %s before reading multipart bytes",
    async (_label, signedIn, account) => {
      if (!signedIn) fixture.session = null;
      fixture.account = account;
      const request = multipart(imageFile());
      const readBody = vi.spyOn(request, "formData");
      expect((await POST(request)).status).toBe(403);
      expect(readBody).not.toHaveBeenCalled();
      expect(fixture.create).not.toHaveBeenCalled();
    },
  );

  it.each(["HEAD", "ADMIN", "COORDINATOR"])(
    "allows a current assigned %s editor",
    async (role) => {
      fixture.account = { role, canTranslate: true, suspendedAt: null };
      expect((await POST(multipart(imageFile()))).status).toBe(200);
      expect(fixture.accountRead).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "media-audit-editor" } }),
      );
    },
  );

  it("persists exact raster bytes and metadata, then serves them publicly with immutable headers", async () => {
    const response = await POST(multipart(imageFile(), "  Synthetic pixel  "));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "synthetic-image",
      url: "/api/images/synthetic-image",
      alt: "Synthetic pixel",
      byteSize: png.byteLength,
      createdAt: "2026-11-09T00:00:00.000Z",
    });
    const stored = fixture.images.get("synthetic-image")!;
    expect(stored).toMatchObject({
      mimeType: "image/png",
      byteSize: png.byteLength,
      alt: "Synthetic pixel",
      createdByName: "Synthetic media editor",
    });
    expect(stored.data).toEqual(png);

    fixture.session = null;
    fixture.accountRead.mockClear();
    const served = await GET(
      new Request(
        "https://example.test/api/images/synthetic-image",
      ) as NextRequest,
      {
        params: Promise.resolve({ id: "synthetic-image" }),
      },
    );
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(served.headers.get("Content-Length")).toBe(String(png.byteLength));
    expect(served.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(served.headers.get("ETag")).toBe('"synthetic-image"');
    expect(fixture.accountRead).not.toHaveBeenCalled();
  });

  it.each(["image/svg+xml", "text/html", "application/octet-stream"])(
    "refuses an unsupported multipart MIME %s without storing bytes",
    async (type) => {
      expect((await POST(multipart(imageFile(png, type)))).status).toBe(415);
      expect(fixture.create).not.toHaveBeenCalled();
    },
  );

  it("accepts the exact size limit and rejects one byte over before storage", async () => {
    const exact = new Uint8Array(MAX_IMAGE_BYTES);
    exact.set(png);
    expect((await POST(multipart(imageFile(exact)))).status).toBe(200);
    expect(fixture.images.get("synthetic-image")?.byteSize).toBe(
      MAX_IMAGE_BYTES,
    );
    fixture.create.mockClear();
    expect(
      (await POST(multipart(imageFile(new Uint8Array(MAX_IMAGE_BYTES + 1)))))
        .status,
    ).toBe(413);
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("refuses an empty allowed-type file and missing or non-file fields", async () => {
    expect((await POST(multipart(imageFile(new Uint8Array())))).status).toBe(
      400,
    );
    expect((await POST(multipart(null))).status).toBe(400);
    expect((await POST(multipart("not a file"))).status).toBe(400);
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("reports malformed multipart and keeps an unknown image uncached", async () => {
    expect(
      (
        await POST(
          new Request("https://example.test/api/admin/home-images", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: "not multipart",
          }) as NextRequest,
        )
      ).status,
    ).toBe(400);
    const missing = await GET(
      new Request("https://example.test/api/images/missing") as NextRequest,
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBeNull();
    expect(fixture.create).not.toHaveBeenCalled();
  });
});
