/** Keep browser batches within the ingress bound even when a busy page mounts
 * many independent queries at once. Splitting preserves the server's limit. */
export const TRPC_BATCH_OPTIONS = { maxItems: 20 } as const;
