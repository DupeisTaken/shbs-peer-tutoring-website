/** Wrap printable URL text without inserting or dropping any encoded character. */
export function publicQrUrlLines(url: string): string[] {
  const lines: string[] = [];
  let remaining = url;
  while (remaining.length > 32) {
    const candidate = remaining.slice(0, 32);
    // Prefer a path/hostname boundary to splitting an ordinary short signup path.
    // Very long DNS labels still break at the conservative, legible line width.
    const boundary = Math.max(
      candidate.lastIndexOf("/"),
      candidate.lastIndexOf("."),
    );
    const end = boundary >= 16 ? boundary + 1 : 32;
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) lines.push(remaining);
  return lines;
}
