import { getHelpAccess } from "~/server/help/access";
import {
  helpPrivateHeaders,
  permittedScreenshot,
  readScreenshot,
} from "~/server/help/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const locale = new URL(request.url).searchParams.get("locale") ?? "en";
  if (locale !== "en" && locale !== "zh")
    return new Response("Unsupported language", {
      status: 400,
      headers: helpPrivateHeaders,
    });
  try {
    const access = await getHelpAccess();
    const screenshot = permittedScreenshot(id, access.audiences, locale);
    if (!screenshot)
      return new Response("Not found", {
        status: 404,
        headers: helpPrivateHeaders,
      });
    return new Response(new Uint8Array(await readScreenshot(screenshot)), {
      headers: { ...helpPrivateHeaders, "Content-Type": "image/jpeg" },
    });
  } catch {
    return new Response(
      "Screenshot temporarily unavailable. Reload this guide to try again.",
      {
        status: 503,
        headers: helpPrivateHeaders,
      },
    );
  }
}
