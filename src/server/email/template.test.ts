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
