// @vitest-environment jsdom
import { expect, it } from "vitest";
import { renderEmail } from "./template";

it.each(["en", "zh"] as const)(
  "uses a safe %s inbox preview instead of repeating the subject or recovering private body content",
  (locale) => {
    const subject = "PRIVATE SUBJECT 0012";
    const html = renderEmail({
      brand: "School",
      subject,
      text: "PRIVATE REASON https://school.example/?token=SECRET",
      presentation: { locale, code: "0012" },
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const preview = doc.querySelector(".preheader")?.textContent;
    expect(preview).toBe(
      locale === "en"
        ? "Details and next steps inside."
        : "请查看邮件中的详情和后续步骤。",
    );
    expect(preview).not.toMatch(/PRIVATE|0012|SECRET|https:/);
    expect(doc.body.textContent?.split(subject)).toHaveLength(2);
    expect(doc.querySelector("h1")?.textContent).toBe(subject);
  },
);

it.each(["en", "zh"] as const)(
  "escapes an explicit %s preview without creating executable markup",
  (locale) => {
    const preview =
      locale === "en"
        ? 'Review <img src=x onerror="private()"> & continue.'
        : '请核对 <img src=x onerror="private()"> 并继续。';
    const doc = new DOMParser().parseFromString(
      renderEmail({
        brand: "School",
        subject: "Subject",
        text: "Body",
        presentation: { locale, preview },
      }),
      "text/html",
    );
    expect(doc.querySelector(".preheader")?.textContent).toBe(preview);
    expect(doc.querySelector("img,[onerror],script")).toBeNull();
  },
);

it.each(["en", "zh"] as const)(
  "renders all shared boilerplate in %s without changing legacy code styling",
  (locale) => {
    const doc = new DOMParser().parseFromString(
      renderEmail({
        brand: "School",
        subject: locale === "en" ? "Your code" : "您的验证码",
        text: locale === "en" ? "Enter the code." : "请输入验证码。",
        iconUrl: "https://school.example/icon.png",
        presentation: {
          locale,
          code: "0012",
          codePurpose: "verification",
          action: {
            label: locale === "en" ? "Continue" : "继续",
            url: "https://school.example/continue",
          },
          unsubscribeUrl: "https://school.example/unsubscribe",
        },
      }),
      "text/html",
    );
    expect(doc.documentElement.lang).toBe(locale);
    expect(doc.querySelector(".footer-unsubscribe")?.textContent).toBe(
      locale === "en" ? "Unsubscribe" : "取消订阅",
    );
    expect(doc.querySelector(".footer-copy")?.textContent).toBe(
      locale === "en"
        ? "Automated message. Keep account links and codes private."
        : "此为自动邮件，请勿分享账户链接和验证码。",
    );
    expect(doc.querySelector(".panel")?.textContent).toContain(
      locale === "en"
        ? "Copy this link into your browser:"
        : "复制链接到浏览器：",
    );
    expect(doc.querySelector(".code")?.textContent).toBe("0012");
    expect(doc.querySelector<HTMLElement>(".code")!.style.backgroundColor).toBe(
      "rgb(23, 47, 73)",
    );
    expect(doc.querySelector("img")?.alt).toBe(
      locale === "en" ? "School icon" : "School图标",
    );
    if (locale === "en")
      expect(doc.body.textContent).not.toMatch(/\p{Script=Han}/u);
    else
      expect(doc.body.textContent).not.toMatch(
        /ACCOUNT & PROGRAM MAIL|Copy this link|Automated message|Unsubscribe/,
      );
  },
);

it("escapes caller text and gives the CTA and fallback exactly the same token URL", () => {
  const url =
    "https://school.example/reset-password?token=synthetic&next=one#confirm";
  const html = renderEmail({
    brand: "School <script>alert(1)</script>",
    subject: "Reset <password>",
    text: `Hello <img src=x onerror=alert(1)>\n\n${url}`,
    presentation: { action: { label: "Reset <password>", url } },
  });
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("script,img")).toBeNull();
  expect(doc.querySelector("h1")?.textContent).toBe("Reset <password>");
  expect([...doc.querySelectorAll("a")].map((a) => a.href)).toEqual([url, url]);
  expect(doc.body.textContent).toContain("School <script>alert(1)</script>");
  expect(html).toContain("@media(max-width:600px)");
  expect(html).toContain("prefers-color-scheme:dark");
});

it("uses escaped presentation prose while leaving the complete plain-text alternative untouched", () => {
  const url = "https://school.example/verify?token=synthetic";
  const text = `Verification code: 0012. 验证码：0012。\n\n${url}`;
  const input = {
    brand: "School",
    subject: "Verify your email",
    text,
    presentation: {
      body: "Enter the code below within ten minutes.\n\n请在十分钟内输入验证码。 <script>literal</script>",
      code: "0012",
      codePurpose: "verification" as const,
      action: { label: "Verify email / 验证邮箱", url },
    },
  };
  const doc = new DOMParser().parseFromString(renderEmail(input), "text/html");
  expect(doc.querySelector(".body")?.textContent).toContain(
    "请在十分钟内输入验证码。 <script>literal</script>",
  );
  expect(doc.querySelector("script")).toBeNull();
  expect(doc.querySelector(".body")?.textContent).not.toContain(
    "Verification code: 0012",
  );
  expect(doc.querySelector(".code")?.textContent).toBe("0012");
  expect(input.text).toBe(text);
  expect([...doc.querySelectorAll("a")].map((link) => link.href)).toEqual([
    url,
    url,
  ]);
});

it("removes only standalone action URLs and preserves complete embedded link sentences", () => {
  const url = "https://school.example/register?invitation=synthetic";
  const sentence = `Enter your code at ${url}. 请前往 ${url} 输入验证码。`;
  const doc = new DOMParser().parseFromString(
    renderEmail({
      brand: "School",
      subject: "Review your invitation",
      text: `${sentence}\n\n  ${url}  \n\nKeep this invitation private.`,
      presentation: { action: { label: "Review invitation", url } },
    }),
    "text/html",
  );
  const paragraphs = [...doc.querySelectorAll(".body > p")].map(
    (paragraph) => paragraph.textContent,
  );
  expect(paragraphs).toEqual([sentence, "Keep this invitation private."]);
});

it("honors an explicitly empty HTML body without recovering redundant fallback prose", () => {
  const doc = new DOMParser().parseFromString(
    renderEmail({
      brand: "School",
      subject: "Your code",
      text: "Your verification code is 0012.",
      presentation: { body: "", code: "0012" },
    }),
    "text/html",
  );
  expect(doc.querySelector(".body > p")).toBeNull();
  expect(doc.querySelector(".code")?.textContent).toBe("0012");
});

it("keeps mixed-language instructions and code readable without images", () => {
  const html = renderEmail({
    brand: "Peer tutoring 同伴辅导",
    subject: "Verify your email",
    text: "Verify by tomorrow. 验证截止时间：明天。",
    presentation: { code: "AB234" },
  });
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector(".code")?.textContent).toBe("AB234");
  expect(doc.body.textContent).toContain("验证截止时间：明天。");
  expect(doc.querySelector("img,a")).toBeNull();
});

