import { helpAudiences } from "~/lib/help/catalogue";
import type { HelpAudience } from "~/lib/help/types";
import { getHelpAccess } from "~/server/help/access";
import { helpPrivateHeaders } from "~/server/help/assets";
import {
  formatDownloadFilenameStamp,
  renderHelpPdf,
} from "~/server/help/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Large staff handbooks buffer hundreds of pages in memory while rendering.
// Bound concurrent renders so overlapping downloads cannot exhaust server RAM.
const MAX_CONCURRENT_PDF_RENDERS = 2;
let activePdfRenders = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ audience: string }> },
) {
  const { audience } = await context.params;
  const locale = new URL(request.url).searchParams.get("locale") ?? "en";
  let acquiredSlot = false;
  try {
    if (
      !helpAudiences.includes(audience as HelpAudience) ||
      (locale !== "en" && locale !== "zh")
    )
      return new Response("Invalid handbook", {
        status: 400,
        headers: helpPrivateHeaders,
      });
    const access = await getHelpAccess();
    if (!access.downloadableAudiences.includes(audience as HelpAudience))
      return new Response("Forbidden", {
        status: 403,
        headers: helpPrivateHeaders,
      });
    if (activePdfRenders >= MAX_CONCURRENT_PDF_RENDERS)
      return new Response(
        "Another handbook download is currently preparing. Wait a moment and try again.",
        {
          status: 503,
          headers: { ...helpPrivateHeaders, "Retry-After": "5" },
        },
      );
    activePdfRenders++;
    acquiredSlot = true;
    const downloadedAt = new Date();
    const bytes = await renderHelpPdf(
      audience as HelpAudience,
      locale,
      downloadedAt,
    );
    const filenameStamp = formatDownloadFilenameStamp(downloadedAt);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...helpPrivateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="shbs-help-${audience}-${locale}-${filenameStamp}.pdf"`,
      },
    });
  } catch {
    return new Response(
      "Handbook temporarily unavailable. Return to PDF Handbooks and try again.",
      {
        status: 503,
        headers: helpPrivateHeaders,
      },
    );
  } finally {
    if (acquiredSlot) activePdfRenders--;
  }
}
