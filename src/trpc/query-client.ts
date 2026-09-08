import {
  defaultShouldDehydrateQuery,
  QueryClient,
  MutationCache,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import SuperJSON from "superjson";

export const createQueryClient = () =>
  new QueryClient({
    mutationCache: new MutationCache({ onError(error) {
      if (typeof window !== "undefined" && error instanceof TRPCClientError) {
        const id = (error as TRPCClientError<AppRouter>).data?.approvalId;
        if (id) window.dispatchEvent(new CustomEvent("approval-queued", { detail: id }));
      }
    } }),
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