it.each([
  {
    purpose: "invitation" as const,
    code: "A2B3C",
    background: "rgb(24, 52, 44)",
    hexBackground: "#18342C",
    instructions:
      "Invitation code: A2B3C (5 letters and numbers). 邀请码：A2B3C（5 位字母和数字）。",
  },
  {
    purpose: "verification" as const,
    code: "0012",
    background: "rgb(23, 47, 73)",
    hexBackground: "#172F49",
    instructions:
      "Email verification code: 0012 (4 digits). 邮箱验证码：0012（4 位数字）。",
  },
])(
  "tints only the legacy $purpose box background with readable CSS-free colors",
  (sample) => {
    const input = {
      brand: "School",
      subject: "Your code",
      text: sample.instructions,
    };
    const legacy = renderEmail({
      ...input,
      presentation: { code: sample.code },
    });
    const html = renderEmail({
      ...input,
      presentation: { code: sample.code, codePurpose: sample.purpose },
    });
    // The purpose is the only visual difference: all markup, type, spacing and
    // neutral borders remain identical to the unannotated legacy presentation.
    expect(html.replaceAll(sample.hexBackground, "#22272E")).toBe(legacy);
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("style").forEach((style) => style.remove());
    const code = doc.querySelector<HTMLElement>(".code")!;
    expect(code.textContent).toBe(sample.code);
    expect(inlineColor(code, "backgroundColor")).toBe(sample.background);
    expect(inlineColor(code, "color")).toBe("rgb(173, 201, 255)");
    expect(code.children).toHaveLength(0);
    expect(code.parentElement?.classList.contains("body")).toBe(true);
    expect(code.style.border).toBe("1px solid rgb(73, 83, 98)");
    expect(code.style.padding).toBe("22px");
    expect(code.style.margin).toBe("0px 0px 26px");
    expect(code.style.textAlign).toBe("center");
    expect(code.style.fontFamily.replace(/\s/g, "")).toBe("Consolas,monospace");
    expect(code.style.fontSize).toBe("30px");
    expect(code.style.letterSpacing).toBe("5px");
    expect(code.style.lineHeight).toBe("");
    expect(code.style.wordBreak).toBe("break-all");
    expect(
      doc.querySelector(".code-panel,.code-label,.code-guidance"),
    ).toBeNull();
    expect(doc.body.textContent).toContain(sample.instructions);
    expect(contrastRatio(code)).toBeGreaterThanOrEqual(4.5);
    // Dark clients must retain each purpose's palette instead of forcing every code blue.
    expect(html).toContain(
      `.code{background:${sample.hexBackground}!important;color:#ADC9FF!important}`,
    );
  },
);

