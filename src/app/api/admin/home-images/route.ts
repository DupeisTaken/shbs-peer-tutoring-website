import { type NextRequest, NextResponse } from "next/server";

import { db } from "~/server/db";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  authorizeHomeEditor,
  isAllowedImageType,
} from "~/server/home/images";

/**
 * Upload a landing-page image. Multipart `file` (+ optional `alt`). Gated to landing editors
 * (see authorizeHomeEditor). Validates type + size, stores the bytes in Postgres, and returns the
 * served URL. Listing/deletion happen over tRPC (`home` router). Node runtime (Prisma + Buffer).
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeHomeEditor();
  if (!auth.ok) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (!isAllowedImageType(file.type)) {
    return NextResponse.json(
      { error: `unsupported type (allowed: ${ALLOWED_IMAGE_TYPES.join(", ")})` },
      { status: 415 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB)` },
      { status: 413 },
    );
  }

  const altRaw = form.get("alt");
  const alt = typeof altRaw === "string" && altRaw.trim() ? altRaw.trim().slice(0, 300) : null;
  const bytes = Buffer.from(await file.arrayBuffer());

  // Guard against an empty / mistyped upload that slipped past size check.
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }

  const image = await db.homeImage.create({
    data: {
      mimeType: file.type,
      data: bytes,
      byteSize: bytes.byteLength,
      alt,
      createdByName: auth.name,
    },
    select: { id: true, alt: true, byteSize: true, createdAt: true },
  });

  return NextResponse.json({
    id: image.id,
    url: `/api/images/${image.id}`,
    alt: image.alt,
    byteSize: image.byteSize,
    createdAt: image.createdAt.toISOString(),
  });
}
