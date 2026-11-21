import { helpAudiences } from "~/lib/help/catalogue";
import type { HelpAudience } from "~/lib/help/types";
import { getHelpAccess } from "~/server/help/access";
import { helpPrivateHeaders } from "~/server/help/assets";
import { renderHelpPdf } from "~/server/help/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ audience: string }> },
) {
  const { audience } = await context.params;
  const locale = new URL(request.url).searchParams.get("locale") ?? "en";
  try {
    const access = await getHelpAccess();
    if (!access.canDownload)
      return new Response("Forbidden", {
        status: 403,
        headers: helpPrivateHeaders,
      });
    if (
      !helpAudiences.includes(audience as HelpAudience) ||
      (locale !== "en" && locale !== "zh")
    )
      return new Response("Invalid handbook", {
        status: 400,
        headers: helpPrivateHeaders,
      });
    if (
      (audience === "head" || audience === "admin") &&
      !access.audiences.includes(audience)
    )
      return new Response("Forbidden", {
        status: 403,
        headers: helpPrivateHeaders,
      });
    const bytes = await renderHelpPdf(audience as HelpAudience, locale);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...helpPrivateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="shbs-help-${audience}-${locale}.pdf"`,
      },
    });
  } catch {
    return new Response(
      "Handbook temporarily unavailable. Return to PDF handbooks and try again.",
      {
        status: 503,
        headers: helpPrivateHeaders,
      },
    );
  }
}
