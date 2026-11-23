import { expect, it } from "vitest";
import {
  createTRPCClient,
  httpBatchStreamLink,
  httpLink,
  splitLink,
} from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { TRPC_BATCH_OPTIONS } from "~/lib/trpc-batch";
import {
  isStudentAbortReceiptPost,
  studentAbortReceiptPath,
} from "~/lib/student-abort-receipt-transport";
import { signupIngress } from "~/server/signup-ingress";

it("keeps receipt evidence in one POST body while ordinary queries retain their batch transport", async () => {
  const t = initTRPC.create();
  const router = t.router({
    studentWorkflow: t.router({
      abortReceipt: t.procedure
        .input(
          z.object({
            id: z.string(),
            ticket: z.string(),
            reasonHash: z.string(),
          }),
        )
        .query(() => ({ status: "NOT_ACCEPTED" })),
    }),
    echo: t.procedure.input(z.number()).query(({ input }) => input),
  });
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const transportFetch: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    requests.push({
      url: request.url,
      method: request.method,
      body: await request.clone().text(),
    });
    return signupIngress(request, (req) =>
      fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router,
        createContext: () => ({}),
        allowMethodOverride: isStudentAbortReceiptPost(req),
      }),
    );
  };
  const client = createTRPCClient<typeof router>({
    links: [
      splitLink({
        condition: (operation) => operation.path === studentAbortReceiptPath,
        true: httpLink({
          url: "http://localhost/api/trpc",
          methodOverride: "POST",
          fetch: transportFetch,
        }),
        false: httpBatchStreamLink({
          ...TRPC_BATCH_OPTIONS,
          url: "http://localhost/api/trpc",
          fetch: transportFetch,
        }),
      }),
    ],
  });
  const input = {
    id: "synthetic-request",
    ticket: "synthetic-live-one-use-proof",
    reasonHash: "a".repeat(64),
  };
  const [receipt, ...echoes] = await Promise.all([
    client.studentWorkflow.abortReceipt.query(input),
    client.echo.query(1),
    client.echo.query(2),
  ]);
  expect(receipt).toEqual({ status: "NOT_ACCEPTED" });
  expect(echoes).toEqual([1, 2]);
  const read = requests.find((request) =>
    new URL(request.url).pathname.endsWith(studentAbortReceiptPath),
  )!;
  expect(read.method).toBe("POST");
  expect(read.url).not.toContain(input.ticket);
  expect(read.url).not.toContain(input.reasonHash);
  expect(new URL(read.url).searchParams.has("input")).toBe(false);
  expect(JSON.parse(read.body)).toEqual(input);
  const ordinary = requests.filter((request) => request !== read);
  expect(ordinary).toHaveLength(1);
  expect(ordinary[0]?.method).toBe("GET");
  expect(new URL(ordinary[0]!.url).searchParams.get("batch")).toBe("1");
  expect(
    isStudentAbortReceiptPost(
      new Request("http://localhost/api/trpc/echo", { method: "POST" }),
    ),
  ).toBe(false);
  expect(
    isStudentAbortReceiptPost(
      new Request(
        `http://localhost/api/trpc/${studentAbortReceiptPath},echo?batch=1`,
        { method: "POST" },
      ),
    ),
  ).toBe(false);
  const rejected = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router,
    createContext: () => ({}),
    req: new Request("http://localhost/api/trpc/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "3",
    }),
    allowMethodOverride: false,
  });
  expect(rejected.status).toBe(405);
});

it("rejects the POST method override for an exact single-path batch", async () => {
  const t = initTRPC.create();
  let reads = 0;
  const router = t.router({
    studentWorkflow: t.router({
      abortReceipt: t.procedure.query(() => {
        reads++;
        return { status: "NOT_ACCEPTED" };
      }),
    }),
  });
  const request = new Request(
    `http://localhost/api/trpc/${studentAbortReceiptPath}?batch=1`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 0: null }),
    },
  );
  expect(isStudentAbortReceiptPost(request)).toBe(false);
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router,
    req: request,
    createContext: () => ({}),
    allowMethodOverride: isStudentAbortReceiptPost(request),
  });
  expect(response.status).toBe(405);
  expect(reads).toBe(0);
});
