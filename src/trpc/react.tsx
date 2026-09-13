"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import SuperJSON from "superjson";

// Pure `import type` (not inline) so Turbopack never traces the server router graph (→ nodemailer)
// into the client bundle.
import type { AppRouter } from "~/server/api/root";
import { createQueryClient } from "./query-client";
import { ApprovalNotice } from "~/app/_components/approval-notice";
import {
  NotificationViewport,
  SaveNotifications,
} from "~/app/_components/save-notifications";

export const api = createTRPCReact<AppRouter>();

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/** Cookie-changing server actions refresh this server-supplied identity. A keyed boundary
 * replaces queries, mutations and notices before another account/role can render them. */
export function TRPCReactProvider(props: {
  children: React.ReactNode;
  identity: string;
}) {
  return (
    <IdentityQueryProvider key={props.identity} identity={props.identity}>
      {props.children}
    </IdentityQueryProvider>
  );
}

function IdentityQueryProvider(props: {
  children: React.ReactNode;
  identity: string;
}) {
  const [queryClient] = useState(createQueryClient);
  useEffect(() => () => queryClient.clear(), [queryClient]);
  const [checkingIdentity, setCheckingIdentity] = useState(false);
  const t = useTranslations("common");
  const pathname = usePathname();
  const previousPath = useRef(pathname);

  useEffect(() => {
    let checking = false;
    const controller = new AbortController();
    // Layouts persist across navigation. Check the live session when returning to
    // a shared-device tab, and before reusing its cache on another route. Keep the
    // DOM mounted (forms retain edits), but hide it during the identity check.
    const verify = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      setCheckingIdentity(true);
      try {
        const response = await fetch("/api/session-identity", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Session check failed");
        const session: unknown = await response.json();
        if (
          !session ||
          typeof session !== "object" ||
          !("identity" in session) ||
          typeof session.identity !== "string"
        )
          throw new Error("Invalid identity response");
        if (session.identity !== props.identity) {
          await queryClient.cancelQueries();
          queryClient.clear();
          // A full navigation also discards cached server layouts and history.
          window.location.reload();
          return;
        }
        await queryClient.invalidateQueries({ refetchType: "active" });
        setCheckingIdentity(false);
      } catch {
        if (!controller.signal.aborted) {
          // A failed identity check cannot authorize displaying an old account's
          // cache. Reload so the normal server auth/error handling takes over.
          window.location.reload();
        }
      } finally {
        checking = false;
      }
    };
    const onFocus = () => {
      void verify();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      void verify();
    }
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pathname, props.identity, queryClient]);

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchStreamLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
          headers: () => {
            const headers = new Headers();
            headers.set("x-trpc-source", "nextjs-react");
            return headers;
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {checkingIdentity && (
          <p role="status" className="p-6 text-center">
            {t("loading")}
          </p>
        )}
        <div style={{ display: checkingIdentity ? "none" : "contents" }}>
          {props.children}
          <NotificationViewport>
            <ApprovalNotice />
            <SaveNotifications />
          </NotificationViewport>
        </div>
      </api.Provider>
    </QueryClientProvider>
  );
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
