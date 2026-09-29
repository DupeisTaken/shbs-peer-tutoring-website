export interface EmailPresentation {
  action?: { label: string; url: string };
  eyebrow?: string;
  code?: string;
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** A table layout and inline styles work without scripts, images or downloaded fonts.
 * All caller text is escaped. The same explicit URL powers the CTA and copyable fallback. */
export function renderEmail(input: {
  brand: string;
  subject: string;
  text: string;
  presentation?: EmailPresentation;
}): string {
  const { brand, subject, text, presentation = {} } = input;
  const action = presentation.action;
  if (action && !/^https?:\/\//.test(action.url))
    throw new Error("Email actions require an HTTP(S) URL.");
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escape(subject)}</title>
<style>@media(max-width:600px){.outer{padding:20px 10px!important}.body{padding:28px 22px!important}.title{font-size:30px!important}}@media(prefers-color-scheme:dark){.canvas{background:#16221e!important}.card{background:#22332c!important;color:#edf1e9!important}.muted{color:#c0cbbf!important}.ink{color:#edf1e9!important}.code{background:#30483a!important;color:#edf1e9!important}.rule{border-color:#526355!important}}</style></head>
<body class="canvas" style="margin:0;padding:0;background:#f2f1e9;color:#253b30;font-family:Verdana,Geneva,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(subject)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="outer" align="center" style="padding:44px 16px">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table class="card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fffef9;border-top:6px solid #24533c">
<tr><td class="body" style="padding:36px 42px 18px"><p class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.4;margin:0;color:#244c38">${escape(brand)}</p><p class="muted" style="font-size:11px;letter-spacing:2px;margin:12px 0 0;color:#667363">${escape(presentation.eyebrow ?? "ACCOUNT & PROGRAM MAIL")}</p></td></tr>
<tr><td class="body" style="padding:12px 42px 32px;font-size:15px"><h1 class="title ink" style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:36px;line-height:1.18;margin:10px 0 26px;color:#203d2e;overflow-wrap:anywhere">${escape(subject)}</h1>
${presentation.code ? `<div class="code" style="background:#eaf0e5;padding:22px;margin:0 0 26px;text-align:center;font-family:Consolas,monospace;font-size:30px;letter-spacing:5px;word-break:break-all">${escape(presentation.code)}</div>` : ""}
${paragraphs}
${action ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#24533c" style="border-radius:4px"><a href="${escape(action.url)}" style="display:inline-block;border:1px solid #24533c;border-radius:4px;padding:15px 24px;font-size:15px;font-weight:bold;line-height:22px;color:#ffffff;text-decoration:none;mso-padding-alt:15px 24px">${escape(action.label)}</a></td></tr></table><p class="muted" style="margin:24px 0 8px;font-size:12px;line-height:1.6;color:#667363">Or copy this link into your browser:</p><a class="ink" href="${escape(action.url)}" style="font-size:12px;line-height:1.7;color:#24533c;word-break:break-all;overflow-wrap:anywhere">${escape(action.url)}</a>` : ""}
</td></tr><tr><td class="body rule muted" style="padding:22px 42px;border-top:1px solid #dce2d4;color:#667363;font-size:12px;line-height:1.7">${escape(brand)}<br>This is an automated message. Keep account links and verification codes private.</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
