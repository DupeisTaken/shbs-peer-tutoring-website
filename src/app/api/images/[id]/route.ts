import { type NextRequest } from "next/server";

import { db } from "~/server/db";

/**
 * Public image server for landing-page images stored in Postgres (`HomeImage`). Bytes are immutable
 * once uploaded, so they cache aggressively. Runs in the Node runtime (Prisma).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const image = await db.homeImage.findUnique({
    where: { id },
    select: { data: true, mimeType: true, byteSize: true },
  });
  if (!image) {
    return new Response("Not found", { status: 404 });
  }
  const body = new Uint8Array(image.data);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.byteSize),
      // Immutable: a HomeImage row's bytes never change after upload.
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${id}"`,
    },
  });
}
