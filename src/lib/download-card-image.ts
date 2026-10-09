/** Render only the supplied card; invitation data never leaves the browser. */
export async function downloadCardImage(card: HTMLElement): Promise<void> {
  // Keep the renderer out of the initial management bundle and wait for actual fonts.
  const { toCanvas } = await import("html-to-image");
  await document.fonts.ready;
  if (!card.isConnected) return;
  const rendered = await toCanvas(card, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    preferredFontFormat: "woff2",
    // Centering margins belong to the page, not the exported card's canvas.
    style: { margin: "0", boxShadow: "none" },
  });
  if (!card.isConnected) return;
  // Add 12 CSS px outside the border without changing the card's width or text
  // wrapping. The rendered image is 2x, so its surrounding margin is 24 pixels.
  const padding = 24;
  const canvas = document.createElement("canvas");
  canvas.width = rendered.width + padding * 2;
  canvas.height = rendered.height + padding * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create image canvas");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(rendered, padding, padding);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Unable to render account setup card");
  // Dismissing/replacing a card during rendering cancels its download.
  if (!card.isConnected) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  // No participant identifiers or credentials in download history filenames.
  link.download = "account-setup.png";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser time to begin consuming the URL before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
