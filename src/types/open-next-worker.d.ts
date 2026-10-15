/** OpenNext generates this module after Next's type check (and removes it before each build). */
declare module "*.open-next/worker.js" {
  const worker: { fetch: ExportedHandlerFetchHandler };
  export default worker;
  export const DOQueueHandler: unknown;
  export const DOShardedTagCache: unknown;
  export const BucketCachePurge: unknown;
}