it("retains the original neutral box for queued mail without purpose metadata", () => {
  const html = renderEmail({
    brand: "School",
    subject: "Your code",
    text: "Enter every character shown.",
    presentation: { code: "AB234" },
  });
  const doc = new DOMParser().parseFromString(html, "text/html");
  const code = doc.querySelector(".code")!;
  expect(inlineColor(code, "backgroundColor")).toBe("rgb(34, 39, 46)");
  expect(inlineColor(code, "color")).toBe("rgb(173, 201, 255)");
  expect(html).toContain(
    ".code{background:#22272E!important;color:#ADC9FF!important}",
  );
});

it.each(["invitation", "verification"] as const)(
  "leaves mail without a code unchanged when %s metadata is supplied",
  (codePurpose) => {
    const input = {
      brand: "School",
      subject: "Program update",
      text: "Read the update. 请查看更新。",
      presentation: {
        action: { label: "View update", url: "https://school.example/update" },
      },
    };
    expect(
      renderEmail({
        ...input,
        presentation: { ...input.presentation, codePurpose },
      }),
    ).toBe(renderEmail(input));
    const doc = new DOMParser().parseFromString(
      renderEmail(input),
      "text/html",
    );
    expect(doc.querySelector(".code")).toBeNull();
  },
);

it.each([
  { purpose: "invitation" as const, code: "AB234" },
  { purpose: "invitation" as const, code: "00123" },
  { purpose: "invitation" as const, code: "012345ABCDEF" },
  { purpose: "verification" as const, code: "AB234" },
  { purpose: "verification" as const, code: "01ABCD" },
])(
  "does not relabel or truncate an outstanding $purpose code ($code)",
  ({ purpose, code }) => {
    const instructions =
      "Previously issued code: enter every character shown. 先前签发的代码：请输入显示的全部字符。";
    const doc = new DOMParser().parseFromString(
      renderEmail({
        brand: "School",
        subject: "Your code",
        text: instructions,
        presentation: { code, codePurpose: purpose },
      }),
      "text/html",
    );
    expect(doc.querySelector(".code")?.textContent).toBe(code);
    expect(doc.body.textContent).toContain(instructions);
    expect(doc.querySelector(".code-label,.code-guidance")).toBeNull();
  },
);

it("escapes displayed code text without adding executable content", () => {
  const code = '<img src=x onerror="alert(1)">&AB234';
  const doc = new DOMParser().parseFromString(
    renderEmail({
      brand: "School",
      subject: "Your code",
      text: "",
      presentation: { code, codePurpose: "invitation" },
    }),
    "text/html",
  );
  expect(doc.querySelector(".code")?.textContent).toBe(code);
  expect(doc.querySelector("img,script,[onerror]")).toBeNull();
});

