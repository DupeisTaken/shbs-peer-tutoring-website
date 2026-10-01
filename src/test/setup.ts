import { vi } from "vitest";
import "dotenv/config";

// Provides env defaults before any module (env.js / db.ts) is imported by tests.
// Real values can be provided by the environment or local .env (e.g. DATABASE_URL in CI).
process.env.SKIP_ENV_VALIDATION ??= "1";
process.env.AUTH_SECRET ??= "test-secret";
process.env.DATABASE_URL ??=
  "postgresql://postgres:password@localhost:5432/shbs-peer-tutoring-website";

// Next enforces this boundary during builds; unit tests execute server modules outside RSC.
vi.mock("server-only", () => ({}));

// jsdom has no native top layer. Model only the open attribute for component
// tests; focused tests can override these methods and browser checks verify
// modality, inertness and native Escape behavior on the running application.
if (typeof HTMLDialogElement !== "undefined") {
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      writable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
  }
  if (typeof HTMLDialogElement.prototype.close !== "function") {
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      writable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  }
}
