import { RegistryDO } from "./durable-objects/registry-do.js";
import { TunnelDO } from "./durable-objects/tunnel-do.js";
import { tunnelIdForDomain } from "./domains.js";
import type { Env } from "./env.js";
import { capture } from "./analytics.js";
import { tunnelIdFromDevPath, tunnelIdFromHost } from "./routing/index.js";
import { handleApi, trackedApiEvent } from "./routes/(api)/index.js";
import { markDomainUsed } from "./routes/(api)/domains.js";
import { handleSiteRequest, siteNotFound, trackedSiteEvent } from "./routes/(web)/site.js";
import { forwardProxy } from "./routes/(tunnel)/proxy.js";
import type { TrackedEvent } from "./routes/tracked-event.js";

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const isPrimaryHost = hostname === env.TUNNEL_DOMAIN.toLowerCase();

  const siteResponse = handleSiteRequest(request, env, url, isPrimaryHost);
  if (siteResponse !== null) return siteResponse;

  if (url.pathname.startsWith("/api/v1")) return handleApi(request, env, ctx, url);

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

function trackedEvent(request: Request, env: Env): TrackedEvent | null {
  const url = new URL(request.url);
  const isPrimaryHost = url.hostname.toLowerCase() === env.TUNNEL_DOMAIN.toLowerCase();
  return trackedSiteEvent(request, url, isPrimaryHost) ?? trackedApiEvent(request, url);
}

async function fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const analyticsEvent = trackedEvent(request, env);
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
export default { fetch } satisfies ExportedHandler<Env>;