it("rejects executable CTA URLs", () => {
  expect(() =>
    renderEmail({
      brand: "School",
      subject: "Test",
      text: "Test",
      presentation: { action: { label: "Open", url: "javascript:alert(1)" } },
    }),
  ).toThrow();
});

it("adds an escaped unsubscribe link after the existing footer with readable inline styling", () => {
  const unsubscribeUrl =
    'https://school.example/unsubscribe?token=synthetic&note="<private>"';
  const html = renderEmail({
    brand: "SHBS Peer Tutoring",
    subject: "Program update",
    text: "Your tutoring program has an update.",
    iconUrl: "https://school.example/icon.png",
    presentation: { unsubscribeUrl },
  });
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style").forEach((style) => style.remove());
  const link = doc.querySelector<HTMLAnchorElement>(".footer-unsubscribe")!;
  expect(link.getAttribute("href")).toBe(unsubscribeUrl);
  expect(link.textContent).toBe("Unsubscribe");
  expect(link.style.textDecoration).toBe("underline");
  expect(doc.querySelector("script,private,[onerror],[onload]")).toBeNull();
  expect(html).toContain("&amp;note=&quot;&lt;private&gt;&quot;");
  expect(contrastRatio(link)).toBeGreaterThanOrEqual(4.5);
  // The inline fallback preserves a 44px target even when a client strips media rules.
  expect(
    parseFloat(link.style.lineHeight) +
      parseFloat(link.style.paddingTop) +
      parseFloat(link.style.paddingBottom),
  ).toBeGreaterThanOrEqual(44);
  const footer = doc.querySelector("td.footer")!;
  expect(
    [
      ...footer.querySelectorAll(
        ".footer-icon,.footer-brand,.footer-copy,.footer-unsubscribe",
      ),
    ].map((element) => element.classList[0]),
  ).toEqual([
    "footer-icon",
    "footer-brand",
    "footer-copy",
    "footer-unsubscribe",
  ]);
});

it("omits the unsubscribe link entirely when no optional-mail link is supplied", () => {
  const html = renderEmail({
    brand: "SHBS Peer Tutoring",
    subject: "Account security",
    text: "Your password changed.",
  });
  expect(html).not.toContain("Unsubscribe");
  expect(html).not.toContain("footer-unsubscribe");
});

it.each([
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "https://user:password@school.example/unsubscribe",
  "https://user@school.example/unsubscribe",
  "ftp://school.example/unsubscribe",
  "/unsubscribe?token=synthetic",
  "//school.example/unsubscribe",
  "https://",
  "",
])(
  "rejects unsafe or credential-bearing unsubscribe URL %s",
  (unsubscribeUrl) => {
    expect(() =>
      renderEmail({
        brand: "School",
        subject: "Program update",
        text: "Test",
        presentation: { unsubscribeUrl },
      }),
    ).toThrow(
      "Email unsubscribe links require an absolute HTTP(S) URL without credentials.",
    );
  },
);

/** Resolve only the inline email fallback: clients may discard the head stylesheet.
 * Transparent table cells inherit the visible surface from their ancestors. */
function inlineColor(element: Element, property: "color" | "backgroundColor") {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const value =
      (current as HTMLElement).style[property] ||
      (property === "backgroundColor" ? current.getAttribute("bgcolor") : "");
    if (value && value !== "transparent" && value !== "inherit") return value;
  }
  throw new Error(`No inline ${property} for ${element.tagName}`);
}

