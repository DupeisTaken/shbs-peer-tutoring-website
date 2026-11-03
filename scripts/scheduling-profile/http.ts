import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type RequestListener } from "node:http";
import type { Session } from "next-auth";
import type { PrismaClient } from "../../generated/prisma";
import type { createCaller } from "../../src/server/api/root";

type ContextBinder = <Args extends unknown[], Result>(operation: (...args: Args) => Result) => (...args: Args) => Result;
const sessionCookie = "shbs-profile-session";
const correlationHeader = "x-shbs-profile-request";

/** A real loopback HTTP adapter/client around the unchanged production router.
 * Opaque task-local sessions replace ONLY Auth.js session exchange. Next's
 * ingress/proxy, TLS, compression and real authentication are outside this phase.
 * No capability, cookie, correlation token or request header is an artifact. */
export async function startHttpHarness(options: {
  db: PrismaClient;
  bindCurrentContext: ContextBinder;
}) {
  const { appRouter } = await import("../../src/server/api/root");
  const { createHTTPHandler } = await import("@trpc/server/adapters/standalone");
  const { TRPCError } = await import("@trpc/server");
  const { createTRPCUntypedClient, httpLink } = await import("@trpc/client");
  const { default: superjson } = await import("superjson");
  const sessions = new Map<string, Session>();
  const clients = new Map<string, ReturnType<typeof createCaller>>();
  const bindings = new Map<string, RequestListener>();
  let closed = false;
  let requests = 0;
  let correlatedRequests = 0;
  let deniedCorrelations = 0;
  let port = 0;

  const handler = createHTTPHandler({
    router: appRouter,
    maxBodySize: 256 * 1024,
    createContext: ({ req }) => {
      const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`));
      const capability = cookie?.slice(sessionCookie.length + 1);
      const session = capability ? sessions.get(capability) : undefined;
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Synthetic HTTP session required." });
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      return { db: options.db, headers, session };
    },
  });
  const server = createServer((req, res) => {
    requests++;
    const token = req.headers[correlationHeader];
    const binding = typeof token === "string" ? bindings.get(token) : undefined;
    if (!binding) {
      deniedCorrelations++;
      res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
      res.end('{"error":"Synthetic request correlation required"}');
      return;
    }
    bindings.delete(token as string);
    correlatedRequests++;
    // This restores the measured client's async-local context for the server's
    // actual request/transaction work; it never supplies DB results or authority.
    binding(req, res);
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 50;
  await new Promise<void>((resolve, reject) => {
    const error = (cause: Error) => reject(cause);
    server.once("error", error);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", error);
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      port = address.port;
      resolve();
    });
  });

  const transportClient = (capability?: string, observeStatus?: (status: number) => void) => createTRPCUntypedClient<typeof appRouter>({
    links: [httpLink<typeof appRouter>({
      url: `http://127.0.0.1:${port}`,
      transformer: superjson,
      headers: () => capability ? { cookie: `${sessionCookie}=${capability}` } : {},
      fetch: async (input, init) => {
        assert.ok(!closed, "HTTP harness is closed.");
        assert.ok(bindings.size < 32, "HTTP correlation admission limit exceeded.");
        const token = randomBytes(24).toString("base64url");
        bindings.set(token, options.bindCurrentContext(handler));
        const headers = new Headers(init?.headers);
        headers.set(correlationHeader, token);
        try {
          // The outer operation watchdog terminates this owned process at 35s
          // before a client-only abort could let a server write outlive a round.
          const response = await fetch(input, { ...init, headers, signal: AbortSignal.timeout(36_000) });
          observeStatus?.(response.status);
          return response;
        } finally { bindings.delete(token); }
      },
    })],
  });

  const facade = (capability: string): ReturnType<typeof createCaller> => {
    const client = transportClient(capability);
    const proxy = (path: string[]): unknown => new Proxy(() => undefined, {
      get: (_target, property) => property === "then" ? undefined : typeof property === "string" ? proxy([...path, property]) : undefined,
      apply: (_target, _receiver, inputs: unknown[]) => {
        assert.ok(inputs.length <= 1, "Scenario HTTP procedures take at most one input.");
        const name = path.join(".");
        // The installed runtime flattens procedures to dotted keys; its generic
        // RouterDef declaration describes the nested input record instead.
        const procedures = appRouter._def.procedures as unknown as Record<string, { _def: { type: "query" | "mutation" | "subscription" } }>;
        const procedure = procedures[name];
        assert.ok(procedure, "Unknown production procedure.");
        if (procedure._def.type === "query") return client.query(name, inputs[0]);
        assert.equal(procedure._def.type, "mutation", "Subscriptions are outside the bounded HTTP phase.");
        return client.mutation(name, inputs[0]);
      },
    });
    // This facade changes invocation syntax only: each call uses the genuine
    // HTTP link and the production router's own query/mutation classification.
    return proxy([]) as ReturnType<typeof createCaller>;
  };

  return {
    caller(userId: string, session: Session) {
      const previous = clients.get(userId);
      if (previous) return previous;
      assert.ok(clients.size < 512, "Synthetic session admission limit exceeded.");
      const capability = randomBytes(32).toString("base64url");
      sessions.set(capability, session);
      const client = facade(capability);
      clients.set(userId, client);
      return client;
    },
    async verifyUnauthorized() {
      const statuses: { case: string; status: number; code: string }[] = [];
      for (const [name, capability] of [["missing", undefined], ["wrong", randomBytes(32).toString("base64url")]] as const) {
        let status: number | undefined;
        const client = transportClient(capability, (value) => { status = value; });
        try { await client.query("sessionPlanning.agenda", { role: "tutor" }); }
        catch (error) {
          const code = (error as { data?: { code?: string } }).data?.code;
          assert.equal(code, "UNAUTHORIZED");
          assert.equal(status, 401);
          statuses.push({ case: name, status, code });
          continue;
        }
        assert.fail("Missing/wrong synthetic HTTP capability was accepted.");
      }
      return statuses;
    },
    summary() {
      return { transport: "HTTP standalone tRPC adapter", loopback: true, ephemeralPort: true, requests, correlatedRequests, deniedCorrelations,
        excluded: ["Next ingress/proxy", "Auth.js authentication exchange", "TLS", "Production network"] };
    },
    async close() {
      closed = true;
      const undrained = bindings.size;
      bindings.clear();
      sessions.clear();
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          server.closeAllConnections();
          reject(new Error("Owned HTTP server did not close within five seconds."));
        }, 5_000);
        timer.unref();
        server.close((error) => { clearTimeout(timer); if (error) reject(error); else resolve(); });
        server.closeIdleConnections();
      });
      assert.equal(undrained, 0, "Undrained HTTP request correlations remained during cleanup.");
    },
  };
}

export type HttpHarness = Awaited<ReturnType<typeof startHttpHarness>>;
