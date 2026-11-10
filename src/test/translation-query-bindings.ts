import { getQueryKey } from "@trpc/react-query";
import { QueryClient, useQuery } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { api } from "~/trpc/react";
import { installSessionReadReceipts } from "~/lib/session-read-receipts";

/** Mock procedures expose the actual path consumed by the real getQueryKey. */
export const translationFixtureProcedure = (path: string) => ({
  _def: () => ({ path: path.split(".") }),
});
export const translationFixtureKey = (
  path: string,
  input?: unknown,
): QueryKey =>
  getQueryKey(
    translationFixtureProcedure(path) as unknown as typeof api.account.me,
    input as never,
    "query",
  );
export const translationFixtureFamily = (path: string): QueryKey => [
  path.split("."),
];

type Snapshot = { data?: unknown; error?: unknown; isSuccess?: boolean };
type Recipe = {
  path: string;
  source: (input?: unknown) => Snapshot;
  inputs: readonly unknown[];
};

/** Static UI suites seed synthetic cache state BEFORE rendering. These manual
 * successes deliberately carry no read receipt and cannot lift a denial. The
 * recovery suites use actual fetchQuery/useQuery instead of this static seed. */
export function createStaticTranslationQueryFixture() {
  let ownedClient: QueryClient | undefined;
  const recipes = new Map<string, Recipe>();
  const client = () => {
    if (!ownedClient)
      throw new Error("Reset the query fixture before mounting consumers.");
    return ownedClient;
  };
  const options = (recipe: Recipe, input?: unknown) => ({
    queryKey: translationFixtureKey(recipe.path, input),
    queryFn: async () => {
      const snapshot = recipe.source(input);
      if (snapshot.error) {
        const failure = snapshot.error;
        if (failure instanceof Error) throw failure;
        // Preserve structured synthetic codes used by the real denial reducer.
        if (typeof failure === "object")
          throw Object.assign(
            new Error("Synthetic translation query failed"),
            failure,
          );
        throw new Error(
          typeof failure === "string"
            ? failure
            : "Synthetic translation query failed",
          { cause: failure },
        );
      }
      return snapshot.data ?? null;
    },
    retry: false,
  });
  return {
    get client() {
      return client();
    },
    reset() {
      ownedClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity },
          mutations: { retry: false },
        },
      });
      installSessionReadReceipts(ownedClient);
    },
    read(
      path: string,
      source: Recipe["source"],
      inputs: readonly unknown[] = [undefined],
      onRefetch?: () => unknown,
    ) {
      const recipe = { path, source, inputs };
      recipes.set(path, recipe);
      return {
        ...translationFixtureProcedure(path),
        useQuery(input?: unknown) {
          const result = useQuery<unknown, unknown>({
            ...options(recipe, input),
            enabled: false,
            initialData: () => source(input).data,
          });
          return {
            ...result,
            refetch: async (
              refetchOptions?: Parameters<typeof result.refetch>[0],
            ) => {
              await onRefetch?.();
              return result.refetch(refetchOptions);
            },
          };
        },
      };
    },
    prepare() {
      for (const recipe of recipes.values())
        for (const input of recipe.inputs) {
          const snapshot = recipe.source(input);
          const query = client()
            .getQueryCache()
            .build<unknown, unknown>(client(), options(recipe, input));
          query.setState({
            data: snapshot.data,
            error: snapshot.error ?? null,
            status: snapshot.error
              ? "error"
              : snapshot.isSuccess === false
                ? "pending"
                : "success",
            fetchStatus: "idle",
          });
        }
    },
    async refresh(path: string, input?: unknown) {
      const recipe = recipes.get(path);
      if (!recipe) throw new Error("Unknown translation fixture procedure.");
      return client().fetchQuery({ ...options(recipe, input), staleTime: 0 });
    },
  };
}
export type StaticTranslationQueryFixture = ReturnType<
  typeof createStaticTranslationQueryFixture
>;