function luminance(color: string) {
  const hex = /^#([a-f\d]{6})$/i.exec(color)?.[1];
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(color);
  const channels = hex
    ? [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
    : rgb?.slice(1).map(Number);
  if (!channels)
    throw new Error(`Expected an opaque email color, received ${color}`);
  // WCAG relative luminance is calculated in linear sRGB, not averaged RGB.
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = linear;
  if (red === undefined || green === undefined || blue === undefined)
    throw new Error(`Expected three color channels, received ${color}`);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(element: Element) {
  const foreground = luminance(inlineColor(element, "color"));
  const background = luminance(inlineColor(element, "backgroundColor"));
  return (
    (Math.max(foreground, background) + 0.05) /
    (Math.min(foreground, background) + 0.05)
  );
}

function emailWithoutStylesheet(iconUrl?: string) {
  const url = "https://school.example/account?token=synthetic&lang=zh";
  const doc = new DOMParser().parseFromString(
    renderEmail({
      brand: "SHBS Peer Tutoring",
      subject: "Confirm your account / 确认账户",
      text: `Use your code to finish signing in. 使用验证码完成登录。\n\n${url}`,
      ...(iconUrl ? { iconUrl } : {}),
      presentation: {
        eyebrow: "ACCOUNT SECURITY",
        code: "AB234",
        action: { label: "Confirm account / 确认账户", url },
      },
    }),
    "text/html",
  );
  doc.querySelectorAll("style").forEach((style) => style.remove());
  return { doc, url };
}

it("keeps all email text at readable contrast when a client strips the stylesheet", () => {
  const { doc } = emailWithoutStylesheet();
  const bodyCopy = [...doc.querySelectorAll("p")].find((paragraph) =>
    paragraph.textContent?.startsWith("Use your code"),
  );
  const targets = {
    brand: doc.querySelector("p.ink"),
    heading: doc.querySelector("h1"),
    body: bodyCopy,
    eyebrow: doc.querySelector("p.muted"),
    footer: doc.querySelector("td.rule"),
    footerBrand: doc.querySelector(".footer-brand"),
    code: doc.querySelector(".code"),
    action: doc.querySelector("a"),
    fallbackInstructions: [...doc.querySelectorAll("p")].find((paragraph) =>
      paragraph.textContent?.startsWith("Copy this link into your browser"),
    ),
    fallbackLink: doc.querySelector("a.ink"),
  };
  for (const [name, element] of Object.entries(targets)) {
    expect(element, `${name} remains present`).toBeTruthy();
    expect(
      contrastRatio(element!),
      `${name} has normal-text contrast`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

it("retains branded bilingual instructions, verification code and both usable actions without CSS rules", () => {
  const { doc, url } = emailWithoutStylesheet();
  expect(doc.querySelector("style,script,img,link")).toBeNull();
  expect(doc.querySelector("p.ink")?.textContent).toBe("SHBS Peer Tutoring");
  expect(doc.querySelector("h1")?.textContent).toBe(
    "Confirm your account / 确认账户",
  );
  expect(doc.body.textContent).toContain("使用验证码完成登录。");
  expect(doc.querySelector(".code")?.textContent).toBe("AB234");
  const links = [...doc.querySelectorAll("a")];
  expect(links.map((link) => link.href)).toEqual([url, url]);
  expect(links.map((link) => link.textContent)).toEqual([
    "Confirm account / 确认账户",
    url,
  ]);
  expect(doc.body.textContent).toContain(
    "Keep account links and codes private.",
  );
});

it("uses the requested primary blue with a readable white action label", () => {
  const { doc } = emailWithoutStylesheet();
  const action = doc.querySelector("a")!;
  expect(inlineColor(action, "backgroundColor")).toBe("rgb(13, 89, 230)");
  expect(inlineColor(action, "color")).toBe("rgb(255, 255, 255)");
  expect(contrastRatio(action)).toBeGreaterThanOrEqual(4.5);
});

it("places one accessible 48px site icon above the footer brand and privacy copy", () => {
  const iconUrl = "https://school.example/icon.png";
  const { doc } = emailWithoutStylesheet(iconUrl);
  const icons = doc.querySelectorAll("img");
  expect(icons).toHaveLength(1);
  const icon = icons[0]!;
  expect(icon.classList.contains("footer-icon")).toBe(true);
  expect(icon.src).toBe(iconUrl);
  expect(icon.getAttribute("width")).toBe("48");
  expect(icon.getAttribute("height")).toBe("48");
  expect(icon.alt).toBe("SHBS Peer Tutoring icon");
  expect(icon.closest("a")).toBeNull();

  const footer = doc.querySelector("td.rule")!;
  const footerBrand = footer.querySelector(".footer-brand")!;
  const footerCopy = footer.querySelector(".footer-copy")!;
  expect(footerBrand.textContent).toBe("SHBS Peer Tutoring");
  expect(footerCopy.textContent).toBe(
    "Automated message. Keep account links and codes private.",
  );
  expect(footer.contains(icon)).toBe(true);
  expect(
    footerBrand.compareDocumentPosition(footerCopy) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    icon.compareDocumentPosition(footerBrand) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  // Keep the footer order explicit without tying it to a particular table layout.
  const beforeBrand = doc.createRange();
  beforeBrand.setStart(footer, 0);
  beforeBrand.setEndBefore(footerBrand);
  expect(
    beforeBrand.cloneContents().querySelector("img.footer-icon"),
  ).not.toBeNull();
});

it("escapes the runtime brand in both visible brand labels and icon alternative text", () => {
  const brand = 'SHBS " onerror="alert(1) <script>alert(2)</script>';
  const doc = new DOMParser().parseFromString(
    renderEmail({
      brand,
      subject: "Verify your email",
      text: "Use the verification code.",
      iconUrl: "https://school.example/icon.png",
    }),
    "text/html",
  );
  expect(doc.querySelectorAll("img")).toHaveLength(1);
  expect(doc.querySelector("img")?.alt).toBe(`${brand} icon`);
  expect(doc.querySelector("script,[onerror],[onload]")).toBeNull();
  expect(doc.querySelector("p.ink")?.textContent).toBe(brand);
  const footerBrand = doc.querySelector<HTMLElement>(".footer-brand");
  expect(footerBrand?.textContent).toBe(brand);
  expect(footerBrand?.closest("td.rule")).not.toBeNull();
  expect(footerBrand?.hidden).toBe(false);
  expect(footerBrand?.style.display).not.toBe("none");
});

it.each(["code", "action"] as const)(
  "keeps separate top and footer branding for a %s-only message",
  (variant) => {
    const brand = "SHBS Peer Tutoring";
    const url = "https://school.example/account?token=synthetic&lang=zh";
    const presentation =
      variant === "code"
        ? { code: "AB234" }
        : { action: { label: "Review your account", url } };
    const doc = new DOMParser().parseFromString(
      renderEmail({
        brand,
        subject: "Account security",
        text: "Review this security notice. 请查看此安全通知。",
        presentation,
      }),
      "text/html",
    );
    const topBrand = doc.querySelector("p.ink");
    const footerBrand = doc.querySelector(".footer-brand");
    expect(topBrand?.textContent).toBe(brand);
    expect(footerBrand?.textContent).toBe(brand);
    expect(footerBrand).not.toBe(topBrand);
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.body.textContent).toContain("请查看此安全通知。");
    if (variant === "code") {
      expect(doc.querySelector(".code")?.textContent).toBe("AB234");
      expect(doc.querySelector("a")).toBeNull();
    } else {
      expect(doc.querySelector(".code")).toBeNull();
      expect([...doc.querySelectorAll("a")].map((link) => link.href)).toEqual([
        url,
        url,
      ]);
      expect(doc.querySelector("a")?.textContent).toBe("Review your account");
    }
  },
);

it.each([
  "javascript:alert(1)",
  "data:image/svg+xml,<svg onload='alert(1)'></svg>",
  "https://user:password@school.example/icon.png",
  "https://user@school.example/icon.png",
  "ftp://school.example/icon.png",
])("rejects unsafe or credential-bearing icon URL %s", (iconUrl) => {
  expect(() =>
    renderEmail({
      brand: "SHBS Peer Tutoring",
      subject: "Test",
      text: "Test",
      iconUrl,
    }),
  ).toThrow();
});

it("keeps instructions, verification and both actions usable when the icon is blocked", () => {
  const { doc, url } = emailWithoutStylesheet(
    "https://school.example/icon.png",
  );
  // Removing remote images models a client that blocks the footer asset entirely.
  const originalText = doc.body.textContent;
  expect(doc.querySelectorAll("img")).toHaveLength(1);
  doc.querySelectorAll("img").forEach((icon) => icon.remove());
  expect(doc.querySelector("img,style")).toBeNull();
  expect(doc.body.textContent).toBe(originalText);
  expect(doc.querySelector("p.ink")?.textContent).toBe("SHBS Peer Tutoring");
  expect(doc.body.textContent).toContain("使用验证码完成登录。");
  expect(doc.querySelector(".code")?.textContent).toBe("AB234");
  expect([...doc.querySelectorAll("a")].map((link) => link.href)).toEqual([
    url,
    url,
  ]);
  expect(doc.querySelector("a")?.textContent).toBe(
    "Confirm account / 确认账户",
  );
});
