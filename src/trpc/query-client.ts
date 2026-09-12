import {
  defaultShouldDehydrateQuery,
  QueryClient,
  MutationCache,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import SuperJSON from "superjson";
import { APPROVAL_OPERATIONS } from "~/lib/approval-policy";

/** Preparation tickets and read-like mutations are not saved changes. */
export function isAdminSaveMutation(key: readonly unknown[] | undefined) {
  const path = key?.[0];
  if (!Array.isArray(path) || !path.every((part) => typeof part === "string"))
    return false;
  const operation = path.join(".");
  if (
    [
      "account.requestEmailChange",
      "account.requestPasswordChangeCode",
    ].includes(operation)
  )
    return false;
  return (
    operation in APPROVAL_OPERATIONS ||
    ["admin", "program", "approval", "account"].includes(String(path[0]))
  );
}

export const createQueryClient = () =>
  new QueryClient({
    mutationCache: new MutationCache({
      onSuccess(_data, _variables, _context, mutation) {
        if (
          typeof window !== "undefined" &&
          window.location.pathname.startsWith("/admin") &&
          isAdminSaveMutation(mutation.options.mutationKey)
        )
          window.dispatchEvent(
            new CustomEvent("admin-save-result", {
              detail: { kind: "success" },
            }),
          );
      },
      onError(error) {
        if (typeof window !== "undefined" && error instanceof TRPCClientError) {
          const id = (error as TRPCClientError<AppRouter>).data?.approvalId;
          if (id) {
            window.dispatchEvent(
              new CustomEvent("approval-queued", { detail: id }),
            );
            return;
          }
        }
        if (
          typeof window !== "undefined" &&
          window.location.pathname.startsWith("/admin")
        )
          window.dispatchEvent(
            new CustomEvent("admin-save-result", {
              detail: { kind: "error", message: error.message },
            }),
          );
      },
    }),
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
