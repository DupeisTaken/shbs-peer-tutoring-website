export interface EmailPresentation {
  action?: { label: string; url: string };
  eyebrow?: string;
  code?: string;
  /** Optional-notification preference link; essential account mail omits it. */
  unsubscribeUrl?: string;
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** A table layout and inline styles keep essential content usable without images or fonts.
 * All caller text is escaped. The same explicit URL powers the CTA and copyable fallback.
 * Neutral graphite surfaces give the #0D59E6 action and short signature rule emphasis.
 * Brand and footer sit outside the card; the fallback link has its own quieter panel.
 * Inline colors and table backgrounds preserve contrast when a client strips CSS.
 * The optional site icon leads the footer brand, never carrying essential message content. */
export function renderEmail(input: {
  brand: string;
  subject: string;
  text: string;
  presentation?: EmailPresentation;
  iconUrl?: string;
}): string {
  const { brand, subject, text, presentation = {}, iconUrl } = input;
  const action = presentation.action;
  const unsubscribeUrl = presentation.unsubscribeUrl;
  if (unsubscribeUrl !== undefined) {
    let unsubscribe: URL;
    try {
      unsubscribe = new URL(unsubscribeUrl);
    } catch {
      throw new Error(
        "Email unsubscribe links require an absolute HTTP(S) URL without credentials.",
      );
    }
    if (
      !/^https?:$/.test(unsubscribe.protocol) ||
      unsubscribe.username ||
      unsubscribe.password
    )
      throw new Error(
        "Email unsubscribe links require an absolute HTTP(S) URL without credentials.",
      );
  }
  if (action && !/^https?:\/\//.test(action.url))
    throw new Error("Email actions require an HTTP(S) URL.");
  if (iconUrl !== undefined) {
    let icon: URL;
    try {
      icon = new URL(iconUrl);
    } catch {
      throw new Error(
        "Email icons require an absolute HTTP(S) URL without credentials.",
      );
    }
    if (!/^https?:$/.test(icon.protocol) || icon.username || icon.password)
      throw new Error(
        "Email icons require an absolute HTTP(S) URL without credentials.",
      );
  }
  const paragraphs = text
    .split(/\n\n+/)
    .map((part) => {
      // The source text retains the raw URL for text-only clients; HTML places it below the CTA.
      const content = action ? part.replace(action.url, "").trim() : part;
      return content
        ? `<p style="margin:0 0 20px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word">${escape(content).replace(/\n/g, "<br>")}</p>`
        : "";
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escape(subject)}</title>
<style>:root{color-scheme:dark}a:focus-visible{outline:3px solid #ADC9FF;outline-offset:5px}@media(max-width:600px){.outer{padding:24px 12px!important}.inside{padding-left:24px!important;padding-right:24px!important}.heading{padding-top:32px!important;padding-bottom:28px!important}.title{font-size:32px!important;line-height:1.15!important}.footer{padding-left:12px!important;padding-right:12px!important}}@media(prefers-color-scheme:dark){.canvas{background:#181B20!important}.card{background:#272D35!important;color:#E0E5ED!important}.panel{background:#22272E!important}.muted{color:#C5CDDA!important}.ink{color:#F4F7FC!important}.accent{color:#ADC9FF!important}.code{background:#22272E!important;color:#ADC9FF!important}.rule{border-color:#414A58!important}}</style></head>
<body class="canvas" style="margin:0;padding:0;background:#181B20;color:#E0E5ED;font-family:'Trebuchet MS',Verdana,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(subject)}</div>
<table class="canvas" role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#181B20" style="background:#181B20"><tr><td class="outer" align="center" style="padding:48px 24px">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;table-layout:fixed">
<tr><td style="padding:0 0 20px"><p class="ink" style="font-size:16px;font-weight:700;line-height:1.5;letter-spacing:0.2px;margin:0;color:#F4F7FC;overflow-wrap:anywhere;word-break:break-word">${escape(brand)}</p></td></tr>
<tr><td class="card" bgcolor="#272D35" style="background:#272D35;color:#E0E5ED;border:1px solid #414A58">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed">
<tr><td><table role="presentation" width="72" cellspacing="0" cellpadding="0" style="width:72px"><tr><td height="5" bgcolor="#0D59E6" style="height:5px;background:#0D59E6;font-size:1px;line-height:1px">&nbsp;</td></tr></table></td></tr>
<tr><td class="inside heading" style="padding:40px 40px 32px"><p class="muted accent" style="font-size:11px;line-height:18px;font-weight:700;letter-spacing:2px;margin:0 0 24px;color:#ADC9FF;overflow-wrap:anywhere;word-break:break-word">${escape(presentation.eyebrow ?? "ACCOUNT & PROGRAM MAIL")}</p><h1 class="title ink" style="font-weight:700;font-size:40px;line-height:1.12;letter-spacing:-1.3px;margin:0;color:#F4F7FC;overflow-wrap:anywhere;word-break:break-word">${escape(subject)}</h1></td></tr>
<tr><td class="inside" style="padding:0 40px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td height="1" bgcolor="#495362" style="height:1px;background:#495362;font-size:1px;line-height:1px">&nbsp;</td></tr></table></td></tr>
<tr><td class="inside body" style="padding:28px 40px 36px;font-size:16px;color:#E0E5ED">
${presentation.code ? `<div class="code" style="background:#22272E;color:#ADC9FF;border:1px solid #495362;padding:22px;margin:0 0 26px;text-align:center;font-family:Consolas,monospace;font-size:30px;letter-spacing:5px;word-break:break-all">${escape(presentation.code)}</div>` : ""}
${paragraphs}
${action ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#0D59E6" style="background:#0D59E6;border-radius:4px"><a href="${escape(action.url)}" style="display:inline-block;border:1px solid #0D59E6;border-radius:4px;background:#0D59E6;padding:15px 23px;font-size:15px;font-weight:700;line-height:20px;color:#FFFFFF;text-decoration:none;mso-padding-alt:15px 23px;overflow-wrap:anywhere;word-break:break-word">${escape(action.label)}</a></td></tr></table>` : ""}
</td></tr>
${action ? `<tr><td class="inside panel" bgcolor="#22272E" style="padding:22px 40px 26px;background:#22272E;border-top:1px solid #414A58"><p class="muted" style="margin:0 0 8px;font-size:12px;line-height:20px;color:#C5CDDA">Or copy this link into your browser:</p><a class="ink accent" href="${escape(action.url)}" style="font-size:12px;line-height:20px;color:#ADC9FF;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${escape(action.url)}</a></td></tr>` : ""}
</table></td></tr>
<tr><td class="footer rule muted" align="center" style="padding:28px 40px 0;color:#C5CDDA;font-size:12px;line-height:20px;text-align:center">${iconUrl ? `<img class="footer-icon" src="${escape(iconUrl)}" alt="${escape(brand)} icon" width="48" height="48" style="display:block;width:48px;height:48px;margin:0 auto 14px;border:0;border-radius:12px;color:#C5CDDA;font-size:10px">` : ""}<p class="footer-brand ink" style="margin:0 0 10px;color:#F4F7FC;font-size:14px;font-weight:700;line-height:22px;overflow-wrap:anywhere;word-break:break-word">${escape(brand)}</p><p class="footer-copy" style="margin:0">This is an automated message. Keep account links and verification codes private.</p>${unsubscribeUrl ? `<p style="margin:8px 0 0"><a class="footer-unsubscribe accent" href="${escape(unsubscribeUrl)}" style="display:inline-block;padding:12px 8px;font-size:12px;line-height:20px;color:#ADC9FF;text-decoration:underline;overflow-wrap:anywhere;word-break:break-word">Unsubscribe</a></p>` : ""}</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
