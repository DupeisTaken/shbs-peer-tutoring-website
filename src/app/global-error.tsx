"use client";

import Link from "next/link";

/** Standalone root-layout safety net; renders without relying on providers or stylesheets. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: "440px",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h1 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: 700 }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 16px", fontSize: "14px", color: "#475569" }}>
            We could not load this page. Try again or return to the home page.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: "44px",
                padding: "8px 16px",
                borderRadius: "6px",
                border: "none",
                background: "#4338ca",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{
                minHeight: "44px",
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#334155",
                fontWeight: 600,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
