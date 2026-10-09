/** Render only the supplied card; invitation data never leaves the browser. */
export async function downloadCardImage(card: HTMLElement): Promise<void> {
  // Keep the renderer out of the initial management bundle and wait for actual fonts.
  const { toBlob } = await import("html-to-image");
  await document.fonts.ready;
  if (!card.isConnected) return;
  const blob = await toBlob(card, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    preferredFontFormat: "woff2",
    // Centering margins belong to the page, not the exported card's canvas.
    style: { margin: "0", boxShadow: "none" },
  });
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
