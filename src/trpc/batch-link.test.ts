import { expect, it } from "vitest";
import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { TRPC_BATCH_OPTIONS } from "~/lib/trpc-batch";
import { signupIngress } from "~/server/signup-ingress";

it("splits a busy page's simultaneous queries into batches accepted by real ingress", async () => {
  const t = initTRPC.create();
  const router = t.router({
    echo: t.procedure.input(z.number()).query(({ input }) => input),
  });
  const sizes: number[] = [];
  const client = createTRPCClient<typeof router>({
    links: [
      httpBatchStreamLink({
        ...TRPC_BATCH_OPTIONS,
        url: "http://localhost/api/trpc",
        fetch: async (url, init) => {
          const request = new Request(url, init);
          sizes.push(
            new URL(request.url).pathname.split("/api/trpc/")[1]!.split(",")
              .length,
          );
          return signupIngress(request, (req) =>
            fetchRequestHandler({
              endpoint: "/api/trpc",
              req,
              router,
              createContext: () => ({}),
            }),
          );
        },
      }),
    ],
  });
  const inputs = Array.from({ length: 43 }, (_, index) => index);
  expect(
    await Promise.all(inputs.map((input) => client.echo.query(input))),
  ).toEqual(inputs);
  expect(sizes).toEqual([20, 20, 3]);
});
