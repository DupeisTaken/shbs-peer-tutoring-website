import QRCode from "qrcode";

export const runtime = "nodejs";
/** Same-origin sign-in QR, generated locally with a full quiet zone for reliable scanning. */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const signinUrl = new URL(
    "/signin",
    process.env.AUTH_URL ?? requestUrl.origin,
  ).href;
  const png = await QRCode.toBuffer(signinUrl, {
    type: "png",
    width: 640,
    margin: 4,
    errorCorrectionLevel: "M",
  });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${requestUrl.searchParams.has("download") ? "attachment" : "inline"}; filename="student-signin.png"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
