// @vitest-environment jsdom
import { expect, it } from "vitest";
import { renderEmail } from "./template";

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
      paragraph.textContent?.startsWith("Or copy this link"),
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
    "Keep account links and verification codes private.",
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
    "This is an automated message. Keep account links and verification codes private.",
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
