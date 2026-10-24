import { publicQrOrigin } from "~/server/public-qr/origin";
import {
  renderPublicQrPng,
  type PublicQrDestination,
} from "~/server/public-qr/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const destinations: Record<PublicQrDestination, string> = {
  tutor: "/tutor",
  tutee: "/tutee",
  crew: "/crew",
  site: "/",
};
const allowedParameters = new Set(["destination", "locale", "download"]);
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** These are public, read-only links. Recruitment and feature checks remain at
 * their destinations; exporting an image neither admits a participant nor writes settings. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Reject ambiguous or arbitrary inputs instead of silently selecting one URL.
  const invalidParameters = [...params.keys()].some(
    (key) => !allowedParameters.has(key) || params.getAll(key).length !== 1,
  );
  const destination = params.get("destination");
  const locale = params.get("locale") ?? "en";
  if (
    invalidParameters ||
    !destination ||
    !Object.hasOwn(destinations, destination) ||
    (locale !== "en" && locale !== "zh") ||
    (params.has("download") && params.get("download") !== "1")
  ) {
    return Response.json(
      { error: "Choose a valid public QR destination and image language." },
      { status: 400, headers },
    );
  }

  let origin: string;
  try {
    origin = publicQrOrigin();
  } catch {
    // Never reflect misconfigured credentials, internal hosts or parsing errors.
    return Response.json(
      {
        error:
          "QR export is unavailable. Ask the operator to configure AUTH_URL as the public HTTPS site origin.",
      },
      { status: 503, headers },
    );
  }

  const selected = destination as PublicQrDestination;
  const url = new URL(destinations[selected], origin).href;
  try {
    const png = await renderPublicQrPng({
      url,
      destination: selected,
      locale,
    });
    return new Response(new Uint8Array(png), {
      headers: {
        ...headers,
        "Content-Type": "image/png",
        "Content-Disposition": `${params.has("download") ? "attachment" : "inline"}; filename="shbs-${selected}-qr-${locale}.png"`,
      },
    });
  } catch {
    return Response.json(
      { error: "QR export is unavailable. Try again or contact the operator." },
      { status: 503, headers },
    );
  }
}
