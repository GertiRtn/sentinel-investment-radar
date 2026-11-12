/**
 * Worker entry for the own-Cloudflare deployment (deploy/cloudflare/wrangler.jsonc `main`).
 * Web requests go to vinext's normal handler; Cron Triggers run the pipeline.
 * The ChatGPT Sites build does not use this file.
 */
import handler from 'vinext/server/fetch-handler';
import { runScheduled } from '../lib/sentinel/scheduled';

type FetchHandler = { fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> | Response };

const worker = {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    return (handler as unknown as FetchHandler).fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(controller.cron).then(r => console.log('Sentinel cron', controller.cron, r.status)));
  },
};

export default worker;
