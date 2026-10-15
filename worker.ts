// OpenNext owns HTTP and its Durable Objects; the integration scheduler owns cron.
import worker from "./.open-next/worker.js";
export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "./.open-next/worker.js";
import { scheduleWhatsApp, type JobEnv } from "./src/server/whatsapp-jobs";
import { dispatchWebhooks } from "./src/server/operations/webhooks";
import { pruneOperationJournal } from "./src/server/operations/retention";
import { pruneZApi } from "./src/server/z-api";
const entry = {
  fetch: worker.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: JobEnv & { INTEGRATION_SECRET_KEY?: string },
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(scheduleWhatsApp(env));
    ctx.waitUntil(pruneZApi(env));
    ctx.waitUntil(dispatchWebhooks(env));
    ctx.waitUntil(pruneOperationJournal(env));
  },
};

export default entry;
