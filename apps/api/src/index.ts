import { RegistryDO } from "./durable-objects/registry-do.js";
import { TunnelDO } from "./durable-objects/tunnel-do.js";
import { tunnelIdForDomain } from "./domains.js";
import type { Env } from "./env.js";
import { capture } from "./analytics.js";
import { tunnelIdFromDevPath, tunnelIdFromHost } from "./routing/index.js";
import { handleApi, trackedApiEvent } from "./routes/(api)/index.js";
import { markDomainUsed } from "./routes/(api)/domains.js";
import { handleSiteRequest, siteNotFound } from "./routes/(web)/site.js";
import { forwardProxy } from "./routes/(tunnel)/proxy.js";
import type { TrackedEvent } from "./routes/tracked-event.js";
import { servePreview } from "./routes/(preview)/serve.js";
import { cleanupExpiredPreviews } from "./routes/(api)/previews.js";

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();

  const siteResponse = handleSiteRequest(request, url);
  if (siteResponse !== null) return siteResponse;

  if (url.pathname.startsWith("/api/v1")) {
    return handleApi(request, env, ctx, url);
  }

  if (hostname === env.PREVIEW_DOMAIN.toLowerCase()) {
    return servePreview(request, env, url);
  }

  const hostTunnelId = tunnelIdFromHost(request.headers.get("host"), env.TUNNEL_DOMAIN);
  if (hostTunnelId !== null)
    return forwardProxy(request, env, hostTunnelId, url, "standard_domain");
  const customTunnelId = await tunnelIdForDomain(env, hostname);
  if (customTunnelId !== null) {
    ctx.waitUntil(markDomainUsed(env, hostname));
    return forwardProxy(request, env, customTunnelId, url, "custom_domain");
  }
  if (env.DEV_ROUTING === "true") {
    const route = tunnelIdFromDevPath(url.pathname);
    if (route !== null) {
      url.pathname = route.rewrittenPath;
      return forwardProxy(request, env, route.tunnelId, url, "development_path");
    }
  }
  return siteNotFound();
}

function trackedEvent(request: Request): TrackedEvent | null {
  return trackedApiEvent(request, new URL(request.url));
}

async function fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const analyticsEvent = trackedEvent(request);
  const response = await handleRequest(request, env, ctx);
  if (analyticsEvent !== null) {
    ctx.waitUntil(
      capture(env, {
        ...analyticsEvent,
        properties: {
          ...analyticsEvent.properties,
          status: response.status,
          success: response.status < 400,
        },
      }),
    );
  }
  return response;
}

export { RegistryDO, TunnelDO };

async function scheduled(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  ctx.waitUntil(cleanupExpiredPreviews(env));
}

export default { fetch, scheduled } satisfies ExportedHandler<Env>;
