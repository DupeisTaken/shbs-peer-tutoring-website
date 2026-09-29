/** Synthetic offline previews: never import the database, secrets, or live transport. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  renderEmail,
  type EmailPresentation,
} from "../src/server/email/template";

const output = resolve(process.argv[2] ?? ".validation/email-previews");
await mkdir(output, { recursive: true });
const brand = "SHBS Peer Tutoring";
const samples: {
  name: string;
  subject: string;
  text: string;
  presentation: EmailPresentation;
}[] = [
  {
    name: "program",
    subject: "You have a new program notification",
    text: "Your tutoring program has an update.\n\nSeptember 29, 2026 at 4:30 PM (Asia/Shanghai)\n\nSign in to review the update. You can manage optional email notifications in account settings.",
    presentation: {
      eyebrow: "PROGRAM UPDATE",
      action: {
        label: "View program update",
        url: "https://tutoring.example.edu/signin?callbackUrl=%2Fstudent",
      },
    },
  },
  {
    name: "security",
    subject: "Your account security settings changed",
    text: "September 29, 2026 at 4:30 PM (Asia/Shanghai)\n\nIf you do not recognize this activity, contact the program team through private support.",
    presentation: {
      eyebrow: "ACCOUNT SECURITY",
      action: {
        label: "Review your account",
        url: "https://tutoring.example.edu/signin?callbackUrl=%2Fmy-account",
      },
    },
  },
  {
    name: "code",
    subject: "Your sign-in code",
    text: "Hi there,\n\nYour sign-in code is AB234. It expires in 10 minutes.\n\nIf you did not request this, ignore this email.",
    presentation: { eyebrow: "SIGN IN", code: "AB234" },
  },
  {
    name: "signup",
    subject: "Tutoring signup received — confirm your email",
    text: "Verify by September 30, 2026. 验证截止时间：2026年9月30日。\n\nYour tutoring survey has been saved. Priority is based on when you first submitted it after signup opened, not when you create your account.\n\nAlready have an account? Confirm your request using the same link, then sign in with your existing password. The link expires in 24 hours.",
    presentation: {
      eyebrow: "TUTORING SIGNUP",
      action: {
        label: "Confirm your tutoring request",
        url: `https://tutoring.example.edu/signup/account?token=${"synthetic".repeat(12)}`,
      },
    },
  },
];
for (const sample of samples)
  await writeFile(
    resolve(output, `${sample.name}.html`),
    renderEmail({ brand, ...sample }),
  );
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Email previews</title><h1>Email previews · synthetic data</h1><ul>${samples.map((sample) => `<li><a href="${sample.name}.html">${sample.name}</a></li>`).join("")}</ul></html>`,
);
console.log(`Wrote ${samples.length} email previews to ${output}`);
