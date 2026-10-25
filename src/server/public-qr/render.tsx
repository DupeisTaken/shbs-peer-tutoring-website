import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { publicQrUrlLines } from "./url-lines";

export type PublicQrDestination = "tutor" | "tutee" | "crew" | "site";
export type PublicQrLocale = "en" | "zh";

const labels: Record<PublicQrLocale, Record<PublicQrDestination, string>> = {
  en: {
    tutor: "Tutor signup",
    tutee: "Tutee signup",
    crew: "Crew signup",
    site: "Website home",
  },
  zh: {
    tutor: "辅导伙伴报名",
    tutee: "学习伙伴报名",
    crew: "巡查队报名",
    site: "网站首页",
  },
};

const imageWidth = 800;
const qrTop = 128;
const qrMaximumWidth = 640;
const quietZoneModules = 4;
const urlLineHeight = 32;
let packagedFont: Promise<ArrayBuffer> | undefined;

function loadPackagedFont(): Promise<ArrayBuffer> {
  // Only immutable font bytes are cached. URLs and output images must always use
  // the current canonical origin, including after a deployment/domain change.
  return (packagedFont ??= readFile(
    join(process.cwd(), "public/fonts/public-qr/shbs-public-qr.otf"),
  ).then((font) => new Uint8Array(font).buffer));
}

/** Compose a locally rendered label and complete URL around one unscaled QR. */
export async function renderPublicQrPng({
  url,
  destination,
  locale,
}: {
  url: string;
  destination: PublicQrDestination;
  locale: PublicQrLocale;
}): Promise<Uint8Array> {
  const label = labels[locale][destination];
  const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules
    .size;
  // Even integer module sizes remain exact at 50% print size. The embedded PNG
  // keeps its own four-module quiet zone and is never stretched by composition.
  const scale = Math.max(
    2,
    2 * Math.floor(qrMaximumWidth / (modules + quietZoneModules * 2) / 2),
  );
  const qrWidth = (modules + quietZoneModules * 2) * scale;
  const qr = await QRCode.toBuffer(url, {
    type: "png",
    scale,
    margin: quietZoneModules,
    errorCorrectionLevel: "M",
    // Both the QR's light modules/quiet zone and the outer canvas stay clear,
    // so placing the PNG on a light poster does not leave a white rectangle.
    color: { dark: "#000000ff", light: "#ffffff00" },
  });

  // Canonical URL serialization uses ASCII (including punycode). Fixed short
  // lines keep even a 253-character hostname intact without shrinking or
  // clipping text; joining the rows recovers the exact URL encoded in the QR.
  const urlLines = publicQrUrlLines(url);
  const urlTop = qrTop + qrWidth + 24;
  const imageHeight = urlTop + urlLines.length * urlLineHeight + 40;
  const font = await loadPackagedFont();
  const image = new ImageResponse(
    <div
      style={{
        display: "flex",
        width: imageWidth,
        height: imageHeight,
        position: "relative",
        backgroundColor: "transparent",
        color: "#000000",
        fontFamily: "Public QR",
        fontWeight: 400,
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 32,
          top: 32,
          width: imageWidth - 64,
          height: 72,
          alignItems: "center",
          justifyContent: "center",
          fontSize: 44,
          lineHeight: 1.3,
        }}
      >
        {label}
      </div>
      {/* ImageResponse needs a literal raster image, without browser optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:image/png;base64,${qr.toString("base64")}`}
        alt=""
        width={qrWidth}
        height={qrWidth}
        style={{
          position: "absolute",
          top: qrTop,
          left: (imageWidth - qrWidth) / 2,
          width: qrWidth,
          height: qrWidth,
          flexShrink: 0,
        }}
      />
      {urlLines.map((line, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            position: "absolute",
            left: 32,
            top: urlTop + index * urlLineHeight,
            width: imageWidth - 64,
            height: urlLineHeight,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            lineHeight: 1.3,
            whiteSpace: "nowrap",
          }}
        >
          {line}
        </div>
      ))}
    </div>,
    {
      width: imageWidth,
      height: imageHeight,
      fonts: [{ name: "Public QR", data: font, style: "normal", weight: 400 }],
    },
  );
  // Consume the renderer stream here so failures are caught by the route before
  // it sends PNG headers, rather than surfacing as a truncated downloaded file.
  return new Uint8Array(await image.arrayBuffer());
}
